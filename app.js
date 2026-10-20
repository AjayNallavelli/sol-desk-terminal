/* Sol Desk Terminal - research only. Keyless public APIs from the browser. No wallet, no signing, no swaps. */
'use strict';
const R = window.DeskRules;
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const UV = '<span class="uv">UNVERIFIED</span>';
const isNum = v => typeof v === 'number' && isFinite(v);
const num = v => { if (v === null || v === undefined || v === '') return null; const n = +v; return isFinite(n) ? n : null; };
const usd = v => isNum(v) ? R.fmtUsd(v) : UV;
const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SOL = 'So11111111111111111111111111111111111111112';
const utc = t => { if (!t) return UV; const d = new Date(t); return isNaN(d) ? UV : d.toISOString().slice(11, 19) + ' UTC'; };
const utcFull = t => { const d = new Date(t); return isNaN(d) ? UV : d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC'; };
const age = t => { if (!t) return UV; const m = (Date.now() - t) / 60000; return m < 60 ? Math.max(0, m).toFixed(0) + 'm' : m < 1440 ? (m / 60).toFixed(1) + 'h' : (m / 1440).toFixed(1) + 'd'; };
const short = a => a ? a.slice(0, 4) + '..' + a.slice(-4) : '';
const safeUrl = u => (typeof u === 'string' && /^https?:\/\//i.test(u)) ? u : null;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const LS = { get: (k, d) => { try { const v = JSON.parse(localStorage.getItem('sd_' + k)); return v ?? d; } catch { return d; } }, set: (k, v) => localStorage.setItem('sd_' + k, JSON.stringify(v)) };
function toast(m) { const t = $('#toast'); t.textContent = m; t.style.display = 'block'; clearTimeout(toast.h); toast.h = setTimeout(() => t.style.display = 'none', 2600); }

/* ---------- polite fetch: per-host spacing, caching, in-flight dedupe ---------- */
const HOSTS = {
  'api.dexscreener.com': { gap: 1100, name: 'DexScreener' },
  'api.geckoterminal.com': { gap: 4000, name: 'GeckoTerminal' },
  'lite-api.jup.ag': { gap: 1200, name: 'Jupiter' },
  'api.rugcheck.xyz': { gap: 1500, name: 'RugCheck' },
  'api.gopluslabs.io': { gap: 2500, name: 'GoPlus' },
  'api.mainnet-beta.solana.com': { gap: 1500, name: 'Solana RPC' },
  'www.stonkfun.xyz': { gap: 1000, name: 'stonk.fun' },
  'mainnet.helius-rpc.com': { gap: 300, name: 'Helius RPC (session key)' },
  'api-mainnet.helius-rpc.com': { gap: 500, name: 'Helius API (session key)' },
  'data.solanatracker.io': { gap: 1500, name: 'Solana Tracker (session key)' },
  'public-api.birdeye.so': { gap: 1500, name: 'Birdeye (session key)' },
  'api.jup.ag': { gap: 1200, name: 'Jupiter API (session key)' }
};
const SRC = {};
const cache = new Map(), inflight = new Map(), chain = {};
function mark(host, ok, err) { const n = (HOSTS[host] || {}).name || host; SRC[n] = { ok, err: err || '', at: Date.now() }; renderStatus(); }
async function getJSON(url, ttl = 30000, opt) {
  const key = url + (opt ? JSON.stringify(opt.body) : '');
  const c = cache.get(key); if (c && Date.now() - c.t < ttl) return c.v;
  if (inflight.has(key)) return inflight.get(key);
  const host = new URL(url).host, gap = (HOSTS[host] || { gap: 1000 }).gap;
  const p = (chain[host] = (chain[host] || Promise.resolve()).catch(() => { }).then(async () => { await sleep(gap); }))
    .then(async () => {
      try {
        for (let attempt = 0; ; attempt++) {
          const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 15000);
          try {
            const r = await fetch(url, Object.assign({ signal: ctl.signal }, opt || {}));
            if (!r.ok) { const e = new Error('HTTP ' + r.status + (r.status === 429 ? ' rate limited' : '')); e.retry = r.status === 429 || r.status >= 500; throw e; }
            const v = await r.json(); cache.set(key, { t: Date.now(), v }); mark(host, true); return v;
          } catch (e) {
            // one polite retry for rate limits / transient network errors (a 429 often arrives without CORS headers -> TypeError)
            if (attempt === 0 && (e.retry || e instanceof TypeError)) { await sleep(12000 + gap); continue; }
            mark(host, false, e.name === 'AbortError' ? 'timeout' : (e.message || 'blocked/CORS')); throw e;
          } finally { clearTimeout(to); }
        }
      } finally { inflight.delete(key); }
    });
  inflight.set(key, p); return p;
}
const safe = p => p.then(v => v, () => null);

/* ---------- config ---------- */
const CFG = Object.assign({}, R.DEFAULTS, { nearGradMcap: 28000 }, LS.get('cfg', {}));
const DEFAULT_SM = ['498g1rVnFcnjBjpfw1xyqA1WvgQXUU8RWuELjxkjAayQ', 'C4eZg1rJX6v1u7LzqermPrA1pDNNxQe6g3vyY5cHHoWq', 'AVAZvHLR2PcWpDf8BXY4rVxNHYRBytycHkcB5z5QNXYm'];
let SMW = new Set(LS.get('smw', DEFAULT_SM));
const LAUNCHPAD_DEX = new Set(['pump-fun', 'pumpfun', 'meteora-dbc', 'raydium-launchlab', 'launchlab', 'moonshot', 'boop', 'letsbonk', 'bonk-fun', 'believe', 'heaven', 'jupiter-studio', 'dynamic-bonding-curve']);

/* ---------- normalizers ---------- */
function put(o, k, v) { if (v !== null && v !== undefined && (o[k] === null || o[k] === undefined)) o[k] = v; }
function newCoin(mint) { return { mint, src: new Set(), at: Date.now(), votes: { mint: [], freeze: [] } }; }
function fromJup(o, j) {
  if (!j) return; o.src.add('Jupiter');
  put(o, 'symbol', j.symbol); put(o, 'name', j.name); put(o, 'img', safeUrl(j.icon));
  const s5 = j.stats5m || {}, s1 = j.stats1h || {};
  o.jup = j;
  put(o, 'mcap', num(j.mcap)); put(o, 'liq', num(j.liquidity)); put(o, 'price', num(j.usdPrice));
  put(o, 'holders', num(j.holderCount));
  put(o, 'buys5m', num(s5.numBuys)); put(o, 'sells5m', num(s5.numSells)); put(o, 'buys1h', num(s1.numBuys)); put(o, 'sells1h', num(s1.numSells));
  put(o, 'chg5m', num(s5.priceChange)); put(o, 'chg1h', num(s1.priceChange));
  o.traders5m = num(s5.numTraders); o.organicBuyers5m = num(s5.numOrganicBuyers); o.organicScore = num(j.organicScore);
  put(o, 'createdAt', Date.parse(j.firstPool?.createdAt || j.createdAt) || null);
  const a = j.audit || {};
  if (a.mintAuthorityDisabled !== undefined) o.votes.mint.push(['Jupiter', !a.mintAuthorityDisabled]);
  if (a.freezeAuthorityDisabled !== undefined) o.votes.freeze.push(['Jupiter', !a.freezeAuthorityDisabled]);
  if (isNum(a.topHoldersPercentage) && o.top10Pct == null) { o.top10Pct = a.topHoldersPercentage; o.top10Src = 'Jupiter top holders (may include LP/curve)'; o.top10MayIncludeLp = true; }
  put(o, 'devMints', num(a.devMints)); put(o, 'devMigrations', num(a.devMigrations) ?? (isNum(a.devMints) ? 0 : null)); o.devPct = num(a.devBalancePercentage); put(o, 'dev', j.dev);
  if (j.twitter || j.website || j.telegram) { o.socials = true; o.socialSrc = 'Jupiter'; o.socialList = (o.socialList || []).concat([['X', j.twitter], ['Web', j.website], ['TG', j.telegram]].filter(x => safeUrl(x[1]))); }
  else if (o.socials == null) o.socials = false;
  put(o, 'launchpad', j.launchpad);
  if (j.graduatedPool) o.onCurve = false; else if (j.launchpad && o.onCurve == null) o.onCurve = true;
  if (isNum(j.bondingCurve)) o.gradPct = j.bondingCurve;
  o.tags = j.tags || [];
}
function fromGeckoPool(o, p, inc) {
  const a = p.attributes || {}; o.src.add('GeckoTerminal');
  const tok = (inc && inc[p.relationships?.base_token?.data?.id]?.attributes) || {};
  put(o, 'symbol', tok.symbol || (a.name || '').split(' / ')[0]); put(o, 'name', tok.name); put(o, 'img', safeUrl(tok.image_url));
  const dex = p.relationships?.dex?.data?.id; put(o, 'dex', dex); put(o, 'pool', a.address);
  put(o, 'createdAt', Date.parse(a.pool_created_at) || null);
  put(o, 'mcap', num(a.market_cap_usd) ?? num(a.fdv_usd));
  put(o, 'liq', num(a.reserve_in_usd)); put(o, 'price', num(a.base_token_price_usd));
  const t = a.transactions || {};
  put(o, 'buys5m', num(t.m5?.buys)); put(o, 'sells5m', num(t.m5?.sells)); put(o, 'buys1h', num(t.h1?.buys)); put(o, 'sells1h', num(t.h1?.sells));
  if (num(t.m5?.buyers) != null && o.buyers5m == null) { o.buyers5m = num(t.m5.buyers); o.buyersSrc = 'GeckoTerminal'; }
  put(o, 'chg5m', num(a.price_change_percentage?.m5)); put(o, 'chg1h', num(a.price_change_percentage?.h1));
  put(o, 'vol5m', num(a.volume_usd?.m5)); put(o, 'vol1h', num(a.volume_usd?.h1)); put(o, 'vol24', num(a.volume_usd?.h24));
  if (dex && o.onCurve == null) o.onCurve = LAUNCHPAD_DEX.has(dex);
}
function fromDS(o, p) {
  if (!p) return; o.src.add('DexScreener'); o.ds = p;
  put(o, 'symbol', p.baseToken?.symbol); put(o, 'name', p.baseToken?.name); put(o, 'img', safeUrl(p.info?.imageUrl));
  put(o, 'dex', p.dexId); put(o, 'pool', p.pairAddress); put(o, 'createdAt', p.pairCreatedAt || null);
  const mc = num(p.marketCap) ?? num(p.fdv);
  if (isNum(o.mcap) && isNum(mc) && Math.abs(mc - o.mcap) / Math.max(mc, o.mcap) > 0.25) { o.conflict = 'Mcap DATA CONFLICT: ' + R.fmtUsd(o.mcap) + ' vs DexScreener ' + R.fmtUsd(mc) + ' (using lower)'; o.mcap = Math.min(mc, o.mcap); }
  put(o, 'mcap', mc); put(o, 'liq', num(p.liquidity?.usd)); put(o, 'price', num(p.priceUsd));
  put(o, 'buys5m', num(p.txns?.m5?.buys)); put(o, 'sells5m', num(p.txns?.m5?.sells)); put(o, 'buys1h', num(p.txns?.h1?.buys)); put(o, 'sells1h', num(p.txns?.h1?.sells));
  put(o, 'chg5m', num(p.priceChange?.m5)); put(o, 'chg1h', num(p.priceChange?.h1)); put(o, 'vol5m', num(p.volume?.m5)); put(o, 'vol1h', num(p.volume?.h1)); put(o, 'vol24', num(p.volume?.h24));
  const soc = [...(p.info?.socials || []).map(s => [s.type, s.url]), ...(p.info?.websites || []).map(w => ['web', w.url])].filter(x => safeUrl(x[1]));
  if (soc.length) { o.socials = true; o.socialSrc = 'DexScreener'; o.socialList = (o.socialList || []).concat(soc); } else if (o.socials == null) o.socials = false;
  if (o.onCurve == null && p.dexId) o.onCurve = LAUNCHPAD_DEX.has(p.dexId);
}
function fromStonk(o, t) {
  if (!t) return; o.src.add('stonk.fun'); o.stonk = t;
  put(o, 'symbol', t.symbol); put(o, 'name', t.name); put(o, 'img', safeUrl(t.imageUrl)); put(o, 'pool', t.pool);
  o.mcap = num(t.market?.marketCapUsd) ?? o.mcap; o.liq = num(t.market?.liquidityUsd) ?? o.liq; o.price = num(t.market?.priceUsd) ?? o.price;
  o.vol24 = num(t.market?.volume24hUsd) ?? o.vol24; o.peak = num(t.market?.peakMarketCapUsd);
  put(o, 'createdAt', Date.parse(t.createdAt) || null);
  o.quote = t.quote?.symbol; o.stonkStatus = t.status; o.dex = o.dex || 'stonk.fun ' + (t.launchpad || '');
  if (isNum(t.graduationProgress)) o.gradPct = t.graduationProgress * 100;
  o.onCurve = t.status !== 'graduated';
  if (isNum(t.transferFee?.bps)) { o.transferFeeBps = t.transferFee.bps; o.feeSrc = 'stonk.fun'; o.feeDisclosed = true; }
  const soc = Object.entries(t.links || {}).filter(([, u]) => safeUrl(u));
  if (soc.length) { o.socials = true; o.socialSrc = 'stonk.fun'; o.socialList = (o.socialList || []).concat(soc); }
}
function finalize(o) {
  const v = o.votes;
  const res = arr => arr.length ? arr.some(x => x[1] === true) : null;
  o.mintAuth = res(v.mint); o.freezeAuth = res(v.freeze);
  o.authConflict = [v.mint, v.freeze].some(a => a.some(x => x[1]) && a.some(x => !x[1]));
  o.authSrc = [...new Set([...v.mint, ...v.freeze].map(x => x[0]))].join(', ');
  if (o.buyers5m == null && isNum(o.traders5m)) { o.buyers5m = o.traders5m; o.buyersSrc = 'Jupiter unique traders (buyers+sellers)'; }
  const srcs = [...o.src].join(' + ');
  o.flowSrc = srcs; o.liqSrc = srcs; o.mcapSrc = srcs; o.curveSrc = o.curveSrc || srcs; o.socialSrc = o.socialSrc || srcs;
  o.ev = R.evaluate(o, CFG); return o;
}
function applyLook(o) { const w = WATCH.find(x => x.mint === o.mint); if (w && w.look2 && w.look1) { o.retention = w.look2.price / w.look1.price; o.lookBuysLead = w.look2.buys > w.look2.sells; } }

/* ---------- Pulse ---------- */
let PULSE = new Map(), pulseBusy = false;
async function loadPulse() {
  if (pulseBusy) return; pulseBusy = true; $('#pulseAt').textContent = 'loading...';
  const m = new Map(); const get = k => { if (!m.has(k)) m.set(k, newCoin(k)); return m.get(k); };
  try {
    const [jr, g1, gp, prof, boost] = await Promise.all([
      safe(getJSON('https://lite-api.jup.ag/tokens/v2/recent', 25000)),
      safe(getJSON('https://api.geckoterminal.com/api/v2/networks/solana/new_pools?include=base_token,dex&page=1', 25000)),
      safe(getJSON('https://api.geckoterminal.com/api/v2/networks/solana/dexes/pump-fun/pools?sort=h24_tx_count_desc&include=base_token,dex', 25000)),
      safe(getJSON('https://api.dexscreener.com/token-profiles/latest/v1', 25000)),
      safe(getJSON('https://api.dexscreener.com/token-boosts/latest/v1', 25000))]);
    (jr || []).forEach(j => { if (j && MINT_RE.test(j.id)) fromJup(get(j.id), j); });
    for (const g of [g1, gp]) if (g?.data) { const inc = {}; (g.included || []).forEach(x => inc[x.id] = x); g.data.forEach(p => { const id = (p.relationships?.base_token?.data?.id || '').replace(/^solana_/, ''); if (MINT_RE.test(id) && id !== SOL) fromGeckoPool(get(id), p, inc); }); }
    const dsMints = [...new Set([...(prof || []), ...(boost || [])].filter(x => x.chainId === 'solana' && MINT_RE.test(x.tokenAddress)).map(x => x.tokenAddress))].slice(0, 60);
    for (let i = 0; i < dsMints.length; i += 30) {
      const pairs = await safe(getJSON('https://api.dexscreener.com/tokens/v1/solana/' + dsMints.slice(i, i + 30).join(','), 25000));
      const best = {}; (pairs || []).forEach(p => { const a = p.baseToken?.address; if (!a) return; if (!best[a] || (p.liquidity?.usd || 0) > (best[a].liquidity?.usd || 0)) best[a] = p; });
      Object.values(best).forEach(p => fromDS(get(p.baseToken.address), p));
    }
    const need = [...m.values()].filter(o => !o.jup).map(o => o.mint);
    for (let i = 0; i < need.length && i < 200; i += 100) {
      const js = await safe(getJSON('https://lite-api.jup.ag/tokens/v2/search?query=' + need.slice(i, i + 100).join(','), 25000));
      (js || []).forEach(j => m.has(j.id) && fromJup(m.get(j.id), j));
    }
    const curve = [...m.values()].filter(o => o.onCurve && o.gradPct == null).map(o => o.mint).slice(0, 30);
    if (curve.length) { const gm = await safe(getJSON('https://api.geckoterminal.com/api/v2/networks/solana/tokens/multi/' + curve.join(','), 25000)); (gm?.data || []).forEach(t => { const o = m.get(t.attributes?.address); const lp = t.attributes?.launchpad_details; if (o && lp) { if (isNum(num(lp.graduation_percentage))) o.gradPct = num(lp.graduation_percentage); if (lp.completed) o.onCurve = false; } }); }
    m.forEach(o => { applyLook(o); finalize(o); });
    PULSE = m; $('#pulseAt').textContent = m.size + ' coins @ ' + utc(Date.now());
  } finally { pulseBusy = false; }
  renderPulse();
}
function filters() { return { min: +$('#fMin').value || 0, max: +$('#fMax').value || Infinity, all: $('#fAll').checked, age: +$('#fAge').value || 0, liq: +$('#fLiq').value || 0, buys: +$('#fBuys').value || 0, hold: +$('#fHold').value || 0, soc: $('#fSoc').checked, hide: $('#fHide').checked, sort: $('#fSort').value }; }
function scoreCls(ev) { return ev.fails ? 's-lo' : ev.score >= 60 ? 's-hi' : ev.score >= 35 ? 's-md' : 's-lo'; }
function cardHTML(o) {
  const ev = o.ev;
  const bs = isNum(o.buys5m) ? `<b class="${o.buys5m > (o.sells5m || 0) ? 'up' : 'dn'}">${o.buys5m}/${o.sells5m ?? '?'}</b>` : UV;
  const ch = isNum(o.chg5m) ? `<b class="${o.chg5m >= 0 ? 'up' : 'dn'}">${o.chg5m.toFixed(0)}%</b>` : UV;
  const pills = ev.checks.filter(x => x.status === 'FAIL' || (x.status === 'TAG' && ['top10', 'deployer', 'liq', 'honey'].includes(x.id))).slice(0, 3).map(x => `<span class="pill ${x.status}" title="${esc(x.detail)}">${esc(x.id)}</span>`).join('');
  const watch = WATCH.some(w => w.mint === o.mint) ? '<span class="pill PASS">pinned</span>' : '';
  return `<div class="card" data-mint="${esc(o.mint)}">${o.img ? `<img loading="lazy" src="${esc(o.img)}" alt="">` : '<div class="ph"></div>'}
  <div><div><span class="n">${esc(o.symbol || '?')}</span> <span class="s">${esc((o.name || '').slice(0, 22))}</span> <span class="mu small">${age(o.createdAt)}</span></div>
  <div class="m">MC <b>${usd(o.mcap)}</b> @${utc(o.at)} &middot; L <b>${usd(o.liq)}</b> &middot; 5m ${ch} &middot; B/S ${bs}</div>
  <div class="m">uniq ${isNum(o.buyers5m) ? '<b>' + o.buyers5m + '</b>' : UV} &middot; hold ${isNum(o.holders) ? '<b>' + o.holders + '</b>' : UV}${isNum(o.gradPct) && o.onCurve ? ' &middot; curve <b>' + o.gradPct.toFixed(0) + '%</b>' : ''} &middot; ${esc(o.dex || o.launchpad || '')} ${o.socials ? '<span class="pill">soc</span>' : ''} ${pills}${watch}</div></div>
  <div class="right"><span class="sc ${scoreCls(ev)}" title="Early Runner score (ranking, not a chance of profit)">${ev.score}</span><div class="small mu">${esc(ev.label.split(' ')[0])}</div><button class="small" data-pin="${esc(o.mint)}">pin</button></div></div>`;
}
function renderPulse() {
  const f = filters(); const late = [], cols = { New: [], Near: [], Grad: [] };
  for (const o of PULSE.values()) {
    if (isNum(o.mcap) && o.mcap > f.max * CFG.tooLateMult && !f.all) { late.push(o); continue; }
    if (!f.all && (!isNum(o.mcap) || o.mcap < f.min || o.mcap > f.max)) continue;
    if (f.age && (!o.createdAt || (Date.now() - o.createdAt) / 60000 > f.age)) continue;
    if (f.liq && !(o.liq >= f.liq)) continue;
    if (f.buys && !(o.buys5m >= f.buys)) continue;
    if (f.hold && !(o.holders >= f.hold)) continue;
    if (f.soc && !o.socials) continue;
    if (f.hide && o.ev.fails) continue;
    const near = o.onCurve && ((isNum(o.gradPct) && o.gradPct >= 70) || (!isNum(o.gradPct) && isNum(o.mcap) && o.mcap >= CFG.nearGradMcap));
    (o.onCurve === false ? cols.Grad : near ? cols.Near : cols.New).push(o);
  }
  const sorter = { score: (a, b) => b.ev.score - a.ev.score, age: (a, b) => (b.createdAt || 0) - (a.createdAt || 0), mcap: (a, b) => (b.mcap || 0) - (a.mcap || 0), buys: (a, b) => (b.buys5m || 0) - (a.buys5m || 0) }[f.sort];
  for (const k of Object.keys(cols)) { cols[k].sort(sorter); $('#l' + k).innerHTML = cols[k].map(cardHTML).join('') || '<p class="mu" style="padding:8px">None in this filter. NO QUALIFYING TRADE is a valid outcome.</p>'; $('#c' + k).textContent = cols[k].length; }
  $('#lLate').innerHTML = late.length ? late.sort((a, b) => b.mcap - a.mcap).map(o => `<a href="#coin/${esc(o.mint)}">${esc(o.symbol)} ${R.fmtUsd(o.mcap)}</a>`).join(' &middot; ') : 'NONE';
}
const PRESETS = { band: { fMin: 10000, fMax: 20000, fAll: false, fAge: '', fBuys: '', fSort: 'score' }, fresh: { fMin: 10000, fMax: 20000, fAll: false, fAge: 30, fBuys: '', fSort: 'age' }, demand: { fMin: 5000, fMax: 60000, fAll: false, fAge: '', fBuys: 10, fSort: 'buys' }, all: { fAll: true, fAge: '', fBuys: '', fSort: 'score' } };
function applyPreset(k) { for (const [id, v] of Object.entries(PRESETS[k])) { const el = $('#' + id); if (el.type === 'checkbox') el.checked = v; else el.value = v; } renderPulse(); }

/* ---------- stonk.fun ---------- */
let STONK = [], stonkTimer = null;
async function loadStonk() {
  const r = await safe(getJSON('https://www.stonkfun.xyz/api/public/v1/tokens?sort=newest&limit=50', 25000));
  const list = (r?.data?.tokens || []).filter(t => MINT_RE.test(t.mint)).map(t => { const o = newCoin(t.mint); fromStonk(o, t); return o; });
  for (let i = 0; i < list.length; i += 100) { const js = await safe(getJSON('https://lite-api.jup.ag/tokens/v2/search?query=' + list.slice(i, i + 100).map(o => o.mint).join(','), 25000)); const by = {}; (js || []).forEach(j => by[j.id] = j); list.forEach(o => fromJup(o, by[o.mint])); }
  // DexScreener fills 5m flow / price change where Jupiter has not indexed a fresh launch yet (30 per call)
  const miss = list.filter(o => o.buys5m == null).map(o => o.mint).slice(0, 60);
  for (let i = 0; i < miss.length; i += 30) { const pairs = await safe(getJSON('https://api.dexscreener.com/tokens/v1/solana/' + miss.slice(i, i + 30).join(','), 25000)); const best = {}; (pairs || []).forEach(p => { const a = p.baseToken?.address; if (a && (!best[a] || (p.liquidity?.usd || 0) > (best[a].liquidity?.usd || 0))) best[a] = p; }); list.forEach(o => best[o.mint] && fromDS(o, best[o.mint])); }
  list.forEach(o => { applyLook(o); finalize(o); o.pump = R.pumpCheck(o, o.ev, pumpTh()); });
  STONK = list; $('#stonkAt').textContent = r ? list.length + ' launches @ ' + utc(Date.now()) : 'stonk.fun API failed: UNVERIFIED';
  renderStonk(); if ($('#sAlert').checked) stonkAlerts();
}
function pumpTh() { return { chg5m: +$('#tChg').value, ratio: +$('#tRatio').value, minBuys: +$('#tBuys').value, minBuyers: +$('#tUniq').value, minScore: +$('#tScore').value }; }
function renderStonk() {
  $('#stonkT tbody').innerHTML = STONK.map(o => `<tr data-mint="${esc(o.mint)}" style="cursor:pointer"><td><b>${esc(o.symbol)}</b> <span class="mu">${esc((o.name || '').slice(0, 18))}</span></td><td>${esc(o.quote || '')}</td><td>${esc(o.stonkStatus || '')}${isNum(o.gradPct) && o.onCurve ? ' ' + o.gradPct.toFixed(0) + '%' : ''}</td><td>${age(o.createdAt)}</td><td>${usd(o.mcap)} <span class="mu small">${utc(o.at)}</span></td><td>${usd(o.liq)}</td><td>${isNum(o.chg5m) ? `<span class="${o.chg5m >= 0 ? 'up' : 'dn'}">${o.chg5m.toFixed(0)}%</span>` : UV}</td><td>${isNum(o.buys5m) ? o.buys5m + '/' + (o.sells5m ?? '?') : UV}</td><td>${isNum(o.buyers5m) ? o.buyers5m : UV}</td><td>${isNum(o.transferFeeBps) ? (o.transferFeeBps / 100) + '%' : UV}</td><td><span class="sc ${scoreCls(o.ev)}">${o.ev.score}</span></td><td class="small">${esc(o.ev.label)}</td><td>${o.pump.pass ? '<b class="up">PUMP</b>' : '<span class="mu small" title="' + esc(o.pump.miss.join('; ')) + '">no</span>'} <button class="small" data-pin="${esc(o.mint)}">pin</button></td></tr>`).join('') || '<tr><td colspan="13" class="mu">No data (stonk.fun API UNVERIFIED)</td></tr>';
}
function beep() { try { const a = new (window.AudioContext || window.webkitAudioContext)(); [880, 1320].forEach((f, i) => { const o = a.createOscillator(), g = a.createGain(); o.frequency.value = f; o.connect(g); g.connect(a.destination); const t0 = a.currentTime + i * 0.18; g.gain.setValueAtTime(0.15, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.16); o.start(t0); o.stop(t0 + 0.17); }); } catch { } }
function notify(title, body, mint) {
  beep(); toast(title);
  if ('Notification' in window && Notification.permission === 'granted') { const n = new Notification(title, { body, tag: mint }); n.onclick = () => { window.focus(); location.hash = '#coin/' + mint; }; }
}
function stonkAlerts() {
  const seen = LS.get('stonkAlerted', {}); const now = Date.now();
  STONK.filter(o => o.pump.pass && !seen[o.mint]).forEach(o => { seen[o.mint] = now; notify('stonk.fun PUMP: ' + o.symbol + ' ' + R.fmtUsd(o.mcap) + ' ' + utc(now), o.pump.why.join(', ') + '\n' + o.mint, o.mint); });
  for (const k in seen) if (now - seen[k] > 86400000) delete seen[k]; LS.set('stonkAlerted', seen);
}
function scheduleStonk() { clearTimeout(stonkTimer); if (!$('#sAlert').checked) return; const s = Math.max(30, +$('#sInt').value || 45) * (document.hidden ? 2 : 1); stonkTimer = setTimeout(async () => { await loadStonk(); scheduleStonk(); }, s * 1000); }

/* ---------- Coin page ---------- */
let CUR = null, chart = null, tapeTimer = null;
function openCoin(mint) {
  mint = (mint || '').trim(); if (!MINT_RE.test(mint)) { toast('Not a valid Solana mint'); return; }
  if (location.hash !== '#coin/' + mint) { location.hash = '#coin/' + mint; return; }
  show('coin'); CUR = { mint, d: {}, tf: 'minute:1' }; $('#coinBody').innerHTML = '<p class="mu">Loading ' + esc(mint) + ' ... (requests are spaced politely; sections fill in as they arrive)</p>';
  const M = encodeURIComponent(mint);
  const set = k => v => { if (CUR?.mint !== mint) return v; CUR.d[k] = v; renderCoin(); return v; };
  const fail = k => () => { if (CUR?.mint !== mint) return; CUR.d[k] = null; renderCoin(); };
  getJSON('https://api.dexscreener.com/tokens/v1/solana/' + M, 20000).then(set('ds'), fail('ds'));
  (typeof jupLookup === 'function' ? jupLookup(M) : getJSON('https://lite-api.jup.ag/tokens/v2/search?query=' + M, 20000)).then(v => set('jup')((v || []).find(j => j.id === mint) || null), fail('jup'));
  getJSON('https://api.rugcheck.xyz/v1/tokens/' + M + '/report', 60000).then(set('rc'), fail('rc'));
  getJSON('https://api.gopluslabs.io/api/v1/solana/token_security?contract_addresses=' + M, 60000).then(v => set('gp')(v?.result?.[mint] || null), fail('gp'));
  getJSON('https://api.geckoterminal.com/api/v2/networks/solana/tokens/' + M + '/info', 60000).then(v => set('gti')(v?.data?.attributes || null), fail('gti'));
  getJSON('https://api.geckoterminal.com/api/v2/networks/solana/tokens/' + M + '/pools?page=1', 30000).then(v => { set('gtp')(v?.data?.[0] || null); if (v?.data?.[0]) { loadTrades(); loadOHLCV(); } }, fail('gtp'));
  getJSON('https://api.mainnet-beta.solana.com', 60000, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getAccountInfo', params: [mint, { encoding: 'jsonParsed' }] }) }).then(v => set('rpc')(v?.result?.value?.data?.parsed?.info || null), fail('rpc'));
  if (!/pump$/.test(mint) && mint !== SOL) getJSON('https://www.stonkfun.xyz/api/public/v1/tokens/' + M, 60000).then(v => set('stonk')(v?.data || null), fail('stonk'));
  clearInterval(tapeTimer); tapeTimer = setInterval(() => { if (!document.hidden && CUR?.mint === mint && $('#p-coin').classList.contains('on')) loadTrades(); }, 30000);
}
function poolAddr() { return CUR?.d.gtp?.attributes?.address; }
function loadTrades() { const p = poolAddr(); if (!p) return; const mint = CUR.mint; getJSON(`https://api.geckoterminal.com/api/v2/networks/solana/pools/${p}/trades`, 25000).then(v => { if (CUR?.mint === mint) { CUR.d.trades = (v?.data || []).map(x => x.attributes); CUR.d.tradesAt = Date.now(); renderCoin(); } }, () => { if (CUR?.mint === mint) { CUR.d.trades = null; renderCoin(); } }); }
function loadOHLCV() { const p = poolAddr(); if (!p) return; const [tf, ag] = CUR.tf.split(':'); const mint = CUR.mint; getJSON(`https://api.geckoterminal.com/api/v2/networks/solana/pools/${p}/ohlcv/${tf}?aggregate=${ag}&limit=300&currency=usd`, 30000).then(v => { if (CUR?.mint === mint) { CUR.d.ohlcv = v?.data?.attributes?.ohlcv_list || []; renderCoin(); } }, () => { if (CUR?.mint === mint) { CUR.d.ohlcv = null; CUR.embed = true; renderCoin(); } }); } // GeckoTerminal candles failed (often a 429): fall back to the DexScreener embed
function analyzeTrades(tr, dev) {
  if (!Array.isArray(tr) || !tr.length) return null;
  const buys = tr.filter(t => t.kind === 'buy'), sells = tr.filter(t => t.kind === 'sell');
  const byW = {}; let bv = 0; buys.forEach(t => { const v = +t.volume_in_usd || 0; bv += v; byW[t.tx_from_address] = (byW[t.tx_from_address] || 0) + v; });
  const top = Object.entries(byW).sort((a, b) => b[1] - a[1])[0];
  const blocks = {}; buys.forEach(t => { (blocks[t.block_number] = blocks[t.block_number] || new Set()).add(t.tx_from_address); });
  const clusterBlocks = Object.entries(blocks).filter(([, s]) => s.size >= 3).map(([b]) => b);
  const now = Date.now(), ag = t => now - Date.parse(t.block_timestamp);
  const t5 = tr.filter(t => ag(t) < 300000), t10 = tr.filter(t => ag(t) >= 300000 && ag(t) < 600000);
  return { n: tr.length, buys: buys.length, sells: sells.length, uniqBuyers: new Set(buys.map(t => t.tx_from_address)).size, topBuyer: top?.[0], topBuyerShare: bv > 0 && Object.keys(byW).length >= 3 ? top[1] / bv : null, clusterBlocks: new Set(clusterBlocks), clusters: clusterBlocks.length, devSold: dev ? sells.some(t => t.tx_from_address === dev) : null, b5: t5.filter(t => t.kind === 'buy').length, s5: t5.filter(t => t.kind === 'sell').length, b10: t10.filter(t => t.kind === 'buy').length };
}
function buildCur() {
  const d = CUR.d, o = newCoin(CUR.mint);
  if (d.stonk?.token) { fromStonk(o, d.stonk.token); o.creator = d.stonk.launch?.creator; }
  if (Array.isArray(d.ds)) { const best = d.ds.filter(p => p.baseToken?.address === CUR.mint).sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0]; fromDS(o, best); }
  if (d.gtp) fromGeckoPool(o, d.gtp, null);
  fromJup(o, d.jup);
  const gi = d.gti; if (gi) {
    if (gi.mint_authority) o.votes.mint.push(['GeckoTerminal', gi.mint_authority === 'yes']);
    if (gi.freeze_authority) o.votes.freeze.push(['GeckoTerminal', gi.freeze_authority === 'yes']);
    if (gi.is_honeypot === 'yes') { o.honeypot = true; o.honeyDetail = 'GeckoTerminal: honeypot'; o.honeySrc = 'GeckoTerminal'; } else if (gi.is_honeypot === 'no' && o.honeypot == null) { o.honeypot = false; o.honeySrc = 'GeckoTerminal'; }
    o.dev = o.dev || gi.developer_address; if (num(gi.holders?.count) != null && o.holders == null) o.holders = num(gi.holders.count);
    o.gtHolders = gi.holders?.distribution_percentage; o.gtScore = num(gi.gt_score);
    const lp = gi.launchpad_details; if (lp) { if (isNum(num(lp.graduation_percentage))) o.gradPct = num(lp.graduation_percentage); o.onCurve = !lp.completed; o.curveSrc = 'GeckoTerminal launchpad'; }
    if (gi.twitter_handle && !o.xHandle) o.xHandle = String(gi.twitter_handle);
    if (!o.socials && (gi.twitter_handle || gi.telegram_handle || (gi.websites || []).length)) { o.socials = true; o.socialSrc = 'GeckoTerminal'; }
  }
  const g = d.gp; if (g) {
    if (g.mintable) o.votes.mint.push(['GoPlus', g.mintable.status === '1']);
    if (g.freezable) o.votes.freeze.push(['GoPlus', g.freezable.status === '1']);
    const bad = []; if (g.non_transferable === '1') bad.push('non-transferable'); if (g.balance_mutable_authority?.status === '1') bad.push('balance-mutable (permanent delegate)'); if ((g.transfer_hook || []).length) bad.push('transfer hook');
    if (bad.length) { o.honeypot = true; o.honeyDetail = 'GoPlus: ' + bad.join(', '); o.honeySrc = 'GoPlus'; } else if (o.honeypot == null) { o.honeypot = false; o.honeySrc = 'GoPlus'; }
    const fr = num(g.transfer_fee?.fee_rate ?? g.transfer_fee?.current_fee_rate);
    if (fr != null && o.transferFeeBps == null) { o.transferFeeBps = fr > 1 ? fr : fr * 10000; o.feeSrc = 'GoPlus'; } else if (o.transferFeeBps == null && g.transfer_fee && !Object.keys(g.transfer_fee).length) { o.transferFeeBps = 0; o.feeSrc = 'GoPlus'; }
    if (g.metadata_mutable) { o.metadataMutable = g.metadata_mutable.status === '1'; o.metaSrc = 'GoPlus'; }
  }
  const rp = d.rpc; if (rp && rp.mintAuthority !== undefined) { o.votes.mint.push(['Solana RPC', rp.mintAuthority !== null]); o.votes.freeze.push(['Solana RPC', rp.freezeAuthority !== null]); }
  const rc = d.rc; if (rc) {
    const tk = rc.token || {}; const ma = rc.mintAuthority !== undefined ? rc.mintAuthority : tk.mintAuthority, fa = rc.freezeAuthority !== undefined ? rc.freezeAuthority : tk.freezeAuthority;
    if (ma !== undefined) o.votes.mint.push(['RugCheck', !!ma]); if (fa !== undefined) o.votes.freeze.push(['RugCheck', !!fa]);
    if (rc.tokenMeta && rc.tokenMeta.mutable !== undefined && o.metadataMutable == null) { o.metadataMutable = !!rc.tokenMeta.mutable; o.metaSrc = 'RugCheck'; }
    const lpAcc = new Set(); (rc.markets || []).forEach(mk => ['pubkey', 'liquidityA', 'liquidityB', 'liquidityAAccount', 'liquidityBAccount'].forEach(k => mk[k] && lpAcc.add(mk[k])));
    const holders = (rc.topHolders || []).map(h => ({ ...h, lp: lpAcc.has(h.address) || lpAcc.has(h.owner) || h.owner === '1nc1nerator11111111111111111111111111111111' }));
    o.rcHolders = holders;
    if (holders.length) { o.top10Pct = holders.filter(h => !h.lp).slice(0, 10).reduce((s, h) => s + (+h.pct || 0), 0); o.top10Src = 'RugCheck (ex LP/curve/burn)'; o.top10MayIncludeLp = false; }
    const ins = holders.filter(h => h.insider); const nets = rc.insiderNetworks || [];
    o.insidersDetected = !!(rc.graphInsidersDetected > 0 || ins.length || nets.length);
    o.insiderDetail = 'RugCheck: ' + (rc.graphInsidersDetected || 0) + ' graph insiders, ' + ins.length + ' insider top holders, ' + nets.length + ' network(s)'; o.insiderSrc = 'RugCheck';
    o.linked = holders.length ? (ins.length > 0 || nets.length > 0) : null;
    const lps = (rc.markets || []).map(mk => num(mk.lp?.lpLockedPct)).filter(isNum); if (lps.length) o.lpLockedPct = Math.max(...lps);
    o.rcRisks = rc.risks || []; o.rcScore = num(rc.score_normalised ?? rc.score); o.creator = o.creator || rc.creator; o.rugged = rc.rugged;
    if (num(rc.totalHolders) != null && o.holders == null) o.holders = num(rc.totalHolders);
    if (rc.transferFee && isNum(num(rc.transferFee.pct)) && o.transferFeeBps == null) { o.transferFeeBps = num(rc.transferFee.pct) * 100; o.feeSrc = 'RugCheck'; }
  }
  const ta = analyzeTrades(d.trades, o.dev || o.creator); o.ta = ta;
  // Bundle / one-buyer heuristics only mean something on young pools; on mature, busy pools (routers, arb bots) they misfire, so they stay UNVERIFIED there.
  const young = isNum(o.createdAt) && Date.now() - o.createdAt < 6 * 3600000;
  if (ta) { if (young) { o.sameBlockClusters = ta.clusters; o.topBuyerShare = ta.topBuyerShare; } else o.bundleNote = 'pool older than 6h: same-block / one-buyer heuristics not applied (UNVERIFIED)'; o.devSold = (o.dev || o.creator) ? ta.devSold : null; }
  if (CUR.funder) { o.funderMaxGroup = CUR.funder.maxGroup; o.funderTraced = CUR.funder.traced; if (CUR.funder.maxGroup >= 3) o.linked = true; }
  if (!o.rcHolders && d.hel?.holders?.length) { o.top10Pct = d.hel.holders.slice(0, 10).reduce((a, h) => a + h.pct, 0); o.top10Src = 'Helius getTokenLargestAccounts (may include LP/curve)'; o.top10MayIncludeLp = true; }
  const oh = d.ohlcv; if (Array.isArray(oh) && oh.length > 5 && CUR.tf === 'minute:1') { const c = oh.slice(0, 30); const bodies = c.map(k => k[4] - k[1]); const maxH = Math.max(...c.map(k => k[2])); o.verticalCandle = bodies[0] > 0 && bodies[0] >= Math.max(...bodies) && c[0][4] >= maxH * 0.95 && bodies[0] > Math.abs(bodies[1] || 0) * 3; }
  applyLook(o); return finalize(o);
}
function stat(k, v) { return `<div><span>${esc(k)}</span>${v}</div>`; }
// "Check in other tools": per-token URL patterns checked by HTTP status on 2026-10-19. "(homepage)" = the tool has no per-token page.
function xHandleOf(o) {
  const ok = h => (h = String(h || '').replace(/^@/, '').trim(), /^[A-Za-z0-9_]{1,15}$/.test(h) ? h : null);
  if (ok(o.xHandle)) return ok(o.xHandle);
  for (const [t, u] of (o.socialList || [])) { const mm = /^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/?(?:[?#].*)?$/i.exec(String(u || '')); if (mm && !/^(i|home|search|intent|share)$/i.test(mm[1])) return mm[1]; }
  return null;
}
const TOOL_LINKS = [
  ['RugCheck', m => 'https://rugcheck.xyz/tokens/' + m],
  ['Trench.bot', m => 'https://trench.bot/bundles/' + m + '?all=true'],
  ['Bubblemaps', m => 'https://v2.bubblemaps.io/map?address=' + m + '&chain=solana'],
  ['InsightX', m => 'https://app.insightx.network/bubblemaps/solana/' + m],
  ['GMGN', m => 'https://gmgn.ai/sol/token/' + m],
  ['Solscan', m => 'https://solscan.io/token/' + m],
  ['Kolscan (homepage)', () => 'https://kolscan.io/'],
  ['TweetScout', (m, x) => x ? 'https://app.sorsa.io/profile/' + x : 'https://app.tweetscout.io/'],
  ['DexScreener', m => 'https://dexscreener.com/solana/' + m],
  ['Birdeye', m => 'https://birdeye.so/solana/token/' + m],
  ['GeckoTerminal', m => 'https://www.geckoterminal.com/solana/tokens/' + m],
  ['HolderScan', m => 'https://holderscan.com/token/' + m],
  ['Solsniffer', m => 'https://www.solsniffer.com/scanner/' + m],
  ['Cielo (homepage)', () => 'https://app.cielo.finance/'],
  ['Fomoscan Pro (homepage)', () => 'https://terminal.fomoscan.sh/'],
];
function toolsRow(m, x) {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(m)) return '';
  return '<div class="links tools" id="toolsRow"><span class="mu small">Check in other tools:</span> ' + TOOL_LINKS.map(([n, f]) => {
    const label = n === 'TweetScout' ? (x ? 'TweetScout @' + x : 'TweetScout (homepage, no X handle)') : n;
    return `<a href="${esc(f(m, x))}" target="_blank" rel="noopener noreferrer" data-tool="${esc(n.replace(/ \(homepage\)/, ''))}">${esc(label)} &#8599;</a>`;
  }).join('') + '</div>';
}
const A = (href, txt, cls) => `<a ${cls ? 'class="' + cls + '"' : ''} href="${esc(href)}" target="_blank" rel="noopener noreferrer">${txt}</a>`;
function renderCoin() {
  if (!CUR) return; const o = buildCur(); CUR.o = o; const ev = o.ev, d = CUR.d, m = o.mint;
  const st = k => d[k] === undefined ? '<span class="mu">loading</span>' : d[k] === null ? UV : '';
  const vcls = ev.label === 'REJECTED' ? 'v-REJECTED' : ev.label === 'EARLY UNVERIFIED' ? 'v-EARLY' : ev.label === 'EARLY WATCH' ? 'v-WATCH' : 'v-CONF';
  const links = `<div class="links"><a class="jup" href="https://jup.ag/swap/SOL-${esc(m)}" target="_blank" rel="noopener noreferrer" data-jup="1">Open on Jupiter &#8599; (you sign in Phantom)</a>${A('https://dexscreener.com/solana/' + m, 'DexScreener')}${A('https://pump.fun/coin/' + m, 'pump.fun')}${A('https://solscan.io/token/' + m, 'Solscan')}${A('https://rugcheck.xyz/tokens/' + m, 'RugCheck')}${A('https://gmgn.ai/sol/token/' + m, 'GMGN')}${A('https://axiom.trade/meme/' + (o.pool || m), 'Axiom')}${o.stonk ? A('https://www.stonkfun.xyz/token/' + m, 'stonk.fun') : ''}</div>`;
  const tools = toolsRow(m, xHandleOf(o));
  const soc = (o.socialList || []).slice(0, 6).map(([t, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer nofollow">${esc(t)}</a>`).join(' ') || (o.socials === false ? 'none listed' : UV);
  const b5 = isNum(o.buys5m) ? `<span class="${o.buys5m > (o.sells5m || 0) ? 'up' : 'dn'}">${o.buys5m} / ${o.sells5m ?? '?'}</span>` : UV;
  const b1 = isNum(o.buys1h) ? `${o.buys1h} / ${o.sells1h ?? '?'}` : UV;
  const checks = ev.checks.map(c => `<tr><td><span class="pill ${c.status}">${c.status}</span></td><td class="wrap">${esc(c.rule)}</td><td class="wrap">${esc(c.detail)}</td><td class="mu small wrap">${esc(c.src)}</td></tr>`).join('');
  const parts = ev.parts.map(p => `<tr><td>${esc(p.name)}</td><td class="right">${p.pts}/${p.max}</td><td class="wrap ${p.detail.startsWith('UNVERIFIED') ? 'uv' : 'mu'}">${esc(p.detail)}</td></tr>`).join('') + ev.pen.map(p => `<tr><td class="dn">${esc(p.name)}</td><td class="right dn">${p.pts}</td><td class="wrap mu">${esc(p.detail)}</td></tr>`).join('');
  const ta = o.ta;
  const tape = Array.isArray(d.trades) ? d.trades.slice(0, 120).map(t => { const w = t.tx_from_address; const tags = []; if (w && (w === o.dev || w === o.creator)) tags.push('<span class="pill FAIL">DEV</span>'); const sb = ta?.clusterBlocks.has(String(t.block_number)) && t.kind === 'buy'; if (sb) tags.push('<span class="pill TAG">SAME-BLOCK</span>'); if (SMW.has(w)) tags.push('<span class="pill PASS">WATCH (UNVERIFIED)</span>'); if (w === ta?.topBuyer) tags.push('<span class="pill">TOP BUYER</span>'); if ((o.rcHolders || []).some(h => h.insider && h.owner === w)) tags.push('<span class="pill FAIL">INSIDER</span>'); return `<tr class="${sb ? 'sb' : ''}${tags[0]?.includes('DEV') ? ' dev' : ''}"><td>${utc(t.block_timestamp)}</td><td class="${t.kind === 'buy' ? 'up' : 'dn'}">${esc(t.kind)}</td><td>$${(+t.volume_in_usd || 0).toFixed(2)}</td><td>${A('https://solscan.io/account/' + w, esc(short(w)))}</td><td>${esc(t.block_number)}</td><td>${tags.join('')}</td></tr>`; }).join('') : '';
  const slipNote = isNum(o.liq) && o.liq > 0 && isNum(SOLPX) ? ['0.02', '0.04', '0.1'].map(s => `${s} SOL ~${((+s * SOLPX) / (o.liq / 2) * 100).toFixed(2)}%`).join(' &middot; ') + ' <span class="mu small">(price impact est., excl. fees)</span>' : UV;
  const sizeNote = isNum(o.liq) && isNum(SOLPX) ? (() => { const s = Math.min(0.04, 0.01 * o.liq / SOLPX); return s < 0.02 ? 'skip (under 0.02 SOL)' : s.toFixed(3) + ' SOL'; })() : UV;
  const dv = o.dev || o.creator;
  $('#coinBody').innerHTML = `
  <div class="box"><h4><span>${o.img ? `<img src="${esc(o.img)}" style="width:22px;height:22px;border-radius:4px;vertical-align:middle"> ` : ''}<b style="font-size:15px">${esc(o.symbol || '?')}</b> <span class="mu">${esc(o.name || '')}</span> ${o.quote ? '<span class="pill">quote ' + esc(o.quote) + '</span>' : ''} <span class="pill">${esc(o.dex || o.launchpad || 'venue UNVERIFIED')}</span></span>
    <span><button data-pin="${esc(m)}">Pin (two-look) <span class="kbd">P</span></button> <button data-paper="${esc(m)}">Paper entry <span class="kbd">J</span></button></span></h4>
    <div class="ca"><code id="caText">${esc(m)}</code><button data-copy="${esc(m)}">Copy CA</button></div>
    ${links}${tools}${o.conflict ? '<div class="TAG small">' + esc(o.conflict) + '</div>' : ''}</div>
  <div class="grid2"><div>
    <div class="box"><h4>Chart <span><button data-tf="minute:1">1m</button> <button data-tf="minute:5">5m</button> <button data-tf="minute:15">15m</button> <button data-tf="hour:1">1h</button> <button data-embed="1">DexScreener embed</button></span></h4><div id="chart">${d.gtp === null ? UV + ' (no GeckoTerminal pool)' : '<span class="mu">loading candles</span>'}</div></div>
    <div class="box"><h4>Market <span class="mu small">${esc([...o.src].join(' + '))} @ ${utc(o.at)}</span></h4><div class="kv">
      ${stat('Price', isNum(o.price) ? '$' + o.price.toPrecision(4) : UV)}${stat('Mcap', usd(o.mcap))}${stat('Liquidity', usd(o.liq))}${stat('Liq / mcap', isNum(o.liq) && isNum(o.mcap) && o.mcap ? (o.liq / o.mcap * 100).toFixed(1) + '%' : UV)}
      ${stat('Vol 5m / 1h', (isNum(o.vol5m) ? R.fmtUsd(o.vol5m) : UV) + ' / ' + (isNum(o.vol1h) ? R.fmtUsd(o.vol1h) : UV))}${stat('Buys/Sells 5m', b5)}${stat('Buys/Sells 1h', b1)}${stat('Unique buyers 5m', isNum(o.buyers5m) ? o.buyers5m + ' <span class="mu small">' + esc(o.buyersSrc || '') + '</span>' : UV)}
      ${stat('Organic (Jupiter)', isNum(o.organicScore) ? o.organicScore.toFixed(0) + '/100' + (isNum(o.organicBuyers5m) ? ', ' + o.organicBuyers5m + ' organic buyers 5m' : '') : UV)}${stat('Holders', isNum(o.holders) ? o.holders : UV)}${stat('Age', age(o.createdAt))}${stat('Curve', o.onCurve === false ? 'graduated' : isNum(o.gradPct) ? o.gradPct.toFixed(1) + '%' : o.onCurve ? 'on curve, % ' + UV : UV)}
      ${stat('5m / 1h change', (isNum(o.chg5m) ? o.chg5m.toFixed(1) + '%' : UV) + ' / ' + (isNum(o.chg1h) ? o.chg1h.toFixed(1) + '%' : UV))}${stat('Dev / creator', dv ? A('https://solscan.io/account/' + dv, esc(short(dv))) : UV)}${stat('Dev launches', isNum(o.devMints) ? o.devMints + ' minted / ' + (o.devMigrations || 0) + ' graduated' : UV)}${stat('Dev holds', isNum(o.devPct) ? o.devPct.toFixed(1) + '%' : UV)}
      ${stat('Socials', soc)}${stat('Exp. slippage', slipNote)}${stat('Size note (min 0.04 SOL, 1% liq)', sizeNote)}${o.peak ? stat('Peak mcap (stonk.fun)', R.fmtUsd(o.peak)) : ''}
    </div></div>
    <div class="box"><h4>Live trades tape <span class="mu small">GeckoTerminal last ${ta ? ta.n : 0} trades, refresh 30s while visible ${d.tradesAt ? '@ ' + utc(d.tradesAt) : ''}</span></h4>
      ${ta ? `<div class="small">buys ${ta.buys} / sells ${ta.sells} &middot; unique buyers ${ta.uniqBuyers} &middot; last 5m ${ta.b5}B/${ta.s5}S vs prior 5m ${ta.b10}B &middot; same-block clusters <b class="${ta.clusters ? 'dn' : 'up'}">${ta.clusters}</b> &middot; top buyer ${isNum(ta.topBuyerShare) ? (ta.topBuyerShare * 100).toFixed(0) + '%' : UV} of buy vol &middot; dev sold ${ta.devSold == null ? UV : ta.devSold ? '<b class="dn">YES</b>' : 'no'}${o.bundleNote ? '<br><span class="uv">' + esc(o.bundleNote) + '</span>' : ''}</div>` : ''}
      <div class="tape">${tape ? `<table><thead><tr><th>Time</th><th>Side</th><th>USD</th><th>Wallet</th><th>Block</th><th>Tags</th></tr></thead><tbody>${tape}</tbody></table>` : (d.trades === undefined && d.gtp !== null ? '<span class="mu">loading</span>' : UV)}</div>
      <p class="mu small">Same-block = 3+ different wallets buying in one block (bundle signature). Shared-first-funder trace needs a keyed RPC: UNVERIFIED here. Exchange-funded wallets can look unlinked.</p></div>
  </div><div>
    <div class="box"><div class="verdict ${vcls}">DESK VERDICT: ${esc(ev.label)}${ev.tooLate ? ' &middot; TOO LATE' : ''}</div><div class="small wrap">${esc(ev.overall)}</div>
      <div style="margin-top:6px">Early Runner score <span class="sc ${scoreCls(ev)}">${ev.score}</span> <span class="mu small">(${ev.unverifiedMax} pts unverified; a ranking, not a chance of profit)</span></div>
      <table class="small" style="margin-top:4px"><tbody>${parts}</tbody></table></div>
    <div class="box"><h4>Rule checklist</h4><table class="small"><tbody>${checks}</tbody></table></div>
    <div class="box"><h4>Holders / bubble map <span class="mu small">RugCheck ${st('rc')}</span></h4><div id="bubbles">${bubbles(o)}</div></div>
    ${typeof extrasCoinBox === 'function' ? extrasCoinBox(o) : ''}
    <div class="box"><h4>Security sources</h4><div class="small wrap">
      RugCheck: ${d.rc ? 'score ' + (o.rcScore ?? '?') + (o.rugged ? ' <b class="dn">RUGGED</b>' : '') + ' &middot; risks: ' + ((o.rcRisks || []).map(r => `<span class="pill ${r.level === 'danger' ? 'FAIL' : 'TAG'}" title="${esc(r.description)}">${esc(r.name)}</span>`).join('') || 'none listed') : st('rc') + (d.rc === null ? ' (blocked or failed from this browser)' : '')}<br>
      GoPlus: ${d.gp ? 'ok' : st('gp')} &middot; GeckoTerminal info: ${d.gti ? 'ok, gt_score ' + (o.gtScore != null ? o.gtScore.toFixed(0) : '?') + (o.gtHolders?.top_10 ? ', top10 ' + esc(o.gtHolders.top_10) + '%' : '') : st('gti')} &middot; Solana RPC: ${d.rpc ? 'ok' : st('rpc')} &middot; Jupiter: ${d.jup ? 'ok, tags ' + esc((o.tags || []).join(', ')) : st('jup')} &middot; Authorities from: ${esc(o.authSrc || 'none')}<br>
      pump.fun security_verdict: ${UV} (pump.fun API blocks browsers; a plus, not proof). Smart-money wallets: watch-only, UNVERIFIED, never decide a pass.</div></div>
  </div></div>`;
  drawChart();
}
function bubbles(o) {
  const h = o.rcHolders;
  if (!h && CUR.d.hel?.holders?.length) return '<div class="small">Helius largest token accounts (session key; may include LP/curve; linkage UNVERIFIED):</div><table class="small">' + CUR.d.hel.holders.slice(0, 20).map(x => `<tr><td>${A('https://solscan.io/account/' + (x.owner || x.address), esc(short(x.owner || x.address)))}</td><td class="right">${x.pct.toFixed(2)}%</td></tr>`).join('') + '</table>';
  if (!h) return CUR.d.rc === undefined ? '<span class="mu">loading</span>' : UV + (o.gtHolders?.top_10 ? ` <span class="small">GeckoTerminal distribution: top10 ${esc(o.gtHolders.top_10)}%, 11-30 ${esc(o.gtHolders['11_30'])}%, 31-50 ${esc(o.gtHolders['31_50'])}%, rest ${esc(o.gtHolders.rest)}% (may include LP/curve)</span>` : '');
  if (!h.length) return UV;
  const W = 340; let cx = 6, cy = 6, rowH = 0; const out = [];
  const items = h.slice(0, 20).map(t => ({ ...t, r: Math.max(7, Math.sqrt(+t.pct || 0) * 14) }));
  items.forEach(t => { if (cx + t.r * 2 > W) { cx = 6; cy += rowH + 4; rowH = 0; } t.x = cx + t.r; t.y = cy + t.r; cx += t.r * 2 + 4; rowH = Math.max(rowH, t.r * 2); });
  items.forEach(t => { const col = t.lp ? '#475569' : t.insider ? '#ef4444' : (t.owner && (t.owner === o.dev || t.owner === o.creator)) ? '#f97316' : SMW.has(t.owner) ? '#22c55e' : '#38bdf8'; out.push(`<g><title>${esc(t.owner || t.address)} ${(+t.pct || 0).toFixed(2)}%${t.lp ? ' LP/curve' : ''}${t.insider ? ' INSIDER' : ''}</title><circle cx="${t.x}" cy="${t.y}" r="${t.r}" fill="${col}" fill-opacity=".55" stroke="${col}"/><text x="${t.x}" y="${t.y + 3}" font-size="9" fill="#fff" text-anchor="middle">${(+t.pct || 0).toFixed(1)}</text></g>`); });
  const nets = (CUR.d.rc?.insiderNetworks || []).map(n => `<span class="pill FAIL">network ${esc(n.type || '')} ${esc(n.size || n.activeAccounts || '')} wallets</span>`).join('');
  return `<svg viewBox="0 0 ${W} ${cy + rowH + 8}" width="100%">${out.join('')}</svg><div class="small"><span style="color:#38bdf8">&#9679;</span> holder <span style="color:#ef4444">&#9679;</span> insider/linked <span style="color:#f97316">&#9679;</span> dev <span style="color:#22c55e">&#9679;</span> watch wallet <span style="color:#475569">&#9679;</span> LP/curve/burn &middot; top-10 ex LP: <b>${isNum(o.top10Pct) ? o.top10Pct.toFixed(1) + '%' : UV}</b> ${nets}</div>`;
}
const CHART_OPTS = h => ({ height: h, layout: { background: { color: '#0d1117' }, textColor: '#9aa7b6' }, grid: { vertLines: { color: '#161d27' }, horzLines: { color: '#161d27' } }, timeScale: { timeVisible: true, secondsVisible: false }, localization: { priceFormatter: p => p < 0.001 ? p.toExponential(3) : p.toPrecision(5) } });
const CANDLE = { upColor: '#22c55e', downColor: '#ef4444', borderVisible: false, wickUpColor: '#22c55e', wickDownColor: '#ef4444' };
const toRows = list => { const seen = new Set(); return (list || []).filter(k => !seen.has(k[0]) && seen.add(k[0])).map(k => ({ time: k[0], open: k[1], high: k[2], low: k[3], close: k[4] })).sort((a, b) => a.time - b.time); };
function drawChart() {
  const el = $('#chart'); if (!el) return;
  if (CUR?.embed) { const p = CUR.o?.pool || CUR.mint; el.innerHTML = `<iframe src="https://dexscreener.com/solana/${encodeURIComponent(p)}?embed=1&theme=dark&trades=0&info=0" style="width:100%;height:340px;border:0" loading="lazy"></iframe>`; return; }
  const data = CUR?.d.ohlcv; if (!Array.isArray(data)) return;
  if (!window.LightweightCharts) { el.innerHTML = 'Chart library failed to load; use DexScreener embed.'; return; }
  if (!data.length) { el.innerHTML = UV + ' (no candles)'; return; }
  el.innerHTML = ''; chart = LightweightCharts.createChart(el, CHART_OPTS(340));
  chart.addCandlestickSeries(CANDLE).setData(toRows(data)); chart.timeScale().fitContent();
}

/* ---------- Watch / two-look ---------- */
let WATCH = LS.get('watch', []);
const saveWatch = () => LS.set('watch', WATCH);
async function jupBatch(mints) { const out = {}; for (let i = 0; i < mints.length; i += 100) { const js = await safe(getJSON('https://lite-api.jup.ag/tokens/v2/search?query=' + mints.slice(i, i + 100).join(','), 20000)); (js || []).forEach(j => out[j.id] = j); } return out; }
const snap = j => j && isNum(num(j.usdPrice)) ? { t: Date.now(), price: num(j.usdPrice), mcap: num(j.mcap), buys: num(j.stats5m?.numBuys) ?? 0, sells: num(j.stats5m?.numSells) ?? 0, traders: num(j.stats5m?.numTraders) } : null;
async function pin(mint) {
  if (!MINT_RE.test(mint)) return; if (WATCH.some(w => w.mint === mint)) { toast('Already pinned'); return; }
  cache.delete('https://lite-api.jup.ag/tokens/v2/search?query=' + mint);
  const j = (await jupBatch([mint]))[mint]; const o = PULSE.get(mint) || (CUR?.mint === mint ? CUR.o : null) || STONK.find(x => x.mint === mint) || {};
  WATCH.push({ mint, symbol: j?.symbol || o.symbol || '?', pool: (CUR?.mint === mint && poolAddr()) || null, pinnedAt: Date.now(), look1: snap(j), look2: null, note: snap(j) ? '' : 'look 1 UNVERIFIED (Jupiter had no price)' });
  saveWatch(); renderWatch(); toast('Pinned ' + (j?.symbol || short(mint)) + ' - look 2 in 5-15 min');
}
async function checkWatch(force) {
  const now = Date.now(); const due = WATCH.filter(w => !w.look1 || (!w.look2 && (force || now - w.look1.t >= 5 * 60000)));
  if (!due.length) { renderWatch(); return; }
  due.forEach(w => cache.delete('https://lite-api.jup.ag/tokens/v2/search?query=' + w.mint));
  const js = await jupBatch(due.map(w => w.mint));
  due.forEach(w => {
    const s = snap(js[w.mint]); if (!s) { w.note = 'no price from Jupiter: UNVERIFIED'; return; }
    if (!w.look1) { w.look1 = s; w.note = ''; return; }
    const dt = now - w.look1.t;
    if (dt > 15 * 60000) { w.look1 = s; w.note = 'missed the 5-15 min window (tab closed/hidden): look 1 restarted ' + utc(now); return; }
    if (dt < 5 * 60000) { w.note = 'too soon for look 2 (' + (dt / 60000).toFixed(1) + ' min)'; return; }
    w.look2 = s; const ret = s.price / w.look1.price; const lead = s.buys > s.sells;
    w.pass = ret >= CFG.retention && lead; w.note = '';
    if (w.pass && !w.notified) { const sc = PULSE.get(w.mint)?.ev?.score; w.notified = true; notify('Two-look PASS: ' + w.symbol + ' ' + R.fmtUsd(s.mcap) + ' ' + utc(now), 'Retention ' + (ret * 100).toFixed(0) + '%, buys ' + s.buys + ' vs sells ' + s.sells + (sc != null ? ', score ' + sc : '') + '. Research only.', w.mint); }
  });
  saveWatch(); renderWatch();
}
function renderWatch() {
  $('#watchT tbody').innerHTML = WATCH.map(w => { const r = w.look2 && w.look1 ? w.look2.price / w.look1.price : null; const l = s => s ? `${R.fmtUsd(s.mcap)} @ ${utc(s.t)}` : UV; return `<tr><td><a href="#coin/${esc(w.mint)}">${esc(w.symbol)}</a> <span class="mu small">${esc(short(w.mint))}</span></td><td>${utc(w.pinnedAt)}</td><td>${l(w.look1)}</td><td>${w.look2 ? l(w.look2) : w.look1 ? '<span class="mu">due ' + utc(w.look1.t + 300000) + ' - ' + utc(w.look1.t + 900000) + '</span>' : UV}</td><td>${r != null ? `<b class="${r >= CFG.retention ? 'up' : 'dn'}">${(r * 100).toFixed(0)}%</b>` : UV}</td><td>${w.look2 ? w.look2.buys + '/' + w.look2.sells : w.look1 ? w.look1.buys + '/' + w.look1.sells : UV}</td><td class="small wrap">${w.look2 ? (w.pass ? '<span class="pill PASS">PASS</span>' : '<span class="pill FAIL">FAIL</span>') : '<span class="pill UNVERIFIED">WAITING</span>'} ${esc(w.note || '')}</td><td><button data-relook="${esc(w.mint)}">re-look</button> <button data-unpin="${esc(w.mint)}">x</button></td></tr>`; }).join('') || '<tr><td colspan="8" class="mu">Nothing pinned. Pin from Pulse, stonk.fun or a coin page.</td></tr>';
}
async function loadGrid() {
  const g = $('#grid'); g.innerHTML = ''; if (!window.LightweightCharts) { g.textContent = 'Chart library failed to load.'; return; }
  if (!WATCH.length) { g.innerHTML = '<p class="mu">Pin coins first.</p>'; return; }
  for (const w of WATCH.slice(0, 6)) {
    const box = document.createElement('div'); box.className = 'box'; box.innerHTML = `<h4><a href="#coin/${esc(w.mint)}">${esc(w.symbol)}</a><span class="mu small">5m candles, GeckoTerminal</span></h4><div class="mini"></div>`; g.appendChild(box);
    const el = box.querySelector('.mini');
    try {
      if (!w.pool) { const p = await getJSON('https://api.geckoterminal.com/api/v2/networks/solana/tokens/' + w.mint + '/pools?page=1', 60000); w.pool = p?.data?.[0]?.attributes?.address || null; saveWatch(); }
      if (!w.pool) { el.innerHTML = UV; continue; }
      const v = await getJSON(`https://api.geckoterminal.com/api/v2/networks/solana/pools/${w.pool}/ohlcv/minute?aggregate=5&limit=150&currency=usd`, 60000);
      const c = LightweightCharts.createChart(el, CHART_OPTS(200)); c.addCandlestickSeries(CANDLE).setData(toRows(v?.data?.attributes?.ohlcv_list)); c.timeScale().fitContent();
    } catch { el.innerHTML = UV; }
  }
}

/* ---------- Paper journal ---------- */
let PAPER = LS.get('paper', []);
const savePaper = () => LS.set('paper', PAPER);
function paperPnl(p) { if (!isNum(p.exit)) return null; const slip = (p.slip || 0) / 100; const net = (p.exit / p.entry) * (1 - slip) * (1 - slip); return { sol: p.size * (net - 1), pct: (net - 1) * 100 }; }
function renderPaper() {
  const today = new Date().toISOString().slice(0, 10); const open = PAPER.filter(p => !isNum(p.exit));
  const lossesToday = PAPER.filter(p => isNum(p.exit) && new Date(p.exitAt).toISOString().slice(0, 10) === today && paperPnl(p).sol < 0).length;
  $('#riskNote').innerHTML = `Open paper positions: <b class="${open.length > 1 ? 'dn' : ''}">${open.length}</b> (desk max 1) &middot; losing trades today (UTC): <b class="${lossesToday >= 2 ? 'dn' : ''}">${lossesToday}</b> ${lossesToday >= 2 ? '<b class="dn">- STOP: 2 losses today, no new risk</b>' : '(stop after 2)'}`;
  $('#paperT tbody').innerHTML = PAPER.map((p, i) => { const r = paperPnl(p); return `<tr><td>${utcFull(p.at)}</td><td><a href="#coin/${esc(p.mint)}">${esc(p.sym || short(p.mint))}</a></td><td>${p.entry.toPrecision(4)}</td><td>${p.size}</td><td>${p.slip ?? '?'}%</td><td>${isNum(p.exit) ? p.exit.toPrecision(4) + ' <span class="mu small">' + utc(p.exitAt) + '</span>' : `<input type="number" step="any" data-exitv="${i}" style="width:100px"><button data-exit="${i}">close</button>`}</td><td class="${r ? (r.sol >= 0 ? 'up' : 'dn') : ''}">${r ? r.sol.toFixed(4) : '-'}</td><td>${r ? r.pct.toFixed(1) + '%' : '-'}</td><td class="wrap small">${esc(p.note || '')}</td><td><button data-del="${i}">x</button></td></tr>`; }).join('') || '<tr><td colspan="10" class="mu">No paper trades yet.</td></tr>';
}
function prefillPaper(mint) { const o = CUR?.mint === mint ? CUR.o : (PULSE.get(mint) || STONK.find(x => x.mint === mint)); location.hash = '#paper'; $('#jMint').value = mint; $('#jSym').value = o?.symbol || ''; $('#jEntry').value = o?.price ?? ''; if (o && isNum(o.liq) && o.liq > 0 && SOLPX) $('#jSlip').value = (((+$('#jSize').value || 0.02) * SOLPX) / (o.liq / 2) * 100 + 0.5).toFixed(2); }

/* ---------- Playbook ---------- */
function renderPlaybook() {
  $('#p-playbook').innerHTML = `<h2>Desk Playbook (plain English)</h2>
  <p>This terminal is a research tool. It never touches a wallet. The default answer is <b>NO QUALIFYING TRADE</b>, and that is a success, not a failure.</p>
  <h2>1. Where we look</h2><ul><li>Target entries mostly at <b>$10k-$20k market cap</b>. Below the band is early, not a skip. Far above it goes in the <b>TOO LATE</b> bucket; never add because the displayed value already ran.</li><li>Real demand beats manufactured demand. The contract address is the identity; tickers collide and clones copy names. A louder clone is not a better coin.</li><li>Every number shows its source and a UTC time. A missing field is UNVERIFIED. If sources disagree it is a DATA CONFLICT and we use the more conservative figure.</li></ul>
  <h2>2. Hard fails (any one = REJECTED)</h2><ul><li>Mint authority or freeze authority still on.</li><li>Linked top-10 holders above ~30-35% (excluding LP and burn). Linked means shared funding, same-slot buys, or insider flags.</li><li>A deployer with a history of dead or dumped launches (serial launcher).</li><li>Honeypot, odd taxes, non-transferable tokens, permanent delegate, transfer hooks. A transfer fee is only acceptable if disclosed, tiny and not creator-controlled.</li><li>Dev selling, one buyer above a quarter of buy volume, bundled launch wallets, dead demand (no unique buyers, or sells ahead of buys).</li></ul>
  <h2>3. Tags, not kills</h2><ul><li>Liquidity under ~8-10% of mcap: a size and risk note.</li><li>Top-10 concentration without proof of linkage: a tag. Early curve coins are nearly always concentrated.</li><li>Mutable metadata caps the label at WATCH. Socials listed but not opened are unverified quality.</li></ul>
  <h2>4. Bundles and snipers</h2><ul><li>Same-slot buys, few unique buyers, dev sells on the curve, and early buyers sharing a first funder all mean <b>one entity</b>, not a crowd.</li><li>Exchange-funded wallets can look unlinked. A zero creator balance is not a pass; tokens may already have moved.</li><li>High volume with flat unique buyers is manipulation. A creation-slot bundle that includes the creator is a dump, not demand.</li></ul>
  <h2>5. Demand quality</h2><ul><li>At least 10 recent buys, buys leading sells, rising unique buyers.</li><li>Price holding: at least <b>85% retention across two looks 5-15 minutes apart</b> (Watch tab).</li><li>Real socials, actually opened. Social attention is not demand.</li></ul>
  <h2>6. Entry timing</h2><ul><li>Never enter on the first vertical candle. Prefer a pullback that holds while buys still lead.</li></ul>
  <h2>7. Exits</h2><ul><li>Exit all if sells take over after the first spike, or price is back through entry around 30 minutes.</li><li>No clock exit while buys still lead and new buyers keep arriving. Otherwise trail under the last higher low; the desk note is sell half at 2x.</li><li>Exit the rest if liquidity is pulled or the dev sells.</li></ul>
  <h2>8. Risk and wallet hygiene</h2><ul><li>Small hot wallet only; main funds stay cold. Use a burner with ~0.1 SOL for unknown sites.</li><li>Sign only on bookmarked Phantom / Jupiter. Never paste a seed phrase or private key anywhere.</li><li>Tight slippage: wide slippage gets sandwiched on pump.fun. Always check expected slippage for your clip.</li><li>Max 1 open position. Stop after 2 losing trades in a day. Paper before live. Live trades go through Cryptotrader only after <b>LIVE TRADE APPROVED</b>.</li><li>Size note: the smaller of ~0.04 SOL and 1% of visible liquidity on a ~0.5 SOL book; under 0.02 SOL, skip. Size off liquidity, never off fully diluted value.</li></ul>
  <h2>9. Smart money</h2><ul><li>Watch-only and UNVERIFIED. A plus at most, never a reason to pass. One green trade is not smart money; a wallet label needs 20-30 closed trades. Never copy a sniper: their edge is landing speed and it is already gone.</li></ul>
  <h2>10. QA discipline</h2><ul><li>Never loosen a rule because a rejected coin later pumped. Do not tighten so far that only late runners qualify.</li><li>pump.fun's own security_verdict is a plus, not proof. A high score is a ranking, not a chance of profit.</li></ul>
  <h2>How the Early Runner score works</h2><p>Demand points (max 100): unique buyers 20, recent buy count 10, buy/sell ratio 15, buy trend 10, two-look retention 20, liquidity depth 10, socials 5, desk band 10. Manufactured-demand penalties: same-block clusters, one dominant buyer, linked top-10, insiders, dev sells, sells leading, low organic score. Authority on or honeypot forces 0. Unverified inputs score 0 and are listed. Pulse cards score from aggregated data only; open the coin page for trade-level bundle and dev checks.</p>`;
}

/* ---------- settings / status ---------- */
const CFG_FIELDS = [['bandMin', 'Band min $'], ['bandMax', 'Band max $'], ['tooLateMult', 'Too-late x band max'], ['top10Max', 'Top-10 fail %'], ['top10Warn', 'Top-10 tag %'], ['liqRatioTag', 'Liq/mcap tag'], ['minRecentBuys', 'Min recent buys'], ['retention', 'Retention'], ['topBuyerShareMax', 'Max one-buyer share'], ['serialMints', 'Serial launcher mints'], ['nearGradMcap', 'Near-grad mcap $ (fallback)']];
function renderSettings() {
  $('#cfgBar').innerHTML = CFG_FIELDS.map(([k, l]) => `<label>${esc(l)} <input type="number" step="any" data-cfg="${k}" value="${esc(CFG[k])}"></label>`).join('') + '<button id="cfgSave" class="pri">Save</button> <button id="cfgReset">Reset</button>';
  $('#smw').value = [...SMW].join('\n');
}
const STATIC_SRC = [['DexPaprika', 'no CORS header for browsers: not used, UNVERIFIED'], ['pump.fun frontend-api-v3 / swap-api', 'HTTP 403 / no CORS: curve trades & security_verdict UNVERIFIED'], ['Birdeye', 'needs an API key (401): not used']];
function renderStatus() {
  const live = Object.entries(SRC).map(([n, s]) => `${esc(n)} <b class="${s.ok ? 'ok' : 'bad'}">${s.ok ? 'OK' : 'ERR ' + esc(s.err)}</b>`).join(' &middot; ');
  $('#status').innerHTML = 'Sources: ' + (live || 'none called yet') + ' &middot; ' + STATIC_SRC.map(([n]) => `${esc(n)} <b class="na">BLOCKED</b>`).join(' &middot; ') + ' &middot; all times UTC';
  const t = $('#srcT'); if (t) t.innerHTML = '<table><tr><th>Source</th><th>Status</th><th>Last</th></tr>' + Object.entries(SRC).map(([n, s]) => `<tr><td>${esc(n)}</td><td>${s.ok ? '<span class="PASS">OK</span>' : '<span class="FAIL">' + esc(s.err) + '</span>'}</td><td>${utc(s.at)}</td></tr>`).join('') + STATIC_SRC.map(([n, e]) => `<tr><td>${esc(n)}</td><td class="UNVERIFIED">${esc(e)}</td><td></td></tr>`).join('') + '</table>';
}

/* ---------- routing, events, keyboard ---------- */
const PAGES = ['pulse', 'stonk', 'coin', 'watch', 'paper', 'playbook', 'settings', 'wallets'];
function show(p) { $$('section.page').forEach(s => s.classList.toggle('on', s.id === 'p-' + p)); $$('#nav a').forEach(a => a.classList.toggle('on', a.dataset.p === p)); if (p === 'stonk' && !STONK.length) loadStonk(); if (p === 'watch') renderWatch(); if (p === 'paper') renderPaper(); if (p === 'settings') { renderSettings(); renderStatus(); } if (p === 'wallets' && typeof renderWallets === 'function') renderWallets(); }
function route() { const [p, arg] = location.hash.slice(1).split('/'); if (p === 'coin' && arg) { if (CUR?.mint !== arg) openCoin(arg); else show('coin'); } else show(PAGES.includes(p) ? p : 'pulse'); }
let SOLPX = null;
async function loadSolPx() { const v = await safe(getJSON('https://lite-api.jup.ag/price/v3?ids=' + SOL, 300000)); SOLPX = num(v?.[SOL]?.usdPrice); }
document.addEventListener('click', e => {
  const id = e.target.id;
  if (id === 'cfgSave') { $$('[data-cfg]').forEach(i => { const v = num(i.value); if (isNum(v)) CFG[i.dataset.cfg] = v; }); LS.set('cfg', CFG_FIELDS.reduce((a, [k]) => (a[k] = CFG[k], a), {})); PULSE.forEach(finalize); renderPulse(); toast('Saved'); return; }
  if (id === 'cfgReset') { localStorage.removeItem('sd_cfg'); location.reload(); return; }
  if (id === 'smwSave') { SMW = new Set($('#smw').value.split(/\s+/).filter(x => MINT_RE.test(x))); LS.set('smw', [...SMW]); toast('Saved ' + SMW.size + ' watch wallets'); return; }
  const t = e.target.closest('[data-pin],[data-unpin],[data-relook],[data-copy],[data-paper],[data-tf],[data-embed],[data-exit],[data-del],[data-jup],[data-mint]'); if (!t) return;
  if (t.dataset.pin) { e.stopPropagation(); pin(t.dataset.pin); return; }
  if (t.dataset.unpin) { WATCH = WATCH.filter(w => w.mint !== t.dataset.unpin); saveWatch(); renderWatch(); return; }
  if (t.dataset.relook) { const w = WATCH.find(x => x.mint === t.dataset.relook); if (w) { w.look1 = null; w.look2 = null; w.pass = undefined; w.notified = false; checkWatch(true); } return; }
  if (t.dataset.copy) { navigator.clipboard?.writeText(t.dataset.copy).then(() => toast('CA copied'), () => toast('Copy failed - select the text')); return; }
  if (t.dataset.paper) { prefillPaper(t.dataset.paper); return; }
  if (t.dataset.tf) { CUR.tf = t.dataset.tf; CUR.embed = false; loadOHLCV(); return; }
  if (t.dataset.embed) { CUR.embed = true; drawChart(); return; }
  if (t.dataset.exit) { const i = +t.dataset.exit; const v = num($(`[data-exitv="${i}"]`).value); if (!isNum(v)) { toast('Enter exit price'); return; } PAPER[i].exit = v; PAPER[i].exitAt = Date.now(); savePaper(); renderPaper(); return; }
  if (t.dataset.del) { PAPER.splice(+t.dataset.del, 1); savePaper(); renderPaper(); return; }
  if (t.dataset.jup) { if (!confirm('RESEARCH ONLY. This opens jup.ag in a new tab; nothing is signed here.\n\nDesk rules: paper first, live only via Cryptotrader after LIVE TRADE APPROVED, small hot wallet, tight slippage, max 1 open position, stop after 2 losses today.\n\nOpen Jupiter?')) e.preventDefault(); return; }
  if (t.dataset.mint && !e.target.closest('a,button')) openCoin(t.dataset.mint);
});
$('#go').onclick = () => openCoin($('#ca').value);
$('#ca').addEventListener('keydown', e => { if (e.key === 'Enter') openCoin($('#ca').value); });
document.addEventListener('paste', e => { if (e.target.matches('input,textarea')) return; const s = (e.clipboardData?.getData('text') || '').trim(); if (MINT_RE.test(s)) { $('#ca').value = s; openCoin(s); } });
document.addEventListener('keydown', e => {
  if (e.target.matches('input,textarea,select')) { if (e.key === 'Escape') e.target.blur(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (e.key === '/') { e.preventDefault(); $('#ca').focus(); $('#ca').select(); }
  else if (/^[1-8]$/.test(e.key)) location.hash = '#' + PAGES[+e.key - 1];
  else if (k === 'r') { const p = location.hash.slice(1).split('/')[0] || 'pulse'; if (p === 'stonk') loadStonk(); else if (p === 'coin' && CUR) { const mm = CUR.mint; CUR = null; cache.clear(); openCoin(mm); } else if (p === 'watch') checkWatch(true); else loadPulse(); }
  else if (k === 'p' && CUR && $('#p-coin').classList.contains('on')) pin(CUR.mint);
  else if (k === 'j' && CUR && $('#p-coin').classList.contains('on')) prefillPaper(CUR.mint);
});
$('#refresh').onclick = loadPulse; $('#sRefresh').onclick = loadStonk; $('#wCheck').onclick = () => checkWatch(true); $('#wCharts').onclick = loadGrid;
$('#preset').onchange = e => applyPreset(e.target.value);
['#fMin', '#fMax', '#fAll', '#fAge', '#fLiq', '#fBuys', '#fHold', '#fSoc', '#fHide', '#fSort'].forEach(s => $(s).addEventListener('input', renderPulse));
['#tChg', '#tRatio', '#tBuys', '#tUniq', '#tScore'].forEach(s => $(s).addEventListener('change', () => { LS.set('pumpTh', pumpTh()); STONK.forEach(o => o.pump = R.pumpCheck(o, o.ev, pumpTh())); renderStonk(); }));
$('#sAlert').onchange = e => { if (e.target.checked && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission(); scheduleStonk(); };
$('#sInt').onchange = () => { if (+$('#sInt').value < 30) $('#sInt').value = 30; scheduleStonk(); };
$('#sTest').onclick = () => { const go = () => notify('Test alert', 'Alerts work while this page is open.', SOL); if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().then(go); else go(); };
$('#notif').onclick = () => { if (!('Notification' in window)) { toast('Notifications not supported'); return; } Notification.requestPermission().then(p => toast('Notifications: ' + p)); };
$('#jAdd').onclick = () => { const mint = $('#jMint').value.trim(), entry = num($('#jEntry').value), size = num($('#jSize').value); if (!MINT_RE.test(mint) || !isNum(entry) || !isNum(size)) { toast('Need mint, entry and size'); return; } if (PAPER.filter(p => !isNum(p.exit)).length >= 1 && !confirm('Desk max is 1 open position. Add anyway (paper)?')) return; PAPER.push({ at: Date.now(), mint, sym: $('#jSym').value.trim().slice(0, 20), entry, size, slip: num($('#jSlip').value), note: $('#jNote').value.slice(0, 200) }); savePaper(); renderPaper(); };
const th0 = LS.get('pumpTh', null); if (th0) { $('#tChg').value = th0.chg5m; $('#tRatio').value = th0.ratio; $('#tBuys').value = th0.minBuys; $('#tUniq').value = th0.minBuyers; $('#tScore').value = th0.minScore; }
$('#fMin').value = CFG.bandMin; $('#fMax').value = CFG.bandMax;
setInterval(() => { if (!document.hidden && $('#auto').checked && $('#p-pulse').classList.contains('on')) loadPulse(); }, 60000);
setInterval(() => { if (!document.hidden && WATCH.some(w => w.look1 && !w.look2)) checkWatch(false); }, 30000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { checkWatch(false); scheduleStonk(); } });
window.addEventListener('hashchange', route);
renderPlaybook(); renderStatus(); route(); loadSolPx(); loadPulse(); checkWatch(false);
