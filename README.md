# Jesse Hill Climb

Jesse Hill Climb is a physics-based hill climb racing game built as a Base App-compatible web app, with optional onchain score saving on Base.

**Live app:** https://hillclimb.rakibhq.xyz

---

## Overview

Jesse Hill Climb turns the classic hill-climb driving loop into a Base-native mini game. Players drive as far as possible across rough terrain, manage fuel, collect coins, unlock upgrades, and save their best runs onchain.

The game is designed to work inside the Base App browser and in standard web browsers. It supports mobile-friendly controls, injected wallet connection, onchain score submission, and collectible run NFTs generated from the crash snapshot.

## Features

- Physics-based hill climb gameplay with gas and brake controls
- Swappable driver heads between **Jesse** and **Brian**
- Multiple vehicles including Jeep, Drift Bike, and Sports Car
- Multiple maps with different terrain behavior, gravity, grip, and visual style
- Local coin system for vehicle unlocks and upgrades
- Upgrade categories for engine, suspension, tires, and fuel tank
- Achievement system with coin rewards
- Onchain best-score saving on Base mainnet
- Run NFT minting with locally optimized artwork and Lighthouse IPFS storage
- Base App support through standard injected wallets and the Web Share API
- Optional paymaster proxy flow for sponsored contract transactions
- Builder Code attribution support through ERC-8021 calldata suffixing

## Gameplay behavior

### Driving

Players hold **GAS** to accelerate and use **BRAKE** to control rotation. The goal is to travel as far as possible without crashing or running out of fuel.

### Vehicles

The game includes different vehicle types with separate handling profiles:

- **Jeep:** balanced off-road vehicle
- **Drift Bike:** lighter and more agile, but easier to flip
- **Sports Car:** faster, but less forgiving on rough terrain

### Maps

Players can choose from multiple environments:

- Countryside
- Desert
- Arctic
- Moon

Each map changes the driving feel through terrain, gravity, grip, fog, snow, dust, or low-gravity effects.

### Progression

Coins are stored locally and can be used to unlock vehicles and buy upgrades. Achievements reward extra coins for milestones such as first run, distance goals, flips, speed, fuel efficiency, coin collection, and map-specific challenges.

## Onchain behavior

### Score saving

After a run ends, players can connect a wallet and save their score to the deployed scoreboard contract on Base. The contract stores each player’s best distance in meters and emits an event for every score submission.

### Run NFT minting

Each NFT represents the finish of one run: its actual game snapshot, distance, driver, vehicle, map, collected coins and result. NFTs use the **ERC-721** standard on **Base mainnet (chain ID 8453)**. The contract collection name is **Jesse Hill Climb**, its symbol is **JHC**, and the connected wallet receives the minted token. Saving a score and minting an NFT are separate actions.

#### From game snapshot to collectible

The application follows this order: **local capture → wallet upload authorization → paid Lighthouse upload → verify both files → wallet mint → confirm the mint event**.

