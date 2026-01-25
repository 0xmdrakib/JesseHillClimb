"use client";

import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  type Address,
} from "viem";
import { base } from "viem/chains";

import {
  getEthereumProvider,
  requestAccounts,
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
  } catch {
    // If the chain is not available, try adding it.
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

  const accounts = await requestAccounts(provider);
  const a0 = accounts?.[0];
  if (!a0) throw new Error("Wallet connection rejected");

  return { provider, address: a0 as Address };
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

export async function submitScoreMeters(scoreboardAddress: string, meters: number): Promise<string> {
  const { provider, address } = await connectWallet();
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

export async function mintRunNft(runNftAddress: string, meters: number, driverId: number, tokenUri: string): Promise<string> {
  const { provider, address } = await connectWallet();
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
