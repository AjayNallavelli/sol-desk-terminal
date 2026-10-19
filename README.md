# Sol Desk Terminal

Research-only Solana meme-coin terminal: https://ajaynallavelli.github.io/sol-desk-terminal/

- **No wallet connect, no signing, no swaps.** The only trade action opens Jupiter in a new tab.
- **Not financial advice.** Live trades go through Cryptotrader only after `LIVE TRADE APPROVED`. Paper first.
- Keyless public APIs only (DexScreener, GeckoTerminal, Jupiter lite-api, RugCheck, GoPlus, Solana public RPC, stonk.fun public API). Missing data shows `UNVERIFIED`, never a guess.
- Static HTML/CSS/JS, no build step. Rules live in `rules.js` and are shared with the alert job.
- `alerts/run.mjs` + `.github/workflows/alerts.yml`: scheduled (about every 5 min, GitHub may delay) keyless scan that pushes at most 12 research pings an hour to a private ntfy topic stored as the `NTFY_TOPIC` Actions secret. Dedupe state lives on the `alerts-state` branch. GitHub disables scheduled workflows after 60 days without repo activity.
- Loop: each alerts run waits ~270s and then dispatches the next run (skipped if another alerts run is already queued or running); the 5-minute cron stays as a backup. **Kill switch:** set the repo variable `ALERTS_LOOP` to `off` (`gh variable set ALERTS_LOOP --body off -R AjayNallavelli/sol-desk-terminal`) to stop chaining; delete it or set it to anything else to resume. To stop alerts entirely, also disable the workflow in the Actions tab.
