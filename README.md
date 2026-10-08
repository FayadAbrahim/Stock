# Stock Desk

A dark-mode stock research dashboard. Type any ticker and get a 0–10 score, rating, confidence level, live options chain, insider trades, fundamentals and a trade setup (entry zone, stop-loss, T1/T2 with risk-to-reward).

**No API keys and no sign-ups for data.** A small serverless function (`api/stock.js`) pulls everything from Yahoo Finance and the page (`index.html`) displays it.

## Why Vercel instead of GitHub Pages

GitHub Pages only serves static files, and browsers are blocked from calling Yahoo directly. The function in `api/` needs a host that can run server code. Vercel's free Hobby plan does this and signs in with your GitHub account, so your code stays in GitHub.

## Deploy (about 5 minutes)

1. Create a new GitHub repo (e.g. `stock-desk`) and upload the project files so the layout is exactly:
   ```
   index.html
   package.json
   api/stock.js
   README.md
   ```
   On github.com use **Add file → Create new file**, type `api/stock.js` as the name (the slash creates the folder), and paste the contents.
2. Go to https://vercel.com, choose **Continue with GitHub**, then **Add New → Project** and import the repo.
3. Leave Framework Preset as **Other**, leave the build settings blank, and click **Deploy**.
4. Open the URL Vercel gives you. Share a ticker with `https://your-site.vercel.app/#/TSLA`.

Every push to the repo redeploys automatically.

## What the data covers

| Section | Source |
|---|---|
| Quote, 52-week range, daily history → SMAs, RSI, ATR, pivots | Yahoo chart |
| Trailing and forward P/E, EV/EBITDA, margins, ROE, cash, debt, FCF, short interest | Yahoo quote summary |
| Analyst targets and ratings mix | Yahoo |
| Insider buys/sells (Form 4) and top institutional holders | Yahoo |
| Put/call ratio, option premium, unusual strikes (nearest two expiries) | Yahoo options chain |
| Headlines and next earnings date | Yahoo |

## Scoring

Five dimensions are each scored −2 to +2, then combined as `5 + 0.5 × sum`, clamped to 0–10. Rating: ≥8 Strong Buy · ≥6.5 Buy · ≥4 Hold · ≥2.5 Sell · else Strong Sell. Confidence is High, Medium or Low depending on how many dimensions had real data.

Trade setup: entry zone from the nearest support (50/200 SMA, S1, pivot, 20-day low) or a ~0.75 ATR pullback if price is extended; stop = entry-zone low − 1 ATR; T1 = 2:1 risk-to-reward; T2 = next overhead resistance (R1–R3, 52-week high) or 3.5R.

## Known limits

- Yahoo Finance has no official public API. This uses the unofficial `yahoo-finance2` library, so Yahoo can rate-limit or change things, and an occasional "Data source error" is possible. Retry after a minute.
- Data is about 15 minutes delayed. Options volume reads 0 outside market hours, so put/call falls back to open interest.
- Congressional trades and institutional 13F *changes* are limited or missing; the app flags these in the Risks tab and links out to Capitol Trades and Fintel.
- Macro drivers are not pulled automatically.

Educational tool only, not financial advice.
