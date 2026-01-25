"use client";

import { getMiniAppSdk } from "@/lib/miniapp";

export type Eip1193Provider = {
  request: (args: { method: string; params?: any }) => Promise<any>;
};

export type EthereumProviderOptions = {
  /** Prefer a specific injected wallet when multiple are present. */
  prefer?: "any" | "metamask" | "coinbase";
  /** If false, skip the Mini App host provider and only use injected wallets (useful for local browser testing). */
  allowMiniApp?: boolean;
};

function pickInjectedProvider(opts?: EthereumProviderOptions): Eip1193Provider | null {
  const prefer = opts?.prefer ?? "metamask";

  const anyWin: any = window as any;
  const eth: any = anyWin.ethereum;
  if (!eth) return null;

  // Some environments expose multiple providers.
  const providers: any[] | undefined = Array.isArray(eth.providers) ? eth.providers : undefined;
  if (!providers || providers.length === 0) {
    return typeof eth.request === "function" ? (eth as Eip1193Provider) : null;
  }

  const byFlag = (p: any) => {
    if (prefer === "metamask") return Boolean(p?.isMetaMask);
    if (prefer === "coinbase") return Boolean(p?.isCoinbaseWallet);
    return true;
  };

  const chosen =
    (prefer !== "any" ? providers.find(byFlag) : null) ||
    providers.find((p) => typeof p?.request === "function") ||
    null;

  return chosen && typeof chosen.request === "function" ? (chosen as Eip1193Provider) : null;
}

export async function getEthereumProvider(opts?: EthereumProviderOptions): Promise<Eip1193Provider | null> {
  if (typeof window === "undefined") return null;

  // Prefer the Mini App wallet provider when available.
  if (opts?.allowMiniApp !== false) {
    try {
      const sdk: any = await getMiniAppSdk();
      if (sdk && sdk.wallet && typeof sdk.wallet.getEthereumProvider === "function") {
        const p: any = await sdk.wallet.getEthereumProvider();
        if (p && typeof p.request === "function") return p as Eip1193Provider;
      }
    } catch {
      // ignore
    }
  }

  // Browser wallet fallback (e.g., MetaMask, Coinbase Wallet extension).
  const injected = pickInjectedProvider(opts);
  if (injected) return injected;

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
