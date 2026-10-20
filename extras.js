/* Sol Desk extras: session keys (memory only), funder trace, Helius holder fallback, second opinions, Wallet Scout, CSV export.
   Research only. No wallet connect, no signing. No key is ever stored, put in the page URL, or logged by this code. */
'use strict';
const KEYS = (() => {
  let k = { helius: '', jupiter: '', birdeye: '', st: '' };
  return { get: n => k[n], set: o => { k = Object.assign({}, k, o); }, clear: () => { k = { helius: '', jupiter: '', birdeye: '', st: '' }; }, names: () => Object.keys(k).filter(n => k[n]) };
})();
function keyLooksUnsafe(v) { return /\s/.test(v) || v.length > 80 || /^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(v) || v.startsWith('['); }
function setKeys() {
  const map = { kHelius: 'helius', kJupiter: 'jupiter', kBirdeye: 'birdeye', kSt: 'st' }; const upd = {};
  for (const [id, n] of Object.entries(map)) {
    const el = $('#' + id), v = (el.value || '').trim(); el.value = '';
    if (!v) continue;
    if (keyLooksUnsafe(v)) { toast('Rejected ' + n + ': that looks like a seed phrase or private key. Never enter those.'); continue; }
    if (!/^[A-Za-z0-9_\-.]{8,80}$/.test(v)) { toast('Rejected ' + n + ': not an API-key shape'); continue; }
    upd[n] = v;
  }
  KEYS.set(upd); renderKeyState();
}
function renderKeyState() { const n = KEYS.names(); const el = $('#kState'); if (el) el.textContent = n.length ? 'session keys in memory: ' + n.join(', ') + ' (cleared on reload)' : 'no session keys'; const ws = $('#wSrc'); if (ws) ws.textContent = KEYS.get('helius') ? 'source: Helius Enhanced Transactions (session key)' : 'source: Solana public RPC (keyless, limited)'; }
$('#kSet').onclick = setKeys;
$('#kClear').onclick = () => { KEYS.clear(); ['#kHelius', '#kJupiter', '#kBirdeye', '#kSt'].forEach(s => $(s).value = ''); renderKeyState(); toast('Session keys cleared'); };

function jupLookup(M) { const k = KEYS.get('jupiter'); return k ? getJSON('https://api.jup.ag/tokens/v2/search?query=' + M, 20000, { headers: { 'x-api-key': k } }) : getJSON('https://lite-api.jup.ag/tokens/v2/search?query=' + M, 20000); }
function rpcCall(method, params, keyedOnly) {
  const k = KEYS.get('helius'); const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
  if (!k && keyedOnly) return Promise.reject(new Error('key required'));
  const url = k ? 'https://mainnet.helius-rpc.com/?api-key=' + encodeURIComponent(k) : 'https://api.mainnet-beta.solana.com';
  return getJSON(url, 60000, { method: 'POST', headers: { 'content-type': 'application/json' }, body }).then(r => { if (r?.error) throw new Error('RPC ' + (r.error.code || '') + ' ' + (r.error.message || '')); return r?.result; });
}

