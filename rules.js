/* Sol Desk rule engine. Shared by the browser terminal and the GitHub Actions alert script.
   Research only. A score is a ranking, not a chance of profit. Missing data = UNVERIFIED (never guessed). */
(function (root) {
  'use strict';
  const DEFAULTS = {
    bandMin: 10000, bandMax: 20000, tooLateMult: 3,
    top10Max: 35, top10Warn: 30, liqRatioTag: 0.08, minRecentBuys: 10,
    retention: 0.85, topBuyerShareMax: 0.25, serialMints: 10, serialMigrateRate: 0.1,
    maxTransferFeeBps: 100
  };
  const isNum = v => typeof v === 'number' && isFinite(v);
  const fmtUsd = v => !isNum(v) ? 'UNVERIFIED' : v >= 1e9 ? '$' + (v / 1e9).toFixed(2) + 'B' : v >= 1e6 ? '$' + (v / 1e6).toFixed(2) + 'M' : v >= 1e3 ? '$' + (v / 1e3).toFixed(1) + 'k' : '$' + v.toFixed(v < 1 ? 6 : 0);
  const pct = v => isNum(v) ? v.toFixed(1) + '%' : 'UNVERIFIED';

  function evaluate(c, cfgIn) {
    const cfg = Object.assign({}, DEFAULTS, cfgIn || {});
    const checks = [];
    const add = (id, rule, status, detail, src) => checks.push({ id, rule, status, detail, src: src || '' });

    // ---- HARD FAILS ----
    if (c.mintAuth === true) add('mint', 'Mint authority off', 'FAIL', 'Mint authority is still ON', c.authSrc);
    else if (c.mintAuth === false) add('mint', 'Mint authority off', 'PASS', 'Mint authority disabled', c.authSrc);
    else add('mint', 'Mint authority off', 'UNVERIFIED', 'No source returned mint authority', '');
    if (c.authConflict) add('authc', 'Sources agree on authorities', 'FAIL', 'DATA CONFLICT between sources on mint/freeze authority (conservative = fail)', c.authSrc);
    if (c.freezeAuth === true) add('freeze', 'Freeze authority off', 'FAIL', 'Freeze authority is still ON', c.authSrc);
    else if (c.freezeAuth === false) add('freeze', 'Freeze authority off', 'PASS', 'Freeze authority disabled', c.authSrc);
    else add('freeze', 'Freeze authority off', 'UNVERIFIED', 'No source returned freeze authority', '');

    if (c.honeypot === true) add('honey', 'Not a honeypot / no odd token mechanics', 'FAIL', c.honeyDetail || 'Honeypot or blocking token mechanics flagged', c.honeySrc);
    else if (isNum(c.transferFeeBps) && c.transferFeeBps > cfg.maxTransferFeeBps) add('honey', 'Not a honeypot / no odd taxes', 'FAIL', 'Transfer fee ' + (c.transferFeeBps / 100) + '% (above ' + (cfg.maxTransferFeeBps / 100) + '%)', c.feeSrc);
    else if (isNum(c.transferFeeBps) && c.transferFeeBps > 0) add('honey', 'Not a honeypot / no odd taxes', 'TAG', 'Transfer fee ' + (c.transferFeeBps / 100) + '%' + (c.feeDisclosed ? ' (platform-disclosed)' : ''), c.feeSrc);
    else if (c.honeypot === false || c.transferFeeBps === 0) add('honey', 'Not a honeypot / no odd taxes', 'PASS', 'No honeypot flag, no transfer fee seen', c.honeySrc || c.feeSrc);
    else add('honey', 'Not a honeypot / no odd taxes', 'UNVERIFIED', 'Not checked by any source', '');

    // Top-10 concentration (ex LP/burn) + linkage
    if (isNum(c.top10Pct)) {
      const hi = c.top10Pct > cfg.top10Max, warn = c.top10Pct > cfg.top10Warn;
      if ((hi || warn) && c.linked === true) add('top10', 'Linked top-10 holders under 30-35% (ex LP/burn)', 'FAIL', 'Top-10 ' + pct(c.top10Pct) + ' and linked (insider/cluster evidence)', c.top10Src);
      else if (hi || warn) add('top10', 'Linked top-10 holders under 30-35% (ex LP/burn)', 'TAG', 'Top-10 ' + pct(c.top10Pct) + (c.linked === false ? ', no linkage found' : ', linkage UNVERIFIED') + (c.top10MayIncludeLp ? ' (may include LP/curve)' : ''), c.top10Src);
      else add('top10', 'Linked top-10 holders under 30-35% (ex LP/burn)', 'PASS', 'Top-10 ' + pct(c.top10Pct), c.top10Src);
    } else add('top10', 'Linked top-10 holders under 30-35% (ex LP/burn)', 'UNVERIFIED', 'Holder data not returned', '');

    if (c.insidersDetected === true) add('insider', 'No insider / bundle network', 'FAIL', c.insiderDetail || 'Insider network detected', c.insiderSrc);
    else if (isNum(c.sameBlockClusters) && c.sameBlockClusters >= 2) add('insider', 'No insider / bundle network', 'FAIL', c.sameBlockClusters + ' same-block multi-wallet buy clusters in recent trades (bundle signature)', 'GeckoTerminal trades');
    else if (isNum(c.sameBlockClusters) && c.sameBlockClusters === 1) add('insider', 'No insider / bundle network', 'TAG', '1 same-block multi-wallet buy cluster', 'GeckoTerminal trades');
    else if (c.insidersDetected === false || c.sameBlockClusters === 0) add('insider', 'No insider / bundle network', 'PASS', 'None detected in data checked (shared-funder trace UNVERIFIED)', c.insiderSrc || 'GeckoTerminal trades');
    else add('insider', 'No insider / bundle network', 'UNVERIFIED', 'Insider / bundle data not returned', '');

    if (c.devSold === true) add('dev', 'Dev has not sold', 'FAIL', 'Dev wallet sold in recent trades', 'GeckoTerminal trades');
    else if (c.devSold === false) add('dev', 'Dev has not sold', 'PASS', 'No dev sell in the trades checked', 'GeckoTerminal trades');
    else add('dev', 'Dev has not sold', 'UNVERIFIED', 'Dev trades not checked', '');

    if (isNum(c.devMints)) {
      const rate = c.devMints > 0 ? (c.devMigrations || 0) / c.devMints : 1;
      if (c.devMints >= cfg.serialMints && rate < cfg.serialMigrateRate) add('deployer', 'Deployer not a serial launcher of dead coins', 'FAIL', 'Deployer minted ' + c.devMints + ' coins, ' + (c.devMigrations || 0) + ' graduated (' + (rate * 100).toFixed(0) + '%)', 'Jupiter audit');
      else if (c.devMints >= 3) add('deployer', 'Deployer not a serial launcher of dead coins', 'TAG', 'Deployer minted ' + c.devMints + ' coins, ' + (c.devMigrations || 0) + ' graduated; dumped-or-not UNVERIFIED', 'Jupiter audit');
      else add('deployer', 'Deployer not a serial launcher of dead coins', 'PASS', 'Deployer minted ' + c.devMints + ' coin(s)', 'Jupiter audit');
    } else add('deployer', 'Deployer not a serial launcher of dead coins', 'UNVERIFIED', 'Deployer history not returned', '');

    if (isNum(c.topBuyerShare)) {
      if (c.topBuyerShare > cfg.topBuyerShareMax) add('onebuyer', 'No single buyer > 25% of buy volume', 'FAIL', 'Top buyer = ' + (c.topBuyerShare * 100).toFixed(0) + '% of buy volume', 'GeckoTerminal trades');
      else add('onebuyer', 'No single buyer > 25% of buy volume', 'PASS', 'Top buyer = ' + (c.topBuyerShare * 100).toFixed(0) + '%', 'GeckoTerminal trades');
    }

    // ---- DEMAND ----
    const buys = isNum(c.buys5m) ? c.buys5m : null, sells = isNum(c.sells5m) ? c.sells5m : null;
    const buys1h = isNum(c.buys1h) ? c.buys1h : null, sells1h = isNum(c.sells1h) ? c.sells1h : null;
    const rb = buys != null ? buys : buys1h, rs = buys != null ? sells : sells1h;
    if (rb == null) add('demand', '>=10 recent buys, buys lead sells', 'UNVERIFIED', 'No trade counts returned', '');
    else if ((c.buyers5m === 0) || (rb === 0) || (rs != null && rb <= rs && rb < cfg.minRecentBuys)) add('demand', '>=10 recent buys, buys lead sells', 'FAIL', 'Dead demand: ' + rb + ' buys vs ' + (rs ?? '?') + ' sells' + (buys == null ? ' (1h)' : ' (5m)'), c.flowSrc);
    else if (rb >= cfg.minRecentBuys && (rs == null || rb > rs)) add('demand', '>=10 recent buys, buys lead sells', 'PASS', rb + ' buys vs ' + (rs ?? 'UNVERIFIED') + ' sells' + (buys == null ? ' (1h)' : ' (5m)'), c.flowSrc);
    else add('demand', '>=10 recent buys, buys lead sells', 'TAG', rb + ' buys vs ' + (rs ?? '?') + ' sells' + (buys == null ? ' (1h)' : ' (5m)') + ' - weak', c.flowSrc);

    if (isNum(c.retention)) {
      if (c.retention >= cfg.retention && c.lookBuysLead !== false) add('retention', 'Price holds >=85% across two looks 5-15 min apart', 'PASS', 'Retention ' + (c.retention * 100).toFixed(0) + '%', 'Two-look watcher');
      else add('retention', 'Price holds >=85% across two looks 5-15 min apart', 'FAIL', 'Retention ' + (c.retention * 100).toFixed(0) + '%' + (c.lookBuysLead === false ? ', sells took over' : ''), 'Two-look watcher');
    } else add('retention', 'Price holds >=85% across two looks 5-15 min apart', 'UNVERIFIED', 'Pin the coin; the watcher takes look 2 after 5-15 min', '');

    // ---- TAGS ----
    if (isNum(c.liq) && isNum(c.mcap) && c.mcap > 0) {
      const r = c.liq / c.mcap;
      add('liq', 'Liquidity >= ~8-10% of mcap', r >= cfg.liqRatioTag ? 'PASS' : 'TAG', 'Liq/mcap ' + (r * 100).toFixed(1) + '% (' + fmtUsd(c.liq) + ')' + (r < cfg.liqRatioTag ? ' - size/risk note, not a kill' : ''), c.liqSrc);
    } else add('liq', 'Liquidity >= ~8-10% of mcap', 'UNVERIFIED', 'Liquidity not returned', '');

    if (isNum(c.mcap)) {
      if (c.mcap > cfg.bandMax * cfg.tooLateMult) add('band', 'Mcap in desk band', 'TAG', 'TOO LATE bucket: ' + fmtUsd(c.mcap) + ' is far past the band. Do not add because the displayed value ran.', c.mcapSrc);
      else if (c.mcap > cfg.bandMax) add('band', 'Mcap in desk band', 'TAG', fmtUsd(c.mcap) + ' above band', c.mcapSrc);
      else if (c.mcap < cfg.bandMin) add('band', 'Mcap in desk band', 'TAG', fmtUsd(c.mcap) + ' below band (early, not a skip)', c.mcapSrc);
      else add('band', 'Mcap in desk band', 'PASS', fmtUsd(c.mcap) + ' inside ' + fmtUsd(cfg.bandMin) + '-' + fmtUsd(cfg.bandMax), c.mcapSrc);
    } else add('band', 'Mcap in desk band', 'UNVERIFIED', 'Mcap not returned', '');

    if (c.socials === true) add('socials', 'Real socials', 'TAG', 'Links present; not opened, quality UNVERIFIED', c.socialSrc);
    else if (c.socials === false) add('socials', 'Real socials', 'TAG', 'No socials listed', c.socialSrc);
    else add('socials', 'Real socials', 'UNVERIFIED', 'Not returned', '');

    if (c.metadataMutable === true) add('meta', 'Metadata immutable', 'TAG', 'Metadata still mutable: caps the label at WATCH', c.metaSrc);
    else if (c.metadataMutable === false) add('meta', 'Metadata immutable', 'PASS', 'Immutable', c.metaSrc);

    if (c.onCurve === false && isNum(c.lpLockedPct)) {
      add('lp', 'LP burned/locked (graduated pools)', c.lpLockedPct >= 90 ? 'PASS' : c.lpLockedPct > 0 ? 'TAG' : 'FAIL', 'LP locked/burned ' + c.lpLockedPct.toFixed(0) + '%', 'RugCheck');
    } else if (c.onCurve === true) add('lp', 'LP burned/locked (graduated pools)', 'PASS', 'Still on bonding curve (no LP to pull)', c.curveSrc);
    else add('lp', 'LP burned/locked (graduated pools)', 'UNVERIFIED', 'LP status not returned', '');

    if (c.verticalCandle === true) add('timing', 'Not the first vertical candle', 'TAG', 'Last 1m candle is the biggest green bar at the high: wait for a pullback that holds while buys lead', 'OHLCV');

    // ---- SCORE (Early Runner) ----
    const parts = [], pen = [];
    const P = (name, pts, max, detail) => parts.push({ name, pts: Math.round(pts), max, detail });
    const N = (name, pts, detail) => pen.push({ name, pts: Math.round(pts), detail });
    const ub = isNum(c.buyers5m) ? c.buyers5m : null;
    if (ub != null) P('Unique buyers (5m)', Math.min(20, ub / 30 * 20), 20, ub + ' unique buyers' + (isNum(c.organicBuyers5m) ? ', ' + c.organicBuyers5m + ' organic (Jupiter)' : ''));
    else P('Unique buyers (5m)', 0, 20, 'UNVERIFIED');
    if (rb != null) P('Recent buy count', Math.min(10, rb / cfg.minRecentBuys * 10), 10, rb + ' buys');
    else P('Recent buy count', 0, 10, 'UNVERIFIED');
    if (rb != null && rs != null) { const r = rs === 0 ? (rb > 0 ? 3 : 0) : rb / rs; P('Buy/sell ratio', r >= 2 ? 15 : r >= 1.5 ? 11 : r >= 1.2 ? 7 : r > 1 ? 3 : 0, 15, r.toFixed(2) + 'x'); if (r < 1 && rb + rs > 0) N('Sells lead', -10, rb + ' vs ' + rs); }
    else P('Buy/sell ratio', 0, 15, 'UNVERIFIED');
    if (buys != null && buys1h != null && buys1h > 0) { const ratePrev = Math.max(0, buys1h - buys) / 11; const up = buys > ratePrev * 1.2; P('Buy count trend (5m vs 1h avg)', up ? 10 : buys >= ratePrev ? 5 : 0, 10, buys + ' in 5m vs ' + ratePrev.toFixed(1) + '/5m prior'); }
    else P('Buy count trend (5m vs 1h avg)', 0, 10, 'UNVERIFIED');
    if (isNum(c.retention)) P('Two-look retention', c.retention >= 1 ? 20 : c.retention >= cfg.retention ? 14 : 0, 20, (c.retention * 100).toFixed(0) + '%');
    else P('Two-look retention', 0, 20, 'UNVERIFIED (pin to take look 2)');
    if (isNum(c.liq) && isNum(c.mcap) && c.mcap > 0) { const r = c.liq / c.mcap; P('Liquidity depth', r >= 0.15 ? 10 : r >= cfg.liqRatioTag ? 7 : r * 50, 10, (r * 100).toFixed(1) + '% of mcap'); }
    else P('Liquidity depth', 0, 10, 'UNVERIFIED');
    P('Socials present', c.socials === true ? 5 : 0, 5, c.socials === true ? 'present (not opened)' : c.socials === false ? 'none' : 'UNVERIFIED');
    if (isNum(c.mcap)) P('In desk band', c.mcap >= cfg.bandMin && c.mcap <= cfg.bandMax ? 10 : c.mcap < cfg.bandMin ? 5 : c.mcap <= cfg.bandMax * cfg.tooLateMult ? 3 : 0, 10, fmtUsd(c.mcap));
    else P('In desk band', 0, 10, 'UNVERIFIED');
    // manufactured-demand penalties
    if (isNum(c.sameBlockClusters) && c.sameBlockClusters > 0) N('Same-block / bundle buys', -Math.min(25, c.sameBlockClusters * 8), c.sameBlockClusters + ' cluster(s)');
    if (isNum(c.topBuyerShare) && c.topBuyerShare > cfg.topBuyerShareMax) N('One buyer dominates', -15, (c.topBuyerShare * 100).toFixed(0) + '% of buy volume');
    if (isNum(c.top10Pct) && c.top10Pct > cfg.top10Max) N('Top-10 concentration', c.linked ? -25 : -10, pct(c.top10Pct) + (c.linked ? ' linked' : ''));
    if (c.insidersDetected === true) N('Insiders detected', -20, c.insiderDetail || 'RugCheck');
    if (c.devSold === true) N('Dev sold', -25, 'dev wallet sold');
    if (isNum(c.organicScore) && c.organicScore < 20 && ub != null && ub >= 10) N('Low organic score', -10, 'Jupiter organic ' + c.organicScore.toFixed(0) + '/100 with many "buyers"');
    let score = parts.reduce((s, p) => s + p.pts, 0) + pen.reduce((s, p) => s + p.pts, 0);
    if (c.mintAuth === true || c.freezeAuth === true || c.honeypot === true) { score = 0; N('Authority / honeypot', 0, 'score forced to 0'); }
    score = Math.max(0, Math.min(100, Math.round(score)));
    const unverifiedMax = parts.filter(p => p.detail.startsWith('UNVERIFIED')).reduce((s, p) => s + p.max, 0);

    // ---- OVERALL ----
    const fails = checks.filter(x => x.status === 'FAIL');
    const uvKey = checks.filter(x => x.status === 'UNVERIFIED' && ['mint', 'freeze', 'top10', 'demand', 'insider'].includes(x.id));
    let label, overall;
    if (fails.length) { label = 'REJECTED'; overall = 'NO QUALIFYING TRADE - failed: ' + fails.map(f => f.rule).join('; '); }
    else if (uvKey.length) { label = 'EARLY UNVERIFIED'; overall = 'Key checks UNVERIFIED: ' + uvKey.map(f => f.rule).join('; ') + '. No qualifying trade until verified.'; }
    else if (!isNum(c.retention) || c.metadataMutable === true) { label = 'EARLY WATCH'; overall = 'No hard fail seen. Needs a second look (5-15 min) before anything; paper first.'; }
    else { label = 'CONFIRMED MOMENTUM'; overall = 'Survived checks incl. two-look retention. Still research only: paper first; live only via Cryptotrader after LIVE TRADE APPROVED.'; }
    const tooLate = isNum(c.mcap) && c.mcap > cfg.bandMax * cfg.tooLateMult;
    return { checks, parts, pen, score, unverifiedMax, label, overall, fails: fails.length, tooLate };
  }

  // Pump alert rule (stonk.fun tab + Actions alert server)
  const PUMP_DEFAULTS = { chg5m: 25, ratio: 1.5, minBuyers: 8, minBuys: 10, minScore: 45 };
  function pumpCheck(c, ev, th) {
    th = Object.assign({}, PUMP_DEFAULTS, th || {});
    const why = [], miss = [];
    const t = (ok, yes, no) => (ok ? why : miss).push(ok ? yes : no);
    t(isNum(c.chg5m) && c.chg5m >= th.chg5m, '5m price +' + (c.chg5m || 0).toFixed(0) + '%', '5m change ' + (isNum(c.chg5m) ? c.chg5m.toFixed(0) + '%' : 'UNVERIFIED') + ' < ' + th.chg5m + '%');
    const b = c.buys5m, s = c.sells5m;
    t(isNum(b) && b >= th.minBuys && (isNum(s) ? (s === 0 || b / s >= th.ratio) : false), 'buys lead ' + b + '/' + s, 'buys vs sells ' + (b ?? '?') + '/' + (s ?? '?') + ' below ' + th.ratio + 'x / ' + th.minBuys + ' buys');
    t(isNum(c.buyers5m) && c.buyers5m >= th.minBuyers, c.buyers5m + ' unique buyers (5m)', 'unique buyers ' + (c.buyers5m ?? 'UNVERIFIED') + ' < ' + th.minBuyers);
    t(ev.fails === 0, 'no hard fail', 'hard fail: ' + ev.checks.filter(x => x.status === 'FAIL').map(x => x.id).join(','));
    t(ev.score >= th.minScore, 'Early Runner ' + ev.score, 'score ' + ev.score + ' < ' + th.minScore);
    return { pass: miss.length === 0, why, miss };
  }

  root.DeskRules = { DEFAULTS, PUMP_DEFAULTS, evaluate, pumpCheck, fmtUsd };
})(typeof module !== 'undefined' && module.exports ? module.exports : window);
