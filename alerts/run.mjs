// Sol Desk alert job (GitHub Actions, every ~5 min). Keyless public APIs only. Research pings, not trade calls.
// The ntfy topic comes from the NTFY_TOPIC Actions secret; it is never written in this repo.
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const R = require('../rules.js').DeskRules;

const TOPIC = process.env.NTFY_TOPIC || '';
const STATE_FILE = process.env.STATE_FILE || '/tmp/state.json';
const SITE = process.env.SITE_URL || 'https://ajaynallavelli.github.io/sol-desk-terminal/';
const BAND_MIN = +process.env.BAND_MIN || 10000, BAND_MAX = +process.env.BAND_MAX || 20000;
const MAX_PER_HOUR = 12, MAX_DEEP = 8;
const TH = { chg5m: +process.env.PUMP_CHG5M || 25, ratio: 1.5, minBuys: 10, minBuyers: 8, minScore: 45 };
const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const num = v => (v === null || v === undefined || v === '' || !isFinite(+v)) ? null : +v;
const isNum = v => typeof v === 'number' && isFinite(v);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const utc = t => new Date(t).toISOString().slice(11, 16) + ' UTC';
const used = {};
async function j(url, gap = 1200, opt) {
  const host = new URL(url).host; const wait = (used[host] || 0) + gap - Date.now(); if (wait > 0) await sleep(wait); used[host] = Date.now();
  try { const r = await fetch(url, { ...(opt || {}), signal: AbortSignal.timeout(15000), headers: { 'user-agent': 'sol-desk-alerts (research only)', ...(opt?.headers || {}) } }); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); }
  catch (e) { console.log('source fail', host, e.message); return null; }
}
const state = (() => { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return {}; } })();
state.alerted = state.alerted || {}; state.sent = (state.sent || []).filter(t => Date.now() - t < 3600000);
for (const k in state.alerted) if (Date.now() - state.alerted[k] > 3 * 86400000) delete state.alerted[k];

function coin(mint) { return { mint, src: new Set(), votes: { mint: [], freeze: [] }, at: Date.now() }; }
function fromJup(o, x) {
  if (!x) return; o.src.add('Jupiter'); const s5 = x.stats5m || {}, s1 = x.stats1h || {}, a = x.audit || {};
  o.symbol ??= x.symbol; o.mcap ??= num(x.mcap); o.liq ??= num(x.liquidity); o.holders = num(x.holderCount);
  o.buys5m ??= num(s5.numBuys); o.sells5m ??= num(s5.numSells); o.buys1h ??= num(s1.numBuys); o.sells1h ??= num(s1.numSells); o.chg5m ??= num(s5.priceChange);
  o.traders5m = num(s5.numTraders); o.organicScore = num(x.organicScore); o.organicBuyers5m = num(s5.numOrganicBuyers);
  if (a.mintAuthorityDisabled !== undefined) o.votes.mint.push(['Jupiter', !a.mintAuthorityDisabled]);
  if (a.freezeAuthorityDisabled !== undefined) o.votes.freeze.push(['Jupiter', !a.freezeAuthorityDisabled]);
  if (isNum(a.topHoldersPercentage) && o.top10Pct == null) { o.top10Pct = a.topHoldersPercentage; o.top10MayIncludeLp = true; }
  o.devMints ??= num(a.devMints); o.devMigrations ??= num(a.devMigrations) ?? (isNum(num(a.devMints)) ? 0 : null); o.dev ??= x.dev;
  o.socials = o.socials || !!(x.twitter || x.website || x.telegram);
  if (x.graduatedPool) o.onCurve = false; else if (x.launchpad && o.onCurve == null) o.onCurve = true;
}
function fromDS(o, p) {
  if (!p) return; o.src.add('DexScreener'); o.symbol ??= p.baseToken?.symbol; o.mcap ??= num(p.marketCap) ?? num(p.fdv); o.liq ??= num(p.liquidity?.usd);
  o.buys5m ??= num(p.txns?.m5?.buys); o.sells5m ??= num(p.txns?.m5?.sells); o.buys1h ??= num(p.txns?.h1?.buys); o.sells1h ??= num(p.txns?.h1?.sells); o.chg5m ??= num(p.priceChange?.m5);
  o.socials = o.socials || !!((p.info?.socials || []).length || (p.info?.websites || []).length); o.pool ??= p.pairAddress;
}
function fromStonk(o, t) {
  o.src.add('stonk.fun'); o.stonk = true; o.symbol = t.symbol; o.mcap = num(t.market?.marketCapUsd); o.liq = num(t.market?.liquidityUsd); o.pool = t.pool;
  o.onCurve = t.status !== 'graduated'; if (isNum(t.transferFee?.bps)) { o.transferFeeBps = t.transferFee.bps; o.feeDisclosed = true; o.feeSrc = 'stonk.fun'; }
  if (Object.values(t.links || {}).some(Boolean)) o.socials = true;
}
function finalize(o) {
  const res = a => a.length ? a.some(x => x[1]) : null; o.mintAuth = res(o.votes.mint); o.freezeAuth = res(o.votes.freeze);
  o.authConflict = [o.votes.mint, o.votes.freeze].some(a => a.some(x => x[1]) && a.some(x => !x[1]));
  if (o.buyers5m == null && isNum(o.traders5m)) o.buyers5m = o.traders5m;
  o.ev = R.evaluate(o, { bandMin: BAND_MIN, bandMax: BAND_MAX }); o.pump = R.pumpCheck(o, o.ev, TH); return o;
}