/* ---------- first funder of a wallet (Helius RPC): earliest incoming SOL transfer ---------- */
const FUNDER_CACHE = new Map();
async function firstFunder(w) {
  if (FUNDER_CACHE.has(w)) return FUNDER_CACHE.get(w);
  let before, last = null, pages = 0, exhausted = false;
  try {
    while (pages < 3) {
      const arr = await rpcCall('getSignaturesForAddress', [w, before ? { limit: 1000, before } : { limit: 1000 }], true);
      if (!Array.isArray(arr)) return { err: 'RPC returned nothing' };
      pages++; if (!arr.length) { exhausted = true; break; }
      last = arr; before = arr[arr.length - 1].signature;
      if (arr.length < 1000) { exhausted = true; break; }
    }
    if (!exhausted || !last) { const r = { err: 'history > 3000 txs: funder UNVERIFIED (older wallet)' }; FUNDER_CACHE.set(w, r); return r; }
    for (const sg of last.slice(-4).reverse()) {
      const tx = await rpcCall('getTransaction', [sg.signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }], true);
      const ins = [...(tx?.transaction?.message?.instructions || []), ...((tx?.meta?.innerInstructions || []).flatMap(x => x.instructions || []))];
      const hit = ins.find(i => i.program === 'system' && ['transfer', 'transferWithSeed', 'createAccount'].includes(i.parsed?.type) && (i.parsed.info.destination === w || i.parsed.info.newAccount === w) && i.parsed.info.source !== w);
      if (hit) { const r = { funder: hit.parsed.info.source, sol: (hit.parsed.info.lamports || 0) / 1e9, t: (tx.blockTime || 0) * 1000, sig: sg.signature }; FUNDER_CACHE.set(w, r); return r; }
    }
    const r = { err: 'no incoming SOL in the earliest transactions: UNVERIFIED' }; FUNDER_CACHE.set(w, r); return r;
  } catch (e) { return { err: e.message === 'key required' ? 'key required' : 'trace failed: ' + e.message }; }
}
function groupFunders(rows) { const g = {}; rows.forEach(r => { if (r.funder) (g[r.funder] = g[r.funder] || []).push(r.wallet); }); const groups = Object.entries(g).map(([funder, ws]) => ({ funder, wallets: ws })).sort((a, b) => b.wallets.length - a.wallets.length); return { groups, maxGroup: groups.length ? groups[0].wallets.length : 0 }; }

