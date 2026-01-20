# Jesse Hill Climb (Mini App)

A **Hill Climb Racing–inspired** mini app prototype with:
- Proper **wheel + suspension** physics (Planck/Box2D-style wheel joints)
- Classic bright cartoony environment (original art)
- Swappable pixel heads (default: Jesse)
- Fuel + coins loop

## Run
```bash
npm install
npm run dev
```

## Notes

### Mini App publishing checklist (Base/Farcaster)
1. Deploy with **HTTPS** (Vercel/Netlify/etc.)
2. Set `NEXT_PUBLIC_URL=https://your-domain.com` (see `.env.example`)
3. Ensure `/.well-known/farcaster.json` is valid:
   - This repo includes `public/.well-known/farcaster.json`.
   - `npm run dev/build/start` runs `scripts/write-manifest.mjs` to auto-fill URLs
     from `NEXT_PUBLIC_URL` (or `VERCEL_URL`).
   - When you sign `accountAssociation`, the script **stops writing** by default
     to avoid invalidating the signature.
4. Ensure your `homeUrl` (typically `/`) includes embed metadata (this project adds
   both `fc:miniapp` and `fc:frame` in `app/layout.tsx`).

## Onchain score + mint (Base mainnet)

This project supports **optional** onchain actions shown after Game Over:
- **Save score**: `submitScore(meters)` on the Scoreboard contract
- **Mint run NFT**: `mintRun(meters, driverId, tokenURI)` on the RunNFT contract

### Setup
1. Deploy the two contracts in `/contracts` on Base mainnet (see `/contracts/README.md`).
2. Create `.env.local` based on `.env.example` and set:
   - `NEXT_PUBLIC_SCOREBOARD_ADDRESS`
   - `NEXT_PUBLIC_RUNNFT_ADDRESS`
3. Create a Pinata JWT and set `PINATA_JWT` in your deployment environment.
   - The server route `POST /api/pinata` pins the run snapshot + metadata and returns an `ipfs://...` tokenURI.

### Notes
- There is **no local best score persistence**. The "best" shown is read from the Scoreboard contract for the connected wallet.
- Transactions are **normal user-signed transactions** for now (no paymaster yet).