const all = new Map(); const get = m => { if (!all.has(m)) all.set(m, coin(m)); return all.get(m); };
const [stonk, jr, gnew, gpump] = [
  await j('https://www.stonkfun.xyz/api/public/v1/tokens?sort=newest&limit=50'),
  await j('https://lite-api.jup.ag/tokens/v2/recent'),
  await j('https://api.geckoterminal.com/api/v2/networks/solana/new_pools?include=base_token&page=1', 2500),
  await j('https://api.geckoterminal.com/api/v2/networks/solana/dexes/pump-fun/pools?sort=h24_tx_count_desc', 2500)];
(stonk?.data?.tokens || []).forEach(t => MINT_RE.test(t.mint) && fromStonk(get(t.mint), t));
(jr || []).forEach(x => MINT_RE.test(x.id) && fromJup(get(x.id), x));
for (const g of [gnew, gpump]) (g?.data || []).forEach(p => {
  const id = (p.relationships?.base_token?.data?.id || '').replace(/^solana_/, ''); if (!MINT_RE.test(id) || id.startsWith('So111')) return;
  const o = get(id), a = p.attributes || {}, t = a.transactions || {}; o.src.add('GeckoTerminal');
  o.mcap ??= num(a.market_cap_usd) ?? num(a.fdv_usd); o.liq ??= num(a.reserve_in_usd); o.pool ??= a.address; o.symbol ??= (a.name || '').split(' / ')[0];
  o.buys5m ??= num(t.m5?.buys); o.sells5m ??= num(t.m5?.sells); o.buys1h ??= num(t.h1?.buys); o.sells1h ??= num(t.h1?.sells); if (num(t.m5?.buyers) != null) o.buyers5m ??= num(t.m5.buyers); o.chg5m ??= num(a.price_change_percentage?.m5);
});
const mints = [...all.keys()];
for (let i = 0; i < mints.length; i += 100) (await j('https://lite-api.jup.ag/tokens/v2/search?query=' + mints.slice(i, i + 100).join(',')) || []).forEach(x => all.has(x.id) && fromJup(all.get(x.id), x));
const inBand = [...all.values()].filter(o => isNum(o.mcap) && o.mcap >= BAND_MIN && o.mcap <= BAND_MAX && !state.alerted[o.mint]);
const noFlow = inBand.filter(o => o.buys5m == null).map(o => o.mint);
for (let i = 0; i < noFlow.length && i < 60; i += 30) (await j('https://api.dexscreener.com/tokens/v1/solana/' + noFlow.slice(i, i + 30).join(',')) || []).forEach(p => all.has(p.baseToken?.address) && fromDS(all.get(p.baseToken.address), p));
inBand.forEach(finalize);
const pre = inBand.filter(o => o.pump.pass).sort((a, b) => b.ev.score - a.ev.score).slice(0, MAX_DEEP);
console.log(`scanned ${all.size} coins, ${inBand.length} in band $${BAND_MIN}-${BAND_MAX} not yet alerted, ${pre.length} pass the aggregate pump rule`);

