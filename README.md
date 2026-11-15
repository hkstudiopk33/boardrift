# Boardrift

Free strategy board games — Chess, Checkers, Go, Wallvane, Chinese Checkers and Backgammon — against AI or friends (2–6 players, online rooms).

- `public/index.html` — the whole game site (one file).
- `worker.js` — Cloudflare Worker: serves the site and runs online rooms (Durable Objects, free plan).

## Deploy (no terminal needed)
Cloudflare dashboard → **Workers & Pages → Create → Import a repository** → pick this repo → **Deploy**.
Your site and online play go live at `https://boardrift.<your-subdomain>.workers.dev`.
Every push to `main` redeploys automatically.

## SEO
Edit the commented `YOUR-DOMAIN` block near the top of `public/index.html` once you have your final domain.
