"use client";

import { getMiniAppSdk } from "@/lib/miniapp";

export type Eip1193Provider = {
  request: (args: { method: string; params?: any }) => Promise<any>;
};

export async function getEthereumProvider(): Promise<Eip1193Provider | null> {
  if (typeof window === "undefined") return null;

  // Prefer the Mini App wallet provider when available.
  try {
    const sdk: any = await getMiniAppSdk();
    if (sdk && sdk.wallet && typeof sdk.wallet.getEthereumProvider === "function") {
      const p: any = await sdk.wallet.getEthereumProvider();
      if (p && typeof p.request === "function") return p as Eip1193Provider;
    }
  } catch {
    // ignore
  }

  // Browser wallet fallback (e.g., Coinbase Wallet extension, MetaMask).
  const anyWin: any = window as any;
  if (anyWin.ethereum && typeof anyWin.ethereum.request === "function") return anyWin.ethereum as Eip1193Provider;

  return null;
}

export async function requestAccounts(provider: Eip1193Provider): Promise<string[]> {
  const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
  return Array.isArray(accounts) ? accounts : [];
}

export async function getChainId(provider: Eip1193Provider): Promise<number> {
  const hex = (await provider.request({ method: "eth_chainId" })) as string;
  if (typeof hex !== "string") return 0;
  return parseInt(hex, 16);
}