1. **Capture the finish.** When the run ends, the game captures a 960×540 landscape frame. The NFT package converts it locally to a proportional JPEG at quality `0.9`, without adding a square background or padding. The same capture/package flow handles Countryside, Desert, Arctic and Moon.
2. **Build the files locally.** The browser creates `run.jpg` and `metadata.json`, computes a separate content identifier (CID) for each, and packages their blocks into a CAR archive. A CID identifies file content; the metadata CID becomes the NFT's `tokenURI`. Building this package does not upload it.
3. **Authorize storage.** `POST /api/nft/challenge` returns a server-authenticated challenge lasting five minutes. The wallet signs a gas-free message bound to the wallet, app origin, Base chain, NFT contract, metadata CID, token URI, distance, driver and nonce. This signature authorizes storage; the later mint has its own transaction approval.
4. **Upload and verify.** The browser sends `{ challenge, signature, carBase64 }` to `POST /api/nft/prepare`. The server validates the signature, archive hashes, artwork and metadata, then uploads `run.jpg` followed by `metadata.json` to Lighthouse using the paid account's server-only API key and `X-Storage-Type: annual`. It fetches both files through the paid gateway and requires matching bytes and the expected `image/jpeg` and `application/json` content types.
5. **Request the mint.** Only verified preparation returns `ok: true` and `availability: "verified"`, with the CIDs/URLs and an expiry of at most 60 seconds. The client rechecks the current run, wallet account and expiry at the actual send boundary, then calls `mintRun(meters, driverId, tokenURI)`. Driver IDs are `0` for Jesse and `1` for Brian. A supported, configured paymaster can sponsor the transaction; otherwise the wallet sends a normal Base transaction.
6. **Confirm ownership.** The app checks a successful transaction receipt and a matching `RunMinted` event from the configured contract. That event supplies the token ID used in the OpenSea item link. Mint confirmation does not perform another storage upload.

#### Image, metadata and URLs

Lighthouse receives the image and JSON as separate files. New token URIs and the JSON's `image` field point directly to their respective CIDs on the paid gateway:

- `tokenURI`: `<paid-gateway>/<METADATA_CID>`
- `image`: `<paid-gateway>/<IMAGE_CID>`
- `properties.files[0].uri`: `ipfs://<IMAGE_CID>` as content-addressed provenance.

The new package uses flat file CIDs, so the metadata URL does **not** append `/metadata.json` to its CID. The application's upload, delivery and verification paths use the configured paid Lighthouse setup.

Example metadata for a 123-meter run (`<IMAGE_CID>` is a placeholder for the computed image CID):

```json
{
  "name": "Jesse Hill Climb — 123m Run",
  "description": "A hill-climb run captured at the finish on Base.",
  "image": "https://protective-walrus-h5noy.lighthouseweb3.xyz/ipfs/<IMAGE_CID>",
  "external_url": "https://hillclimb.rakibhq.xyz",
  "attributes": [
    { "trait_type": "Distance", "value": 123, "display_type": "number" },
    { "trait_type": "Driver", "value": "Jesse" },
    { "trait_type": "Vehicle", "value": "Jeep" },
    { "trait_type": "Terrain", "value": "Countryside" },
    { "trait_type": "Coins collected", "value": 7, "display_type": "number" },
    { "trait_type": "Result", "value": "Crash" }
  ],
  "properties": {
    "category": "image",
    "files": [{ "uri": "ipfs://<IMAGE_CID>", "type": "image/jpeg" }]
  }
}
```

Valid results are `Crash` and `Out of fuel`. The contract stores distance, driver ID and the metadata URI; the image and full descriptive metadata live in Lighthouse IPFS storage. The contract has no token-URI update function.

#### Environment configuration

Configure these variables in `.env.local` for development and in Vercel for deployment. [.env.example](.env.example) lists the variable names without secret values.

| Variable | Purpose |
|---|---|
| `BASE_RPC_URL` | Server-side HTTPS Base RPC endpoint for signature verification. |
| `NEXT_PUBLIC_URL` | Canonical HTTPS app origin, such as `https://hillclimb.rakibhq.xyz`; signed requests must originate there. |
| `NEXT_PUBLIC_RUNNFT_ADDRESS` | Deployed ERC-721 run NFT contract on Base. |
| `LIGHTHOUSE_API_KEY` | Server-only API key belonging to the paid Lighthouse account. Never prefix it with `NEXT_PUBLIC_`. |
| `NEXT_PUBLIC_LIGHTHOUSE_GATEWAY_URL` | Paid delivery gateway: `https://protective-walrus-h5noy.lighthouseweb3.xyz/ipfs`. |