/* ---------- coin page: funder trace + holder fallback + second opinions ---------- */
let funderBusy = false;
async function runFunderTrace() {
  if (!CUR) return; const mint = CUR.mint;
  if (!KEYS.get('helius')) { CUR.funderState = 'KEY REQUIRED: add a free Helius key in Settings > Optional session keys. Funder trace stays UNVERIFIED.'; updateFunderBox(); return; }
  if (funderBusy) { toast('Funder trace already running'); return; }
  const tr = CUR.d.trades; if (!Array.isArray(tr) || !tr.length) { CUR.funderState = 'No GeckoTerminal trades tape for this coin: UNVERIFIED'; updateFunderBox(); return; }
  const buyers = []; [...tr].reverse().forEach(t => { if (t.kind === 'buy' && t.tx_from_address && !buyers.includes(t.tx_from_address)) buyers.push(t.tx_from_address); });
  const list = buyers.slice(0, 20); const rows = []; funderBusy = true;
  try {
    for (const w of list) { if (CUR?.mint !== mint) return; CUR.funderState = 'tracing ' + rows.length + '/' + list.length + ' ...'; updateFunderBox(); rows.push(Object.assign({ wallet: w }, await firstFunder(w))); }
    const g = groupFunders(rows);
    CUR.funder = { rows, groups: g.groups, maxGroup: g.maxGroup, traced: rows.filter(r => r.funder).length, at: Date.now() };
    CUR.funderState = 'done @ ' + utc(Date.now()) + ' (earliest ' + list.length + ' buyers in the last ' + tr.length + ' trades; true launch buyers may be older than the tape)';
  } finally { funderBusy = false; }
  renderCoin();
}
async function heliusHolders(mint) {
  CUR.d.hel = { loading: true };
  try {
    const [la, sup] = [await rpcCall('getTokenLargestAccounts', [mint], true), await rpcCall('getTokenSupply', [mint], true)];
    const total = +sup?.value?.uiAmount || 0; const accs = (la?.value || []).slice(0, 20);
    const own = accs.length ? await rpcCall('getMultipleAccounts', [accs.map(a => a.address), { encoding: 'jsonParsed' }], true) : null;
    const holders = accs.map((a, i) => ({ address: a.address, owner: own?.value?.[i]?.data?.parsed?.info?.owner || null, pct: total ? (+a.uiAmount || 0) / total * 100 : 0 }));
    if (CUR?.mint === mint) { CUR.d.hel = { holders }; renderCoin(); }
  } catch (e) { if (CUR?.mint === mint) { CUR.d.hel = { err: e.message }; renderCoin(); } }
}
function summarize(v) {
  if (v == null) return UV;
  const d = v.data ?? v; const out = [];
  if (Array.isArray(d)) out.push('<div>' + d.length + ' rows</div>');
  const obj = Array.isArray(d) ? (d[0] || {}) : d;
  Object.entries(obj || {}).slice(0, 14).forEach(([k, x]) => { if (x == null || typeof x !== 'object') out.push(`<div><span class="mu">${esc(k)}</span> ${esc(String(x).slice(0, 60))}</div>`); else if (Array.isArray(x)) out.push(`<div><span class="mu">${esc(k)}</span> [${x.length}]</div>`); });
  return out.join('') || esc(JSON.stringify(d).slice(0, 300));
}
async function secondOpinion(which) {
  if (!CUR) return; const m = CUR.mint; CUR.so = CUR.so || {};
  const cfg = { st: ['st', 'https://data.solanatracker.io/tokens/' + m + '/bundlers', k => ({ 'x-api-key': k })], be: ['birdeye', 'https://public-api.birdeye.so/defi/v3/token/holder?address=' + m + '&offset=0&limit=20', k => ({ 'X-API-KEY': k, 'x-chain': 'solana' })] }[which];
  const k = KEYS.get(cfg[0]); if (!k) { CUR.so[which] = 'KEY REQUIRED (Settings > Optional session keys): UNVERIFIED'; updateFunderBox(); return; }
  CUR.so[which] = 'loading...'; updateFunderBox();
  try { const v = await getJSON(cfg[1], 120000, { headers: cfg[2](k) }); if (CUR?.mint === m) { CUR.so[which] = { v }; updateFunderBox(); } }
  catch (e) { if (CUR?.mint === m) { CUR.so[which] = 'failed: ' + e.message + ' (UNVERIFIED)'; updateFunderBox(); } }
}
function funderBoxInner() {
  const f = CUR.funder, st = CUR.funderState || (KEYS.get('helius') ? 'ready (one coin, button press only)' : 'KEY REQUIRED for funder trace (Settings > Optional session keys)');
  const so = k => { const v = CUR.so?.[k]; return v == null ? '<span class="mu">not run</span>' : typeof v === 'string' ? esc(v) : summarize(v.v); };
  const rows = f ? f.rows.map(r => { const grp = r.funder ? f.groups.find(g => g.funder === r.funder) : null; const n = grp ? grp.wallets.length : 0; const dev = r.funder && (r.funder === CUR.o?.dev || r.funder === CUR.o?.creator); return `<tr><td>${A('https://solscan.io/account/' + r.wallet, esc(short(r.wallet)))}</td><td>${r.funder ? A('https://solscan.io/account/' + r.funder, esc(short(r.funder))) + (dev ? ' <span class="pill FAIL">DEV</span>' : '') : '<span class="uv">' + esc(r.err || 'UNVERIFIED') + '</span>'}</td><td>${r.funder ? r.sol.toFixed(3) + ' SOL' : ''}</td><td>${n >= 2 ? '<span class="pill ' + (n >= 3 ? 'FAIL' : 'TAG') + '">shared x' + n + '</span>' : ''}</td></tr>`; }).join('') : '';
  return `<h4>Funder trace &amp; second opinions <span><button data-x="funder">Run funder trace (Helius)</button> <button data-x="st">Solana Tracker bundlers</button> <button data-x="be">Birdeye holders</button></span></h4>
  <div class="small wrap">Status: <span id="funderState">${esc(st)}</span></div>
  ${f ? `<div class="small">Traced ${f.traced}/${f.rows.length} early buyers &middot; largest shared-funder group <b class="${f.maxGroup >= 3 ? 'dn' : f.maxGroup === 2 ? '' : 'up'}">${f.maxGroup}</b> &middot; a shared funder = one entity. Exchange-funded wallets can look unlinked (a shared exchange hot wallet can also look linked).</div><div class="tape" style="max-height:220px"><table class="small"><thead><tr><th>Buyer</th><th>First funder</th><th>Amount</th><th>Group</th></tr></thead><tbody>${rows}</tbody></table></div>` : ''}
  <div class="small" style="margin-top:4px"><b>Solana Tracker bundlers:</b> ${so('st')}</div><div class="small"><b>Birdeye holders:</b> ${so('be')}</div>
  <div class="small mu">Holder fallback (Helius getTokenLargestAccounts): ${CUR.d.hel?.holders ? 'loaded, ' + CUR.d.hel.holders.length + ' accounts' : CUR.d.hel?.err ? 'failed: ' + esc(CUR.d.hel.err) : KEYS.get('helius') ? (CUR.d.rc ? 'not needed (RugCheck ok)' : 'pending') : 'needs Helius key: UNVERIFIED'}</div>`;
}
function extrasCoinBox(o) {
  if (CUR && KEYS.get('helius') && CUR.d.rc === null && CUR.d.hel === undefined) setTimeout(() => CUR && CUR.d.hel === undefined && heliusHolders(CUR.mint), 0);
  return `<div class="box" id="funderBox">${funderBoxInner()}</div>`;
}
function updateFunderBox() { const b = $('#funderBox'); if (b) b.innerHTML = funderBoxInner(); }

