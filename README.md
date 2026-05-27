# Africa Gigsters — Backend + Frontend (v1.0 Foundation)

Freelance marketplace (Fiverr/Upwork-style) built on the same proven stack as The Federation:
**Node.js 18 · Express · MongoDB Atlas (Mongoose) · JWT · vanilla-JS SPA**, deployed to
Hostinger via GitHub auto-deploy.

## What's in this foundation
- `server.js` — Express entry, serves API + frontend SPA, `/api/debug` health check, rate limiting **on**
- `models/User.js` — unified buyer/seller account (any user can "Become a Gigster")
- `routes/auth.js` — register / login / me (with login rate limiter enabled from day one)
- `routes/users.js` — public profile, update profile, become-seller
- `middleware/auth.js` — JWT verification (+ adminOnly helper for later)
- `public/index.html` — landing page, auth modal, and dashboard shell, wired end-to-end
- `public/.htaccess` — SPA routing for Apache (same rule as the Federation)

## One-time setup
1. **Create a new GitHub repo** (e.g. `africa-gigsters`) and push this folder to it.
2. **MongoDB Atlas:** create a NEW database (don't reuse the Federation's). Grab the connection string.
3. **Local dev folder** (mirror the Federation layout), e.g.
   `C:\Users\Donation\OneDrive\Desktop\Africa Gigsters\gigsters-backend`
4. Copy `.env.example` → `.env` and fill in `MONGODB_URI` and a long random `JWT_SECRET`.

## Run locally
```bash
npm install
npm run dev        # nodemon, auto-restart
# open http://localhost:3000
```
Smoke test: open `http://localhost:3000/api/debug` — `MONGODB_URI` and `JWT_SECRET` should be `true`, `db` should be `connected`.

## Deploy (Hostinger, same flow as the Federation)
```powershell
cd "C:\Users\Donation\OneDrive\Desktop\Africa Gigsters\gigsters-backend"
git add .
git commit -m "Foundation: auth + user model + SPA shell"
git push
```
Then in hPanel: point a domain/subdomain at the app, set the Node app root, and restart the app.

> ⚠️ **.env gotcha (learned on the Federation):** Hostinger's Git deploy can wipe a manually
> uploaded `.env`. If env vars won't load, temporarily remove `.env` from `.gitignore` and commit
> it — but rotate `JWT_SECRET` and DB creds before the platform goes public.

## Next build phases (the marketplace core)
1. **Gig** model + routes (the Fiverr service unit: title, packages, price, delivery time, gallery)
2. Category + search + gig detail pages
3. **Order** model with escrow states (pending → in-progress → delivered → completed)
4. Reviews/ratings → seller levels
5. Buyer⇄seller messaging
6. Stripe payments + seller payouts
7. Cloudflare R2 for gig images/deliverables (reuse the Federation's upload setup)
