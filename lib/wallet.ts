"use client";

import { getMiniAppSdk, isInMiniApp } from "@/lib/miniapp";

export type Eip1193Provider = {
  request: (args: { method: string; params?: any }) => Promise<any>;
};

export type EthereumProviderOptions = {
  /** Prefer a specific injected wallet when multiple are present. */
  prefer?: "any" | "metamask" | "coinbase";
  /** If false, skip the Mini App host provider and only use injected wallets (useful for local browser testing). */
  allowMiniApp?: boolean;
};

type EIP6963ProviderInfo = {
  uuid: string;
  name: string;
  icon: string;
  rdns?: string;
};

type EIP6963ProviderDetail = {
  info: EIP6963ProviderInfo;
  provider: Eip1193Provider;
};

async function discoverEip6963Providers(timeoutMs = 250): Promise<EIP6963ProviderDetail[]> {
  if (typeof window === "undefined") return [];

  const out: EIP6963ProviderDetail[] = [];
  const handler = (ev: any) => {
    const d = ev?.detail;
    if (!d?.provider || typeof d.provider.request !== "function") return;
    if (!d?.info) return;
    out.push(d as EIP6963ProviderDetail);
  };

  try {
    window.addEventListener("eip6963:announceProvider" as any, handler as any);
    window.dispatchEvent(new Event("eip6963:requestProvider" as any));
    await new Promise((r) => setTimeout(r, timeoutMs));
  } finally {
    window.removeEventListener("eip6963:announceProvider" as any, handler as any);
  }

  return out;
}

function dedupeByRef<T extends { provider: Eip1193Provider }>(arr: T[]): T[] {
  const seen = new Set<any>();
  const out: T[] = [];
  for (const it of arr) {
    if (!it?.provider) continue;
    if (seen.has(it.provider as any)) continue;
    seen.add(it.provider as any);
    out.push(it);
  }
  return out;
}

function pickInjectedProvider(opts?: EthereumProviderOptions): Eip1193Provider | null {
  const prefer = opts?.prefer ?? "metamask";

  const anyWin: any = window as any;
  const eth: any = anyWin.ethereum;
  if (!eth) return null;

  // Modern multi-wallet discovery (EIP-6963). This avoids the "wrong provider" problem
  // when the user has multiple extensions installed.
  // We keep this best-effort and fall back to window.ethereum if nothing announces.
  // NOTE: this function is sync; EIP-6963 is handled in getEthereumProvider().

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
      // NOTE: importing the SDK in a normal browser still succeeds.
      // We must only use the host wallet provider when *actually* in a Mini App.
      const inMini = await isInMiniApp();
      if (inMini) {
        const sdk: any = await getMiniAppSdk();
        if (sdk && sdk.wallet && typeof sdk.wallet.getEthereumProvider === "function") {
          const p: any = await sdk.wallet.getEthereumProvider();
          if (p && typeof p.request === "function") return p as Eip1193Provider;
        }
      }
    } catch {
      // ignore
    }
  }

  // Browser wallet fallback (e.g., MetaMask, Coinbase Wallet extension).
  // First try EIP-6963 multi-provider discovery.
  try {
    const prefer = opts?.prefer ?? "metamask";
    const announced = dedupeByRef(await discoverEip6963Providers(800));
    if (announced.length) {
      const pick = (d: EIP6963ProviderDetail) => {
        const p: any = d.provider as any;
        const name = String(d.info?.name ?? "").toLowerCase();
        const rdns = String(d.info?.rdns ?? "").toLowerCase();
        if (prefer === "metamask") return Boolean(p?.isMetaMask) || name.includes("metamask") || rdns.includes("metamask");
        if (prefer === "coinbase") return Boolean(p?.isCoinbaseWallet) || name.includes("coinbase") || rdns.includes("coinbase");
        return true;
      };

      const chosen =
        (prefer !== "any" ? announced.find(pick) : null) ||
        announced.find((d) => typeof (d.provider as any)?.request === "function") ||
        null;

      if (chosen?.provider) return chosen.provider;
    }
  } catch {
    // ignore
  }

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