/* ---------- Wallet Scout ---------- */
let WALLETS = LS.get('wallets', null);
if (!Array.isArray(WALLETS)) WALLETS = [...SMW].map(a => ({ address: a, label: 'smart money (watch-only, UNVERIFIED)', added: Date.now() }));
const saveWallets = () => LS.set('wallets', WALLETS);
const WSCAN = {}; // address -> scan result (memory only)
const WSOL = 'So11111111111111111111111111111111111111112';
const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const dur = ms => ms == null ? UV : ms < 60000 ? (ms / 1000).toFixed(0) + 's' : ms < 3600000 ? (ms / 60000).toFixed(1) + 'm' : (ms / 3600000).toFixed(1) + 'h';
function normHelius(w, list) {
  return (list || []).map(t => {
    const deltas = {}; (t.tokenTransfers || []).forEach(x => { const a = +x.tokenAmount || 0; if (x.toUserAccount === w) deltas[x.mint] = (deltas[x.mint] || 0) + a; if (x.fromUserAccount === w) deltas[x.mint] = (deltas[x.mint] || 0) - a; });
    let sol = ((t.accountData || []).find(a => a.account === w)?.nativeBalanceChange || 0) / 1e9;
    if (deltas[WSOL]) { sol += deltas[WSOL]; delete deltas[WSOL]; }
    return { sig: t.signature, t: (t.timestamp || 0) * 1000, sol, deltas, type: t.type || '', src: t.source || '' };
  });
}
function normRpc(w, tx, sig) {
  if (!tx) return null; const keys = (tx.transaction?.message?.accountKeys || []).map(k => k.pubkey || k); const i = keys.indexOf(w);
  let sol = i >= 0 ? ((tx.meta?.postBalances?.[i] || 0) - (tx.meta?.preBalances?.[i] || 0)) / 1e9 : 0;
  const deltas = {}; const amt = b => +b.uiTokenAmount?.uiAmount || 0;
  (tx.meta?.postTokenBalances || []).filter(b => b.owner === w).forEach(b => deltas[b.mint] = (deltas[b.mint] || 0) + amt(b));
  (tx.meta?.preTokenBalances || []).filter(b => b.owner === w).forEach(b => deltas[b.mint] = (deltas[b.mint] || 0) - amt(b));
  Object.keys(deltas).forEach(m => { if (Math.abs(deltas[m]) < 1e-12) delete deltas[m]; });
  if (deltas[WSOL]) { sol += deltas[WSOL]; delete deltas[WSOL]; }
  return { sig, t: (tx.blockTime || 0) * 1000, sol, deltas, type: tx.meta?.err ? 'FAILED' : '', src: 'rpc' };
}
function analyzeWallet(txs, created) {
  const ev = []; let solIn = 0, solOut = 0;
  txs.forEach(t => { if (t.sol > 0) solIn += t.sol; else solOut -= t.sol; const ms = Object.keys(t.deltas); ms.forEach(m => { const d = t.deltas[m]; const kind = d > 0 && t.sol < 0 ? 'buy' : d < 0 && t.sol > 0 ? 'sell' : d > 0 ? 'in' : 'out'; ev.push({ ...t, mint: m, d, kind, solLeg: ms.length === 1 ? t.sol : null }); }); if (!ms.length) ev.push({ ...t, mint: null, d: 0, kind: t.sol > 0 ? 'SOL in' : t.sol < 0 ? 'SOL out' : 'other' }); });
  const per = {}; ev.filter(e => e.mint && (e.kind === 'buy' || e.kind === 'sell')).forEach(e => { const p = per[e.mint] = per[e.mint] || { b: 0, s: 0, cost: 0, proc: 0, fb: null, fs: null }; if (e.kind === 'buy') { p.b += e.d; p.cost += -(e.solLeg || 0); p.fb = Math.min(p.fb ?? e.t, e.t); } else { p.s += -e.d; p.proc += e.solLeg || 0; p.fs = Math.min(p.fs ?? e.t, e.t); } });
  const closed = Object.entries(per).filter(([, p]) => p.b > 0 && p.s >= 0.9 * p.b && p.fs >= p.fb);
  const realized = closed.reduce((a, [, p]) => a + p.proc - p.cost, 0);
  const holds = closed.map(([, p]) => p.fs - p.fb); const wins = closed.filter(([, p]) => p.proc > p.cost).length;
  const entries = Object.entries(per).filter(([m, p]) => p.fb && created[m]).map(([m, p]) => p.fb - created[m]).filter(x => x >= 0);
  const mh = median(holds), me = median(entries);
  let pattern = 'UNVERIFIED (' + closed.length + ' closed trades < 20)';
  if (closed.length >= 20) pattern = me != null && me < 60000 && mh != null && mh < 300000 ? 'SNIPER (do not copy)' : mh != null && mh > 3600000 ? 'HOLDER' : 'MIXED / no clear habit';
  return { ev, solIn, solOut, buys: ev.filter(e => e.kind === 'buy').length, sells: ev.filter(e => e.kind === 'sell').length, closed: closed.length, wins, realized, medianHold: mh, medianEntry: me, pattern, mints: Object.keys(per) };
}
async function scanWallet(w) {
  const r = WSCAN[w.address] = Object.assign(WSCAN[w.address] || {}, { busy: true, err: '' }); renderWallets();
  try {
    let txs; const k = KEYS.get('helius');
    if (k) { const list = await getJSON('https://api-mainnet.helius-rpc.com/v0/addresses/' + w.address + '/transactions?api-key=' + encodeURIComponent(k) + '&limit=100', 60000); txs = normHelius(w.address, list); r.src = 'Helius Enhanced (100 tx)'; }
    else {
      const sigs = await rpcCall('getSignaturesForAddress', [w.address, { limit: 15 }]); r.lastSig = sigs?.[0]?.blockTime ? sigs[0].blockTime * 1000 : null; txs = [];
      for (const sg of (sigs || []).slice(0, 10)) { try { txs.push(normRpc(w.address, await rpcCall('getTransaction', [sg.signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }]), sg.signature)); } catch { } }
      txs = txs.filter(Boolean); r.src = 'Solana public RPC (keyless, ' + txs.length + ' tx)';
    }
    const mints = [...new Set(txs.flatMap(t => Object.keys(t.deltas)))].slice(0, 100); const created = {}; r.sym = r.sym || {};
    if (mints.length) { const js = await safe(getJSON('https://lite-api.jup.ag/tokens/v2/search?query=' + mints.join(','), 60000)); (js || []).forEach(j => { created[j.id] = Date.parse(j.firstPool?.createdAt || j.createdAt) || null; r.sym[j.id] = j.symbol; }); }
    r.txs = txs; r.a = analyzeWallet(txs, created); r.at = Date.now(); r.last = txs[0]?.t || r.lastSig || null;
  } catch (e) { r.err = /key required/.test(e.message) ? 'key required' : 'UNVERIFIED: ' + e.message + (KEYS.get('helius') ? '' : ' (public RPC often rate-limits / 403; add a free Helius session key)'); }
  r.busy = false; renderWallets(); if (SEL === w.address) renderWalletDetail();
}
async function traceWallets() {
  if (!KEYS.get('helius')) { toast('Funder trace needs a session Helius key (Settings)'); WALLETS.forEach(w => { const r = WSCAN[w.address] = WSCAN[w.address] || {}; r.funder = { err: 'key required' }; }); renderWallets(); return; }
  for (const w of WALLETS) { const r = WSCAN[w.address] = WSCAN[w.address] || {}; r.funder = { err: 'tracing...' }; renderWallets(); r.funder = await firstFunder(w.address); renderWallets(); }
}
function clusterOf(addr) { const f = WSCAN[addr]?.funder?.funder; if (!f) return null; return WALLETS.filter(w => w.address !== addr && WSCAN[w.address]?.funder?.funder === f).map(w => w.label || short(w.address)); }
let SEL = null;
function renderWallets() {
  const tb = $('#walletT tbody'); if (!tb) return; renderKeyState();
  tb.innerHTML = WALLETS.map(w => { const r = WSCAN[w.address] || {}, a = r.a; const cl = clusterOf(w.address); const f = r.funder;
    return `<tr><td><a href="#" data-wsel="${esc(w.address)}"><b>${esc(w.label || 'wallet')}</b></a> <span class="mu small">${esc(short(w.address))}</span> <span class="wlinks small">${A('https://solscan.io/account/' + w.address, 'Solscan')} ${A('https://gmgn.ai/sol/address/' + w.address, 'GMGN')} ${A('https://kolscan.io/account/' + w.address, 'Kolscan')} ${A('https://app.cielo.finance/profile/' + w.address, 'Cielo')}</span></td><td>${r.busy ? 'scanning...' : r.err ? '<span class="uv">' + esc(r.err) + '</span>' : r.last ? utcFull(r.last) : UV}</td><td>${r.txs ? r.txs.length : UV}</td><td>${a ? a.buys + ' / ' + a.sells : UV}</td><td>${a ? a.solIn.toFixed(3) + ' / ' + a.solOut.toFixed(3) : UV}</td><td>${a ? a.closed : UV}</td><td>${a ? `<span class="${a.realized >= 0 ? 'up' : 'dn'}">${a.realized.toFixed(3)}</span>${a.closed < 20 ? ' <span class="uv">small sample</span>' : ''}` : UV}</td><td>${a ? dur(a.medianHold) : UV}</td><td class="small">${a ? esc(a.pattern) : UV}</td><td class="small">${f ? (f.funder ? A('https://solscan.io/account/' + f.funder, esc(short(f.funder))) + (cl?.length ? ' <span class="pill FAIL">cluster with ' + esc(cl.join(', ')) + '</span>' : '') : '<span class="uv">' + esc(f.err) + '</span>') : '<span class="mu">not traced</span>'}</td><td><button data-wscan="${esc(w.address)}">scan</button> <button data-wdel="${esc(w.address)}">x</button></td></tr>`; }).join('') || '<tr><td colspan="11" class="mu">No wallets. Add a public address above.</td></tr>';
}
function renderWalletDetail() {
  const box = $('#walletDetail'); const w = WALLETS.find(x => x.address === SEL); if (!box || !w) { if (box) box.innerHTML = ''; return; }
  const r = WSCAN[w.address] || {}, a = r.a; const cl = clusterOf(w.address);
  const chk = (st, rule, det) => `<tr><td><span class="pill ${st}">${st}</span></td><td>${esc(rule)}</td><td class="wrap">${det}</td></tr>`;
  const perf = !a ? chk('UNVERIFIED', 'Realized performance', 'not scanned') : a.closed >= 20 ? chk(a.realized > 0 ? 'PASS' : 'TAG', 'Realized performance', `${a.closed} closed trades, ${a.wins} winners, realized ${a.realized.toFixed(3)} SOL (approx: swap SOL legs only, fees included)`) : chk('UNVERIFIED', 'Realized performance', `${a.closed} closed trades in ${r.txs.length} txs: need 20+ before judging (raw realized ${a.realized.toFixed(3)} SOL). One green trade is not smart money.`);
  const tim = !a ? chk('UNVERIFIED', 'Entry timing', 'not scanned') : a.medianEntry == null ? chk('UNVERIFIED', 'Entry timing', 'token creation times not returned') : chk(a.medianEntry < 60000 ? 'TAG' : 'PASS', 'Entry timing', 'median ' + dur(a.medianEntry) + ' after pool creation' + (a.medianEntry < 60000 ? ' (creation-slot style: sniper fingerprint)' : ''));
  const clu = !r.funder ? chk('UNVERIFIED', 'Clusters (shared first funder)', 'run "Trace funders" (needs session Helius key)') : !r.funder.funder ? chk('UNVERIFIED', 'Clusters (shared first funder)', esc(r.funder.err)) : cl?.length ? chk('FAIL', 'Clusters (shared first funder)', 'same funder as ' + esc(cl.join(', ')) + ': treat as one entity') : chk('PASS', 'Clusters (shared first funder)', 'no shared funder among scouted wallets (exchange-funded wallets can look unlinked)');
  const pat = chk(a && a.closed >= 20 ? 'TAG' : 'UNVERIFIED', 'Pattern label', a ? esc(a.pattern) + (/SNIPER/.test(a.pattern) ? ' - never copy a sniper; their edge is landing speed' : '') : 'not scanned');
  const rows = (a?.ev || []).slice(0, 80).map(e => `<tr><td>${utc(e.t)}</td><td class="${e.kind === 'buy' || e.kind === 'SOL in' ? 'up' : e.kind === 'sell' || e.kind === 'SOL out' ? 'dn' : 'mu'}">${esc(e.kind)}</td><td>${e.mint ? `<a href="#coin/${esc(e.mint)}">${esc(r.sym?.[e.mint] || short(e.mint))}</a>` : ''}</td><td>${e.mint ? (+e.d).toPrecision(4) : ''}</td><td>${e.sol.toFixed(4)}</td><td>${esc(e.type)}</td><td>${A('https://solscan.io/tx/' + e.sig, esc(short(e.sig)))}</td></tr>`).join('');
  box.innerHTML = `<div class="grid2"><div class="box"><h4>${esc(w.label)} <span class="mu small">${esc(w.address)} &middot; ${esc(r.src || 'not scanned')} ${r.at ? '@ ' + utc(r.at) : ''}</span></h4><div class="tape"><table class="small"><thead><tr><th>Time</th><th>Kind</th><th>Token</th><th>Token delta</th><th>SOL delta</th><th>Type</th><th>Tx</th></tr></thead><tbody>${rows || '<tr><td colspan="7">' + UV + '</td></tr>'}</tbody></table></div></div>
  <div class="box"><h4>Wallet checklist (watch-only, never decides a pass)</h4><table class="small"><tbody>${perf}${tim}${clu}${pat}</tbody></table><p class="mu small">Buy = token in with SOL out in the same tx; sell = token out with SOL in. Multi-token txs have no SOL leg per token. Transfers are not trades. Labels need 20-30 closed trades.</p></div></div>`;
}
$('#wAdd').onclick = () => { const a = $('#wAddr').value.trim(); if (!MINT_RE.test(a)) { toast('Not a valid Solana address'); return; } if (WALLETS.some(w => w.address === a)) { toast('Already added'); return; } WALLETS.push({ address: a, label: $('#wLabel').value.trim().slice(0, 40) || 'wallet', added: Date.now() }); saveWallets(); $('#wAddr').value = ''; $('#wLabel').value = ''; renderWallets(); };
$('#wScanAll').onclick = async () => { for (const w of WALLETS) await scanWallet(w); };
$('#wTrace').onclick = traceWallets;