const alerts = [];
for (const o of pre) {
  const M = o.mint;
  const [rc, gp, gi] = [await j(`https://api.rugcheck.xyz/v1/tokens/${M}/report`, 1500), await j(`https://api.gopluslabs.io/api/v1/solana/token_security?contract_addresses=${M}`, 2500), await j(`https://api.geckoterminal.com/api/v2/networks/solana/tokens/${M}/info`, 2500)];
  const notes = [];
  if (gi?.data?.attributes) { const a = gi.data.attributes; if (a.mint_authority) o.votes.mint.push(['Gecko', a.mint_authority === 'yes']); if (a.freeze_authority) o.votes.freeze.push(['Gecko', a.freeze_authority === 'yes']); if (a.is_honeypot === 'yes') o.honeypot = true; else if (a.is_honeypot === 'no') o.honeypot ??= false; o.dev ??= a.developer_address; }
  const g = gp?.result?.[M]; if (g) { if (g.mintable) o.votes.mint.push(['GoPlus', g.mintable.status === '1']); if (g.freezable) o.votes.freeze.push(['GoPlus', g.freezable.status === '1']); if (g.non_transferable === '1' || g.balance_mutable_authority?.status === '1' || (g.transfer_hook || []).length) o.honeypot = true; else o.honeypot ??= false; if (g.metadata_mutable) o.metadataMutable = g.metadata_mutable.status === '1'; }
  if (rc) {
    const tk = rc.token || {}; const ma = rc.mintAuthority ?? tk.mintAuthority, fa = rc.freezeAuthority ?? tk.freezeAuthority;
    if (ma !== undefined) o.votes.mint.push(['RugCheck', !!ma]); if (fa !== undefined) o.votes.freeze.push(['RugCheck', !!fa]);
    const lp = new Set(); (rc.markets || []).forEach(mk => ['pubkey', 'liquidityA', 'liquidityB', 'liquidityAAccount', 'liquidityBAccount'].forEach(k => mk[k] && lp.add(mk[k])));
    const hs = (rc.topHolders || []).filter(h => !lp.has(h.address) && !lp.has(h.owner));
    if (hs.length) { o.top10Pct = hs.slice(0, 10).reduce((s, h) => s + (+h.pct || 0), 0); o.top10MayIncludeLp = false; }
    const ins = (rc.topHolders || []).filter(h => h.insider).length, nets = (rc.insiderNetworks || []).length;
    o.insidersDetected = !!(rc.graphInsidersDetected > 0 || ins || nets); o.linked = (rc.topHolders || []).length ? !!(ins || nets) : null;
    o.rcDanger = (rc.risks || []).filter(r => r.level === 'danger').map(r => r.name);
    if (rc.rugged) o.rcDanger.push('rugged');
  } else notes.push('RugCheck UNVERIFIED (unreachable)');
  if (o.pool) {
    const tr = await j(`https://api.geckoterminal.com/api/v2/networks/solana/pools/${o.pool}/trades`, 2500);
    const list = (tr?.data || []).map(x => x.attributes);
    if (list.length) {
      const buys = list.filter(t => t.kind === 'buy'); const blocks = {}; buys.forEach(t => (blocks[t.block_number] ||= new Set()).add(t.tx_from_address));
      o.sameBlockClusters = Object.values(blocks).filter(s => s.size >= 3).length;
      const byW = {}; let bv = 0; buys.forEach(t => { const v = +t.volume_in_usd || 0; bv += v; byW[t.tx_from_address] = (byW[t.tx_from_address] || 0) + v; });
      if (Object.keys(byW).length >= 3 && bv > 0) o.topBuyerShare = Math.max(...Object.values(byW)) / bv;
      if (o.dev) o.devSold = list.some(t => t.kind === 'sell' && t.tx_from_address === o.dev);
    } else notes.push('trade-level bundle check UNVERIFIED');
  }
  finalize(o);
  const authOk = o.mintAuth === false && o.freezeAuth === false;
  if (!o.pump.pass || !authOk || (o.rcDanger || []).length) { console.log('deep reject', o.symbol, M, o.ev.label, (o.rcDanger || []).join(','), o.pump.miss.join('; ')); continue; }
  alerts.push({ o, notes });
}

let sent = 0;
for (const { o, notes } of alerts) {
  if (state.sent.length >= MAX_PER_HOUR) { console.log('hourly cap reached'); break; }
  const now = Date.now();
  const title = `${o.symbol || '?'} ${R.fmtUsd(o.mcap)} @ ${utc(now)}${o.stonk ? ' (stonk.fun)' : ''}`;
  const tags = o.ev.checks.filter(c => c.status === 'TAG').map(c => c.id).join(', ');
  const message = [`Early Runner ${o.ev.score} | ${o.ev.label}`, 'Why: ' + o.pump.why.join('; '), tags ? 'Tags: ' + tags : '', notes.length ? 'Note: ' + notes.join('; ') : '', 'Research only. Paper first. Live only via Cryptotrader after LIVE TRADE APPROVED.', '', o.mint].filter((l, i) => l !== '' || i === 5).join('\n');
  const body = { topic: TOPIC, title, message, tags: ['rotating_light'], priority: 4, click: SITE + '#coin/' + o.mint,
    actions: [{ action: 'view', label: 'DexScreener', url: 'https://dexscreener.com/solana/' + o.mint }, { action: 'view', label: 'RugCheck', url: 'https://rugcheck.xyz/tokens/' + o.mint }, { action: 'view', label: 'Jupiter', url: 'https://jup.ag/swap/SOL-' + o.mint }] };
  if (!TOPIC) { console.log('[dry run, no NTFY_TOPIC]', title); }
  else { const r = await fetch('https://ntfy.sh/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); console.log('ntfy', r.status, title); if (!r.ok) continue; }
  state.alerted[o.mint] = now; state.sent.push(now); sent++;
}
state.lastRun = new Date().toISOString(); state.lastSent = sent;
fs.writeFileSync(STATE_FILE, JSON.stringify(state));
console.log(`alerts sent: ${sent}`);
