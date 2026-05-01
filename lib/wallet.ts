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
  /** If provided, pick a specific injected wallet by id (EIP-6963 rdns/uuid, or fallback injected id). */
  walletId?: string;
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

export type InjectedWallet = {
  id: string;
  name: string;
  icon?: string;
  rdns?: string;
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

function compactWalletKey(value: string) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function providerFlagKey(provider: any): string | null {
  if (!provider) return null;
  if (provider.isMetaMask) return "metamask";
  if (provider.isCoinbaseWallet) return "coinbasewallet";
  if (provider.isRabby) return "rabbywallet";
  if (provider.isBackpack) return "backpack";
  if (provider.isPhantom) return "phantom";
  if (provider.isKeplr) return "keplr";
  if (provider.isSubWallet) return "subwallet";
  return null;
}

function walletIdentityKey(wallet: InjectedWallet): string {
  const rdns = compactWalletKey(wallet.rdns ?? "");
  if (rdns) return `rdns:${rdns}`;

  const flag = providerFlagKey(wallet.provider as any);
  if (flag) return `flag:${flag}`;

  const name = compactWalletKey(wallet.name);
  if (name && name !== "injectedwallet" && name !== "wallet") return `name:${name}`;

  return `id:${wallet.id}`;
}

function dedupeInjectedWallets(arr: InjectedWallet[]): InjectedWallet[] {
  const seenProviders = new Set<any>();
  const seenIdentities = new Set<string>();
  const out: InjectedWallet[] = [];

  for (const wallet of arr) {
    if (!wallet?.provider) continue;

    if (seenProviders.has(wallet.provider as any)) continue;
    seenProviders.add(wallet.provider as any);

    const identity = walletIdentityKey(wallet);
    if (seenIdentities.has(identity)) continue;
    seenIdentities.add(identity);

    out.push(wallet);
  }

  return out;
}

function normalizeWalletName(name: string) {
  const n = String(name ?? "").trim();
  if (!n) return "Injected wallet";
  return n.length > 32 ? n.slice(0, 32) + "…" : n;
}

function walletIdFromEip6963(info: EIP6963ProviderInfo): string {
  const rdns = (info?.rdns ?? "").trim();
  if (rdns) return `eip6963:${rdns.toLowerCase()}`;
  const uuid = (info?.uuid ?? "").trim();
  return uuid ? `eip6963:${uuid}` : "eip6963:unknown";
}

function fallbackWalletLabel(p: any) {
  if (p?.isMetaMask) return "MetaMask";
  if (p?.isCoinbaseWallet) return "Coinbase Wallet";
  if (p?.isRabby) return "Rabby Wallet";
  if (p?.isKeplr) return "Keplr";
  if (p?.isSubWallet) return "SubWallet";
  if (p?.isPhantom) return "Phantom";
  if (p?.isBackpack) return "Backpack";
  return "Injected wallet";
}

/**
 * List injected wallets in the browser.
 * Uses EIP-6963 multi-provider discovery when available, plus the legacy providers array when present.
 */
export async function listInjectedWallets(timeoutMs = 600): Promise<InjectedWallet[]> {
  if (typeof window === "undefined") return [];

  const out: InjectedWallet[] = [];

  // 1) EIP-6963
  try {
    const announced = await discoverEip6963Providers(timeoutMs);
    for (const d of announced) {
      if (!d?.provider) continue;
      const id = walletIdFromEip6963(d.info);
      out.push({
        id,
        name: normalizeWalletName(d.info?.name ?? "Wallet"),
        icon: d.info?.icon,
        rdns: d.info?.rdns,
        provider: d.provider,
      });
    }
  } catch {
    // ignore
  }

  // 2) Legacy multi-provider fallback.
  // Intentionally do not add the single window.ethereum object as a connect choice:
  // it often duplicates an EIP-6963 provider and can show the same wallet twice.
  try {
    const anyWin: any = window as any;
    const eth: any = anyWin.ethereum;
    const providers: any[] | undefined = Array.isArray(eth?.providers) ? eth.providers : undefined;

    if (providers && providers.length) {
      providers.forEach((p, i) => {
        if (!p || typeof p.request !== "function") return;
        const label = fallbackWalletLabel(p);
        const id = `injected:${compactWalletKey(label) || "wallet"}:${i}`;
        out.push({ id, name: label, provider: p as Eip1193Provider });
      });
    }
  } catch {
    // ignore
  }

  return dedupeInjectedWallets(out);
}

function pickByPrefer(wallets: InjectedWallet[], prefer: "any" | "metamask" | "coinbase"): InjectedWallet | null {
  if (!wallets.length) return null;
  if (prefer === "any") return wallets[0] ?? null;

  const want = prefer === "metamask" ? "metamask" : "coinbase";
  const found =
    wallets.find((w) => w.id.includes(want)) ||
    wallets.find((w) => w.name.toLowerCase().includes(want)) ||
    null;
  return found ?? wallets[0] ?? null;
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
  const prefer = opts?.prefer ?? "any";

  // If a specific wallet id is requested, pick it if present.
  if (opts?.walletId) {
    const wallets = await listInjectedWallets(900);
    const match = wallets.find((w) => w.id === opts.walletId) || null;
    if (match) return match.provider;
  }

  // Otherwise pick a sensible default.
  const wallets = await listInjectedWallets(900);
  const chosen = pickByPrefer(wallets, prefer);
  if (chosen) return chosen.provider;

  return null;
}

export async function requestAccounts(provider: Eip1193Provider): Promise<string[]> {
  const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
  return Array.isArray(accounts) ? accounts : [];
}

export async function getAccounts(provider: Eip1193Provider): Promise<string[]> {
  const accounts = (await provider.request({ method: "eth_accounts" })) as string[];
  return Array.isArray(accounts) ? accounts : [];
}

export async function getChainId(provider: Eip1193Provider): Promise<number> {
  const hex = (await provider.request({ method: "eth_chainId" })) as string;
  if (typeof hex !== "string") return 0;
  return parseInt(hex, 16);
}