/* ---------- CSV export ---------- */
function csvCell(v) { if (v == null) return ''; let s = String(v); if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?(e-?\d+)?$/i.test(s)) s = "'" + s; return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
function toCSV(head, rows) { return [head, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n'; }
const iso = t => t ? new Date(t).toISOString() : '';
function buildCSV(kind) {
  if (kind === 'watch') return toCSV(['mint', 'symbol', 'pinned_utc', 'look1_utc', 'look1_price_usd', 'look1_mcap_usd', 'look1_buys5m', 'look1_sells5m', 'look2_utc', 'look2_price_usd', 'look2_mcap_usd', 'look2_buys5m', 'look2_sells5m', 'retention', 'two_look', 'note'], WATCH.map(w => [w.mint, w.symbol, iso(w.pinnedAt), iso(w.look1?.t), w.look1?.price, w.look1?.mcap, w.look1?.buys, w.look1?.sells, iso(w.look2?.t), w.look2?.price, w.look2?.mcap, w.look2?.buys, w.look2?.sells, w.look1 && w.look2 ? (w.look2.price / w.look1.price).toFixed(4) : '', w.look2 ? (w.pass ? 'PASS' : 'FAIL') : 'UNVERIFIED', w.note || '']));
  if (kind === 'paper') return toCSV(['opened_utc', 'mint', 'symbol', 'entry_usd', 'size_sol', 'expected_slippage_pct', 'exit_usd', 'exit_utc', 'pnl_sol', 'pnl_pct', 'note', 'type'], PAPER.map(p => { const r = paperPnl(p); return [iso(p.at), p.mint, p.sym, p.entry, p.size, p.slip, p.exit ?? '', iso(p.exitAt), r ? r.sol.toFixed(6) : '', r ? r.pct.toFixed(2) : '', p.note, 'PAPER']; }));
  if (kind === 'wallets') return toCSV(['address', 'label', 'added_utc', 'source', 'scanned_utc', 'last_activity_utc', 'txs_read', 'buys', 'sells', 'sol_in', 'sol_out', 'closed_trades', 'realized_sol_approx', 'median_hold_sec', 'median_entry_after_creation_sec', 'pattern', 'first_funder', 'funder_note'], WALLETS.map(w => { const r = WSCAN[w.address] || {}, a = r.a; return [w.address, w.label, iso(w.added), r.src || 'UNVERIFIED', iso(r.at), iso(r.last), r.txs?.length ?? '', a?.buys ?? '', a?.sells ?? '', a ? a.solIn.toFixed(6) : '', a ? a.solOut.toFixed(6) : '', a?.closed ?? '', a ? a.realized.toFixed(6) : '', a?.medianHold != null ? (a.medianHold / 1000).toFixed(0) : '', a?.medianEntry != null ? (a.medianEntry / 1000).toFixed(0) : '', a?.pattern || 'UNVERIFIED', r.funder?.funder || '', r.funder?.err || '']; }));
  return '';
}
function downloadCSV(kind) { const csv = buildCSV(kind); const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); const a = document.createElement('a'); a.href = url; a.download = `sol-desk-${kind}-${new Date().toISOString().slice(0, 10)}.csv`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000); toast('Exported ' + kind + ' CSV'); }

document.addEventListener('click', e => {
  const t = e.target.closest('[data-x],[data-csv],[data-wscan],[data-wdel],[data-wsel]'); if (!t) return;
  if (t.dataset.x === 'funder') runFunderTrace(); else if (t.dataset.x) secondOpinion(t.dataset.x);
  else if (t.dataset.csv) downloadCSV(t.dataset.csv);
  else if (t.dataset.wscan) { const w = WALLETS.find(x => x.address === t.dataset.wscan); if (w) { SEL = w.address; scanWallet(w); } }
  else if (t.dataset.wdel) { WALLETS = WALLETS.filter(x => x.address !== t.dataset.wdel); saveWallets(); delete WSCAN[t.dataset.wdel]; renderWallets(); }
  else if (t.dataset.wsel) { e.preventDefault(); SEL = t.dataset.wsel; renderWalletDetail(); }
});
saveWallets(); renderKeyState(); if (location.hash.startsWith('#wallets')) renderWallets();
