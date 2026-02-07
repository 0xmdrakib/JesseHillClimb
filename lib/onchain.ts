"use client";

import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  parseEther,
  type Address,
} from "viem";
import { base } from "viem/chains";

import {
  getEthereumProvider,
  requestAccounts,
  getAccounts,
  getChainId,
  type Eip1193Provider,
  type EthereumProviderOptions,
} from "@/lib/wallet";
import { scoreboardAbi, runNftAbi } from "@/lib/onchainAbi";

const BASE_CHAIN_ID = 8453;
const BASE_CHAIN_ID_HEX = "0x2105";

function getBaseRpcUrl() {
  const env = (process.env.NEXT_PUBLIC_BASE_RPC_URL ?? "").trim();
  return env || "https://mainnet.base.org";
}

const publicClient = createPublicClient({
  chain: base,
  transport: http(getBaseRpcUrl()),
});

export async function ensureBaseMainnet(provider?: Eip1193Provider) {
  const p = provider ?? (await getEthereumProvider());
  if (!p) throw new Error("No wallet provider found");

  const chainId = await getChainId(p);
  if (chainId === BASE_CHAIN_ID) return;

  try {
    await p.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: BASE_CHAIN_ID_HEX }],
    });
  } catch (err: any) {
    const code = err?.code ?? err?.data?.originalError?.code;
    if (code !== 4902) {
      const msg = err?.message ? String(err.message) : "Failed to switch network";
      throw new Error(msg);
    }

    await p.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: BASE_CHAIN_ID_HEX,
          chainName: "Base",
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          rpcUrls: [getBaseRpcUrl()],
          blockExplorerUrls: ["https://basescan.org"],
        },
      ],
    });

    await p.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: BASE_CHAIN_ID_HEX }],
    });
  }
}

export async function connectWallet(
  opts?: EthereumProviderOptions,
): Promise<{ provider: Eip1193Provider; address: Address }> {
  const provider = await getEthereumProvider(opts);
  if (!provider) throw new Error("No wallet provider found");

  // Prefer a silent check first (no popups).
  const existing = await getAccounts(provider);
  const a0 = existing?.[0];
  if (a0) return { provider, address: a0 as Address };

  // Otherwise, request accounts (may prompt).
  const requested = await requestAccounts(provider);
  const r0 = requested?.[0];
  if (!r0) throw new Error("Wallet connection rejected");

  return { provider, address: r0 as Address };
}

type ConnectedWallet = { provider: Eip1193Provider; address: Address };
let cachedWallet: ConnectedWallet | null = null;

/**
 * Cache the connected wallet to avoid double prompts.
 */
export async function getOrConnectWallet(opts?: EthereumProviderOptions): Promise<ConnectedWallet> {
  if (cachedWallet) return cachedWallet;
  const w = await connectWallet(opts);
  cachedWallet = w;
  return w;
}

export function primeCachedWallet(wallet: ConnectedWallet | null) {
  cachedWallet = wallet;
}

export function clearCachedWallet() {
  cachedWallet = null;
}

/**
 * Silent auto-connect helper: returns null if not already connected (no popups).
 * This is used on normal web to reconnect the last-used injected wallet.
 */
export async function tryAutoConnectWallet(opts?: EthereumProviderOptions): Promise<ConnectedWallet | null> {
  const provider = await getEthereumProvider(opts);
  if (!provider) return null;
  const accounts = await getAccounts(provider);
  const a0 = accounts?.[0];
  if (!a0) return null;
  const w = { provider, address: a0 as Address };
  cachedWallet = w;
  return w;
}

function getWalletClient(provider: Eip1193Provider, address: Address) {
  return createWalletClient({
    chain: base,
    transport: custom(provider),
    account: address,
  });
}

export async function readBestMeters(scoreboardAddress: string, playerAddress: string): Promise<bigint> {
  if (!scoreboardAddress) return 0n;

  return (await publicClient.readContract({
    address: scoreboardAddress as Address,
    abi: scoreboardAbi,
    functionName: "bestMeters",
    args: [playerAddress as Address],
  })) as bigint;
}

export async function submitScoreMeters(
  scoreboardAddress: string,
  meters: number,
  wallet?: ConnectedWallet,
): Promise<string> {
  const { provider, address } = wallet ?? (await getOrConnectWallet());
  await ensureBaseMainnet(provider);

  const client = getWalletClient(provider, address);
  const m = BigInt(Math.max(0, Math.floor(meters)));

  const hash = await client.writeContract({
    address: scoreboardAddress as Address,
    abi: scoreboardAbi,
    functionName: "submitScore",
    args: [m],
  });

  return String(hash);
}

export async function getNextTokenId(runNftAddress: string): Promise<bigint> {
  if (!runNftAddress) return 1n;

  return (await publicClient.readContract({
    address: runNftAddress as Address,
    abi: runNftAbi,
    functionName: "nextTokenId",
    args: [],
  })) as bigint;
}

export async function mintRunNft(
  runNftAddress: string,
  meters: number,
  driverId: number,
  tokenUri: string,
  wallet?: ConnectedWallet,
): Promise<string> {
  const { provider, address } = wallet ?? (await getOrConnectWallet());
  await ensureBaseMainnet(provider);

  const client = getWalletClient(provider, address);

  const m = BigInt(Math.max(0, Math.floor(meters)));
  const did = Math.max(0, Math.min(255, Math.floor(driverId)));

  const hash = await client.writeContract({
    address: runNftAddress as Address,
    abi: runNftAbi,
    functionName: "mintRun",
    args: [m, did, tokenUri],
  });

  return String(hash);
}


export async function sendEthTip(
  to: string,
  amountEth: string,
  wallet?: ConnectedWallet,
): Promise<string> {
  const { provider, address } = wallet ?? (await getOrConnectWallet());
  await ensureBaseMainnet(provider);

  const client = getWalletClient(provider, address);
  const hash = await client.sendTransaction({
    to: to as Address,
    value: parseEther(amountEth),
  });

  return String(hash);
}
