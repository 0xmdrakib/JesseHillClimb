# Remix deployment (Base mainnet)

Deploy **two** contracts on Base mainnet:

1) `JesseHillClimbScoreboard.sol`
2) `JesseHillClimbRunNFT.sol`

## Steps

1. Open Remix.
2. Create two files and paste the contract code.
3. In "Deploy & Run Transactions":
   - Environment: **Injected Provider** (your wallet)
   - Network: **Base mainnet** (chainId 8453)
4. Deploy:
   - Scoreboard has no constructor args.
   - RunNFT has no constructor args.
5. Copy deployed addresses and put them in your `.env.local`:

```bash
NEXT_PUBLIC_SCOREBOARD_ADDRESS=0x...
NEXT_PUBLIC_RUNNFT_ADDRESS=0x...
NEXT_PUBLIC_URL=https://hillclimb.rakibhq.xyz
BASE_RPC_URL=https://YOUR_BASE_RPC_ENDPOINT
NEXT_PUBLIC_LIGHTHOUSE_GATEWAY_URL=https://protective-walrus-h5noy.lighthouseweb3.xyz/ipfs
LIGHTHOUSE_API_KEY=...
```

## Notes

- `submitScore(meters)` always emits an event, but only updates `bestMeters[address]` if the submitted meters is higher.
- `mintRun(meters, driverId, tokenURI)` mints sequential tokenIds: 1,2,3...
- The collection uses ERC-721 with name `Jesse Hill Climb` and symbol `JHC`. Driver IDs are `0` for Jesse and `1` for Brian. The contract stores distance, driver ID and token URI, and exposes no token-URI update function.
- The app computes flat artwork and metadata CIDs locally, obtains a gas-free wallet upload authorization, then uploads `run.jpg` followed by `metadata.json` through the protected preparation API. Both files must pass exact-byte and MIME checks through the paid gateway before the wallet mint transaction opens.
- New `tokenURI` and metadata `image` values use the paid gateway's HTTPS URLs with separate metadata/image CIDs. `properties.files` also records the image's `ipfs://` provenance reference.
- Canceling the upload signature prevents upload. Canceling the later mint transaction leaves any files already uploaded in storage.
- After submission, the UI confirms the actual receipt and matching `RunMinted` event. New pending records, including sponsored wallet batch IDs, are used only for confirmation; they never start another mint or upload automatically.
- Keep `LIGHTHOUSE_API_KEY` server-only. The current preparation/mint flow does not need `OPENSEA_API_KEY`; the legacy finalizer's optional refresh uses it, and it must also remain server-only if configured.
- See [Run NFT minting](../README.md#run-nft-minting) for the full flow, metadata example, environment variables, source-file map and read-only verification command.