The gateway setting accepts a dedicated HTTPS `*.lighthouseweb3.xyz/ipfs` host without credentials, custom ports, queries or fragments. Empty or invalid settings resolve to the supplied paid gateway. Optional sponsorship uses the existing `NEXT_PUBLIC_PAYMASTER_PROXY_SERVER_URL` and server-side `CDP_PAYMASTER_URL`. The current preparation/mint flow does not require `OPENSEA_API_KEY`; that variable is only used by the legacy finalizer's optional marketplace refresh.

#### Cancellation, pending transactions and access controls

- Canceling the upload signature stops before upload. Canceling the later mint transaction leaves already-uploaded files in storage.
- A failed upload, missing file, wrong MIME type, mismatched bytes or expired preparation stops the application before sending the mint transaction.
- Once a transaction has been submitted, **Check mint** checks that submission rather than minting again. Sponsored wallet batch IDs are retained as soon as the wallet acknowledges them, even before a transaction hash is available.
- New version-3 pending records in IndexedDB resume transaction confirmation after reload. They do not resume an upload. Older version-1/2 records are not automatically recovered or attached to a fresh run.
- Origin checks, expiring signed intent, archive/schema validation, size limits, request deadlines and per-instance wallet/IP/service quotas restrict storage access. These quotas are not distributed, and a wallet signature is not proof of genuine gameplay. The unrestricted contract can also be called directly outside the application.

Preparation verifies availability before minting; subsequent Lighthouse availability and OpenSea indexing remain external dependencies.

#### Code references and verification

| File | Responsibility |
|---|---|
| [HillClimbCanvas.tsx](components/HillClimbCanvas.tsx) | Finish-frame capture. |
| [nftPackage.ts](lib/nftPackage.ts) | JPEG compression, metadata, local CIDs and CAR package. |
| [nftPreparation.ts](lib/nftPreparation.ts) | Client authorization/upload requests and preparation checks. |
| [challenge route](app/api/nft/challenge/route.ts), [prepare route](app/api/nft/prepare/route.ts) | Protected preparation API. |
| [nftUploadAuthorization.ts](lib/nftUploadAuthorization.ts), [nftUploadMessage.ts](lib/nftUploadMessage.ts) | Server challenge, wallet authorization and shared signing message. |
| [nftStorage.ts](lib/nftStorage.ts), [lighthouseUploadTransport.ts](lib/lighthouseUploadTransport.ts), [nftGateway.ts](lib/nftGateway.ts) | Archive validation, paid uploads and exact delivery checks. |
| [page.tsx](app/page.tsx), [onchain.ts](lib/onchain.ts), [gasless.ts](lib/gasless.ts), [pendingMint.ts](lib/pendingMint.ts) | Mint UI, transaction submission, receipt confirmation and pending records. |
| [JesseHillClimbRunNFT.sol](contracts/JesseHillClimbRunNFT.sol) | ERC-721 contract and `RunMinted` event. |

Run `npm run test:nft` for the local regression suite. To inspect an existing NFT without a mint, upload or recovery, run `node scripts/verify-nft-delivery.mjs TOKEN_ID`, replacing `TOKEN_ID` with its decimal token ID. The script reads the on-chain `tokenURI`, checks the paid JSON and image responses, reports the name and image dimensions, and verifies raw SHA-256 CIDs where supported. It uses exported environment variables or its documented defaults; it does not automatically load `.env.local`.

The app's item links use `https://opensea.io/item/base/CONTRACT_ADDRESS/TOKEN_ID`. See [NFT storage and minting reliability](docs/nft-storage-research.md) for the historical investigation and [contract deployment notes](contracts/README.md) for deployment instructions.

### Gasless support

If the connected wallet supports paymaster services and the paymaster proxy is configured, score saving can use the sponsored transaction path. If sponsorship is unavailable, the app falls back to a normal wallet transaction.

## Tech stack

- Next.js 16
- React 19
- TypeScript
- planck-js
- viem
- Solidity
- Base mainnet

---

## License

This project is licensed under the [MIT License](./LICENSE).
