"use client";

/**
 * Minimal wrapper around @farcaster/miniapp-sdk so the app:
 * - doesn't crash in a normal browser
 * - can call ready() quickly in Mini App clients
 * - can use safe-area insets for UI layout
 */
type MiniAppSdk = any;

let _sdkPromise: Promise<MiniAppSdk | null> | null = null;
let _isMiniPromise: Promise<boolean> | null = null;

export async function getMiniAppSdk(): Promise<MiniAppSdk | null> {
  if (typeof window === "undefined") return null;
  if (_sdkPromise) return _sdkPromise;

  _sdkPromise = (async () => {
    try {
      const mod: any = await import("@farcaster/miniapp-sdk");
      return mod?.sdk ?? null;
    } catch {
      return null;
    }
  })();

  return _sdkPromise;
}

/**
 * True only when the page is actually running inside a Farcaster Mini App host.
 * IMPORTANT: importing the SDK in a normal browser still succeeds, so we must
 * not treat "SDK exists" as "we are in a Mini App".
 */
export async function isInMiniApp(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (_isMiniPromise) return _isMiniPromise;

  _isMiniPromise = (async () => {
    try {
      const sdk = await getMiniAppSdk();
      if (!sdk?.isInMiniApp) return false;
      return Boolean(await sdk.isInMiniApp());
    } catch {
      return false;
    }
  })();

  return _isMiniPromise;
}

export function setSafeAreaCssVars(insets?: {
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
}) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.style.setProperty("--safe-top", `${Math.max(0, insets?.top ?? 0)}px`);
  root.style.setProperty("--safe-bottom", `${Math.max(0, insets?.bottom ?? 0)}px`);
  root.style.setProperty("--safe-left", `${Math.max(0, insets?.left ?? 0)}px`);
  root.style.setProperty("--safe-right", `${Math.max(0, insets?.right ?? 0)}px`);
}

export async function initMiniApp() {
  const sdk = await getMiniAppSdk();
  if (!sdk) return { sdk: null as MiniAppSdk | null, fid: null as number | null };

  // Only enable Mini App behaviors when actually embedded in a host.
  const inMini = await isInMiniApp();
  if (!inMini) return { sdk: null as MiniAppSdk | null, fid: null as number | null };

  try {
    // Helps gesture-heavy apps (like hold-to-gas/brake) inside embedded webviews.
    await sdk.actions.ready?.({ disableNativeGestures: true });
  } catch {
    // ignore
  }

  try {
    const insets = sdk?.context?.client?.safeAreaInsets;
    setSafeAreaCssVars(insets);
  } catch {
    // ignore
  }

  const fid = typeof sdk?.context?.user?.fid === "number" ? sdk.context.user.fid : null;
  return { sdk, fid };
}

export async function composeCast(params: {
  text: string;
  embeds?: string[];
}) {
  const sdk = await getMiniAppSdk();
  if (!sdk?.actions?.composeCast) return false;
  if (!(await isInMiniApp())) return false;
  try {
    await sdk.actions.composeCast(params);
    return true;
  } catch {
    return false;
  }
}

export async function addMiniApp() {
  const sdk = await getMiniAppSdk();
  if (!sdk?.actions?.addMiniApp) return false;
  if (!(await isInMiniApp())) return false;
  try {
    await sdk.actions.addMiniApp();
    return true;
  } catch {
    return false;
  }
}
