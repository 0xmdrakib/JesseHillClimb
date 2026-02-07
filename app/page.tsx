"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { HeadPicker } from "@/components/HeadPicker";
import { loadHead, saveHead, HeadId, HEADS } from "@/lib/heads";
import { HillClimbCanvas, HillClimbHandle, HillClimbState } from "@/components/HillClimbCanvas";
import { initMiniApp, composeCast, addMiniApp } from "@/lib/miniapp";
import { listInjectedWallets, type InjectedWallet } from "@/lib/wallet";
import {
  getOrConnectWallet,
  tryAutoConnectWallet,
  readBestMeters,
  submitScoreMeters,
  getNextTokenId,
  mintRunNft,
  sendEthTip,
} from "@/lib/onchain";

// Browser wallets: don't assume MetaMask. Prefer "any" (EIP-6963 will still pick a sensible default).
const DEFAULT_INJECTED_WALLET = "any" as const;
const LAST_WALLET_KEY = "jhc_last_wallet_id_v1";

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}

function dailySeedUTC() {
  const d = new Date();
  const day = Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 86400000);
  return day >>> 0;
}

function fmtM(m: number) {
  if (!Number.isFinite(m)) return "0";
  return String(Math.max(0, Math.floor(m)));
}

function fmtKmh(kmh: number) {
  if (!Number.isFinite(kmh)) return "0";
  return String(Math.max(0, Math.floor(kmh)));
}

function shortHash(h?: string | null) {
  if (!h) return "";
  if (h.length <= 12) return h;
  return `${h.slice(0, 6)}…${h.slice(-4)}`;
}

function PlusIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      {/* Rounded-square "add app" icon (cleaner at small sizes) */}
      <path
        d="M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M12 8v8M8 12h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      {/* Arrow-out share icon (less noisy than the node graph) */}
      <path d="M14 3h7v7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M21 3l-9 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path
        d="M10 7H7a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function RotateIcon() {
  // minimal rotate/flip icon
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 12a8 8 0 0 1 13.66-5.66"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M18 3v4h-4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M20 12a8 8 0 0 1-13.66 5.66"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M6 21v-4h4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TipIcon() {
  // simple "coin/heart" hybrid
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 21s-7-4.6-7-10.5A4.5 4.5 0 0 1 9.5 6c1.1 0 2.1.4 2.5 1 .4-.6 1.4-1 2.5-1A4.5 4.5 0 0 1 19 10.5C19 16.4 12 21 12 21Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M9.2 12.2h5.6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function XIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export default function Page() {
  const [head, setHead] = useState<HeadId>("jesse");
  const [driverOpen, setDriverOpen] = useState(false);
  const [paused, setPaused] = useState(false);
  const [seed] = useState<number>(() => dailySeedUTC());
  const [boostHeld, setBoostHeld] = useState(false);

  const [mini, setMini] = useState<{ isMini: boolean; fid: number | null }>({ isMini: false, fid: null });

  // Mini App: allow user to flip virtual-landscape direction (default = current)
  const [landscapeSide, setLandscapeSide] = useState<"right" | "left">("right");

  // Tip UI (Mini App)
  const [tipOpen, setTipOpen] = useState(false);
  const [ethUsd, setEthUsd] = useState<number | null>(null);
  const [ethUsdSource, setEthUsdSource] = useState<string>("");
  const [tipPresetUsd, setTipPresetUsd] = useState<number>(10);
  const [tipCustomUsd, setTipCustomUsd] = useState<string>("");
  const [tipBusy, setTipBusy] = useState(false);
  const [tipErr, setTipErr] = useState("");
  const [tipTx, setTipTx] = useState<string | null>(null);
  const [isPortrait, setIsPortrait] = useState(false);

  const [walletAddr, setWalletAddr] = useState<string | null>(null);
  const [walletSource, setWalletSource] = useState<string>("");
  const [bestOnchainM, setBestOnchainM] = useState<number>(0);

  const [scoreBusy, setScoreBusy] = useState(false);
  const [mintBusy, setMintBusy] = useState(false);
  const [connectBusy, setConnectBusy] = useState(false);

  const [scoreTx, setScoreTx] = useState<string | null>(null);
  const [mintTx, setMintTx] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string>("");

  const [walletModalOpen, setWalletModalOpen] = useState(false);
  const [walletChoices, setWalletChoices] = useState<InjectedWallet[]>([]);

  const [gameOverShot, setGameOverShot] = useState<string | null>(null);
  const [gameOverMeters, setGameOverMeters] = useState<number>(0);

  const scoreboardAddress = (process.env.NEXT_PUBLIC_SCOREBOARD_ADDRESS ?? "").trim();
  const runNftAddress = (process.env.NEXT_PUBLIC_RUNNFT_ADDRESS ?? "").trim();

  const [state, setState] = useState<HillClimbState>({
    distanceM: 0,
    bestM: 0,
    coins: 0,
    fuel: 100,
    status: "IDLE",
    rpm01: 0,
    boost01: 0,
    speedKmh: 0,
    airtimeS: 0,
    flips: 0,
    toast: "",
    toastT: 0,
  });

  const gameRef = useRef<HillClimbHandle | null>(null);
  const walletRef = useRef<{ provider: any; address: string } | null>(null);

  useEffect(() => setHead(loadHead()), []);
  useEffect(() => saveHead(head), [head]);

  // Mini App init (non-blocking)
  useEffect(() => {
    (async () => {
      const { sdk, fid } = await initMiniApp();
      setMini({ isMini: Boolean(sdk), fid });
    })();
  }, []);

  // Orientation detection (used for Mini App virtual landscape)
  useEffect(() => {
    if (typeof window === "undefined") return;

    const vv = (window as any).visualViewport as VisualViewport | undefined;

    // Ratio-based check with hysteresis to avoid UI blinking.
    let last: boolean | null = null;

    const compute = () => {
      const w = vv?.width ?? window.innerWidth;
      const h = vv?.height ?? window.innerHeight;

      const next =
        h > w * 1.08 ? true :
        w > h * 1.08 ? false :
        (last ?? (h >= w));

      last = next;
      setIsPortrait(next);
    };

    let raf = 0;
    const on = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(compute);
    };

    on();
    vv?.addEventListener?.("resize", on);
    vv?.addEventListener?.("scroll", on);
    window.addEventListener("resize", on);

    return () => {
      cancelAnimationFrame(raf);
      vv?.removeEventListener?.("resize", on);
      vv?.removeEventListener?.("scroll", on);
      window.removeEventListener("resize", on);
    };
  }, []);

  // Persist user preference for mini virtual-landscape direction
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const v = localStorage.getItem("jhc_landscape_side");
      if (v === "left" || v === "right") setLandscapeSide(v);
    } catch {}
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem("jhc_landscape_side", landscapeSide);
    } catch {}
  }, [landscapeSide]);

  // Fetch ETH/USD when opening tip modal (server route uses Coinbase spot price; fallback to CoinGecko)
  useEffect(() => {
    if (!tipOpen) return;
    let alive = true;
    (async () => {
      try {
        setTipErr("");
        setTipTx(null);
        setEthUsd(null);
        setEthUsdSource("");
        const r = await fetch("/api/ethusd", { cache: "no-store" });
        const j = await r.json();
        const usd = Number(j?.usd);
        if (!alive) return;
        if (r.ok && Number.isFinite(usd) && usd > 0) {
          setEthUsd(usd);
          setEthUsdSource(String(j?.source || ""));
        } else {
          setTipErr("Failed to fetch ETH price");
        }
      } catch {
        if (!alive) return;
        setTipErr("Failed to fetch ETH price");
      }
    })();
    return () => {
      alive = false;
    };
  }, [tipOpen]);

  // Mini App background: match the stage sky so we never show a 1px "gap" stripe on the right.
  useEffect(() => {
    if (!mini.isMini) return;
    document.body.classList.add("miniBody");
    document.documentElement.classList.add("miniHtml");
    return () => {
      document.body.classList.remove("miniBody");
      document.documentElement.classList.remove("miniHtml");
    };
  }, [mini.isMini]);

  // Mini App sizing helpers (visualViewport-driven, also computes "landscape" swapped dims)
  useEffect(() => {
    if (!mini.isMini) return;

    const vv = (window as any).visualViewport as VisualViewport | undefined;
    const root = document.documentElement;

    let raf = 0;
    let lastW = -1;
    let lastH = -1;

    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const w = vv?.width ?? window.innerWidth;
        const h = vv?.height ?? window.innerHeight;

        // Ignore tiny oscillations (common in embedded webviews) to prevent flicker.
        if (Math.abs(w - lastW) < 1 && Math.abs(h - lastH) < 1) return;
        lastW = w;
        lastH = h;

        const ww = Math.round(w);
        const hh = Math.round(h);

        // Visual viewport dims
        root.style.setProperty("--vvw", `${ww}px`);
        root.style.setProperty("--vvh", `${hh}px`);

        // Landscape virtual dims
        const lvw = Math.max(ww, hh);
        const lvh = Math.min(ww, hh);
        root.style.setProperty("--lvw", `${lvw}px`);
        root.style.setProperty("--lvh", `${lvh}px`);

        // UI scale: height is the limiting factor in landscape layouts.
        const short = lvh;
        const uiScale = Math.max(0.68, Math.min(1, short / 420));
        root.style.setProperty("--mini-ui-scale", uiScale.toFixed(3));
      });
    };

    update();
    vv?.addEventListener?.("resize", update);
    vv?.addEventListener?.("scroll", update);
    window.addEventListener("resize", update);

    return () => {
      cancelAnimationFrame(raf);
      vv?.removeEventListener?.("resize", update);
      vv?.removeEventListener?.("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [mini.isMini]);

  // Best-effort: on first user gesture in Mini App, try to go fullscreen + lock to landscape.
  useEffect(() => {
    if (!mini.isMini) return;

    let done = false;

    const tryLock = async () => {
      if (done) return;
      done = true;

      try {
        const el: any = document.documentElement;
        if (el?.requestFullscreen) {
          await el.requestFullscreen();
        }
      } catch {
        // ignore
      }

      try {
        const scr: any = screen as any;
        await scr?.orientation?.lock?.("landscape");
      } catch {
        // ignore
      }
    };

    const onFirst = () => {
      tryLock();
      window.removeEventListener("pointerdown", onFirst);
      window.removeEventListener("touchstart", onFirst);
    };

    window.addEventListener("pointerdown", onFirst, { passive: true });
    window.addEventListener("touchstart", onFirst, { passive: true });

    return () => {
      window.removeEventListener("pointerdown", onFirst);
      window.removeEventListener("touchstart", onFirst);
    };
  }, [mini.isMini]);

  const miniVirtualLandscape = mini.isMini && isPortrait;

  // Pause automatically when the app is backgrounded.
  useEffect(() => {
    const onVis = () => setPaused(Boolean(document.hidden));
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  // Pause while driver picker or wallet picker is open.
  useEffect(() => {
    if (driverOpen || walletModalOpen) setPaused(true);
    else if (!document.hidden) setPaused(false);
  }, [driverOpen, walletModalOpen]);

  // Keyboard fallback (desktop): ArrowRight = GAS, ArrowLeft = BRAKE, R = reset
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") gameRef.current?.setThrottle(1);
      if (e.key === "ArrowLeft") gameRef.current?.setThrottle(-1);
      if (e.key.toLowerCase() === "r") onTryAgain();
    };

    const up = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") gameRef.current?.setThrottle(0);
    };

    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [head, bestOnchainM]);

  const url = useMemo(() => {
    const env = process.env.NEXT_PUBLIC_URL;
    if (env && env.startsWith("http")) return env.replace(/\/$/, "");
    if (typeof window !== "undefined") return window.location.origin;
    return "https://YOUR_DOMAIN";
  }, []);

  const shareText = useMemo(() => {
    const dist = fmtM(state.distanceM);
    const best = fmtM(bestOnchainM);
    return `Jesse Hill Climb: ${dist}m (best ${best}m)\n${url}`;
  }, [bestOnchainM, state.distanceM, url]);

  const doShare = async () => {
    const ok = await composeCast({ text: shareText, embeds: [url] });
    if (ok) return;

    try {
      await navigator.clipboard.writeText(shareText);
      setState((s) => ({ ...s, toast: "Copied share text", toastT: 1.1 }));
    } catch {
      // ignore
    }
  };

  const refreshBest = async (address: string) => {
    if (!scoreboardAddress) return;
    const best = await readBestMeters(scoreboardAddress, address);
    const bestNum = Number(best);
    setBestOnchainM(Number.isFinite(bestNum) ? bestNum : 0);
  };

  const labelFromProvider = (provider: any) => {
    if (provider?.isMetaMask) return "MetaMask";
    if (provider?.isCoinbaseWallet) return "Coinbase Wallet";
    return "Injected wallet";
  };

  const ensureConnected = async (opts?: { walletId?: string; walletLabel?: string }) => {
    setActionErr("");
    setConnectBusy(true);
    try {
      let walletId = opts?.walletId;
      if (!mini.isMini && !walletId) {
        try {
          walletId = localStorage.getItem(LAST_WALLET_KEY) || undefined;
        } catch {
          // ignore
        }
      }

      const preferInjected = mini.isMini
        ? undefined
        : { allowMiniApp: false, prefer: DEFAULT_INJECTED_WALLET, walletId };

      const { provider, address } = await getOrConnectWallet(preferInjected);
      setWalletAddr(address);
      walletRef.current = { provider, address };

      const src = mini.isMini ? "Mini App wallet" : (opts?.walletLabel ?? labelFromProvider(provider));
      setWalletSource(src);

      // Persist last-used injected wallet id for silent reconnect (web only).
      if (!mini.isMini && walletId) {
        try {
          localStorage.setItem(LAST_WALLET_KEY, walletId);
        } catch {
          // ignore
        }
      }

      await refreshBest(address);
      return address;
    } finally {
      setConnectBusy(false);
    }
  };

  // Web: silently reconnect last-used injected wallet on load via eth_accounts (no popup).
  useEffect(() => {
    if (mini.isMini) return;
    let lastId: string | null = null;
    try {
      lastId = localStorage.getItem(LAST_WALLET_KEY);
    } catch {
      lastId = null;
    }
    if (!lastId) return;

    (async () => {
      try {
        const w = await tryAutoConnectWallet({ allowMiniApp: false, walletId: lastId, prefer: "any" });
        if (!w) return;
        walletRef.current = { provider: w.provider, address: w.address };
        setWalletAddr(w.address);
        setWalletSource(labelFromProvider(w.provider));
        await refreshBest(w.address);
      } catch {
        // ignore
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mini.isMini, scoreboardAddress]);

  // Mini Apps: auto-connect (host provider). If the host already has an account, this is silent;
  // otherwise the host can prompt the user (expected for Mini Apps).
  useEffect(() => {
    if (!mini.isMini) return;
    (async () => {
      try {
        const w = await getOrConnectWallet();
        walletRef.current = { provider: w.provider, address: w.address };
        setWalletAddr(w.address);
        setWalletSource("Mini App wallet");
        await refreshBest(w.address);
      } catch {
        // ignore
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mini.isMini, scoreboardAddress]);

  const loadWalletChoices = async () => {
    const ws = await listInjectedWallets(800);
    setWalletChoices(ws);
    return ws;
  };

  const onConnectWalletClick = async () => {
    try {
      setActionErr("");
      if (mini.isMini) {
        await ensureConnected();
        return;
      }

      const ws = await loadWalletChoices();
      if (!ws.length) {
        setActionErr("No injected wallet found. Install a browser wallet extension.");
        return;
      }

      // If only one wallet exists, connect immediately.
      if (ws.length === 1) {
        await ensureConnected({ walletId: ws[0]!.id, walletLabel: ws[0]!.name });
        return;
      }

      setWalletModalOpen(true);
    } catch (e: any) {
      setActionErr(e?.message ? String(e.message) : "Wallet connection failed");
    }
  };

  const onTryAgain = () => {
    setPaused(false);
    setGameOverShot(null);
    setGameOverMeters(0);
    setScoreBusy(false);
    setMintBusy(false);
    setScoreTx(null);
    setMintTx(null);
    setActionErr("");
    gameRef.current?.reset();
  };

  const onSubmitScore = async () => {
    try {
      setActionErr("");
      setScoreTx(null);

      if (!scoreboardAddress) {
        setActionErr("Missing NEXT_PUBLIC_SCOREBOARD_ADDRESS in .env.local");
        return;
      }

      setScoreBusy(true);
      const addr = walletAddr ?? (await ensureConnected());
      const meters = Math.max(0, Math.floor(gameOverMeters || state.distanceM));
      const w = walletRef.current;
      const tx = await submitScoreMeters(scoreboardAddress, meters, w ? { provider: w.provider, address: w.address as any } : undefined);
      setScoreTx(tx);
      await refreshBest(addr);
    } catch (e: any) {
      setActionErr(e?.message ? String(e.message) : "Score submission failed");
    } finally {
      setScoreBusy(false);
    }
  };

  const onMintNft = async () => {
    try {
      setActionErr("");
      setMintTx(null);

      if (!runNftAddress) {
        setActionErr("Missing NEXT_PUBLIC_RUNNFT_ADDRESS in .env.local");
        return;
      }
      if (!gameOverShot) {
        setActionErr("No snapshot available yet. Try again and crash once.");
        return;
      }

      setMintBusy(true);
      void (walletAddr ?? (await ensureConnected()));

      const meters = Math.max(0, Math.floor(gameOverMeters || state.distanceM));
      const driverId = head === "jesse" ? 0 : 1;
      const driverName = HEADS[head].label;

      const tokenId = await getNextTokenId(runNftAddress);

      const resp = await fetch("/api/pinata", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          imageDataUrl: gameOverShot,
          meters,
          driverId,
          driverName,
          tokenId: tokenId.toString(),
          gameUrl: url,
        }),
      });

      if (!resp.ok) {
        const t = await resp.text().catch(() => "");
        throw new Error(t || "IPFS upload failed");
      }

      const out = (await resp.json()) as { tokenUri: string };
      if (!out?.tokenUri) throw new Error("Missing tokenUri from server");

      const w = walletRef.current;
      const tx = await mintRunNft(runNftAddress, meters, driverId, out.tokenUri, w ? { provider: w.provider, address: w.address as any } : undefined);
      setMintTx(tx);
    } catch (e: any) {
      setActionErr(e?.message ? String(e.message) : "Mint failed");
    } finally {
      setMintBusy(false);
    }
  };

  const fuel01 = clamp01(state.fuel / 100);
  const isEnd = state.status === "CRASH" || state.status === "OUT_OF_FUEL";

  const throttleSet = (t: number) => gameRef.current?.setThrottle(t);

  const onGasDown = () => throttleSet(1);
  const onBrakeDown = () => throttleSet(-1);
  const boostSet = (on: boolean) => {
    setBoostHeld(on);
    gameRef.current?.setBoost?.(on);
  };

  const beatOnchainBest = isEnd && Math.floor(state.distanceM) > Math.floor(bestOnchainM);

  return (
    <main className={"main " + (mini.isMini ? "mainMini" : "")}>
      <div
        className={
          "shell " +
          (mini.isMini ? "shellMini" : "") +
          (miniVirtualLandscape ? " miniVirtualLandscape" : "") +
          (miniVirtualLandscape && landscapeSide === "left" ? " landscapeLeft" : "")
        }
      >
        <div className={"header " + (mini.isMini ? "headerMini" : "")}>
          <div>
            <div className="titleRow">
              <img className="brandLogo" src="/icon.png" alt="" />
              <div className="title">Jesse Hill Climb</div>
            </div>
          </div>

          <div className="headerBtns">
            {mini.isMini ? (
              <button className="iconBtn iconBtnDark" type="button" onClick={() => addMiniApp()} aria-label="Add mini app" title="Add">
                <PlusIcon />
              </button>
            ) : null}

            <button className="iconBtn iconBtnPrimary" type="button" onClick={doShare} aria-label="Share" title="Share">
              <ShareIcon />
            </button>
          </div>
        </div>

        <div className="stage">
          <div className="playfield">
            <HillClimbCanvas
              ref={(h) => {
                gameRef.current = h;
              }}
              headId={head}
              paused={paused}
              miniMode={mini.isMini}
              seed={seed}
              bestM={bestOnchainM}
              onState={setState}
              onGameOver={(p) => {
                setGameOverShot(p.snapshotDataUrl);
                setGameOverMeters(p.meters);
              }}
            />

            {/* HUD */}
            <div className="hud">
              <div className="hudCard">
                <div className="hudTop">
                  <div className="bigNum">{fmtM(state.distanceM)}m</div>
                  <div className="small">best {fmtM(bestOnchainM)}m</div>
                </div>

                <div className={"fuelBar " + (state.fuel < 18 ? "fuelLow" : "")}>
                  <div className="fuelFill" style={{ width: `${fuel01 * 100}%` }} />
                </div>

                <div className="hudRow">
                  <div className="tag">⛽ {Math.floor(state.fuel)}%</div>
                  <div className="tag">🪙 {state.coins}</div>
                  <div className="tag">⚡ {fmtKmh(state.speedKmh)} km/h</div>
                </div>

                {state.flips > 0 || state.airtimeS > 0.2 ? (
                  <div className="hudRow">
                    <div className="tag">🌀 {state.flips}</div>
                    <div className="tag">🕊 {state.airtimeS.toFixed(1)}s</div>
                  </div>
                ) : null}
              </div>
            </div>

            {/* Driver button (top-right) */}
            
            <div className="topRightTools">
              {miniVirtualLandscape ? (
                <button
                  type="button"
                  className="miniToolBtn"
                  onClick={() => setLandscapeSide((s) => (s === "left" ? "right" : "left"))}
                  aria-label="Flip landscape direction"
                  title="Flip landscape direction"
                >
                  <RotateIcon />
                </button>
              ) : null}

              {mini.isMini ? (
                <button
                  type="button"
                  className="miniToolBtn"
                  onClick={() => setTipOpen(true)}
                  aria-label="Tip"
                  title="Tip"
                >
                  <TipIcon />
                </button>
              ) : null}

<button
              type="button"
              className="driverBtn driverBtnInTools"
              onClick={() => setDriverOpen((o) => !o)}
              aria-label="Driver"
              title="Driver"
            >
              <img className="driverIcon" src={HEADS[head].src} alt="" />
              <span className="driverLabel">{HEADS[head].label}</span>
              <span className="driverChevron" aria-hidden="true">
                <ChevronDownIcon />
              </span>
            </button>
            </div>


            {driverOpen ? (
              <div className="driverBackdrop" onClick={() => setDriverOpen(false)} role="presentation">
                <div className="driverCard" onClick={(e) => e.stopPropagation()}>
                  <div className="driverCardTop">
                    <div className="driverTitle">Driver</div>
                    <button type="button" className="driverClose" onClick={() => setDriverOpen(false)}>
                      ✕
                    </button>
                  </div>
                  <HeadPicker
                    value={head}
                    onChange={(h) => {
                      setHead(h);
                      setDriverOpen(false);
                    }}
                  />
                </div>
              </div>
            ) : null}

            {tipOpen ? (
              <div className="tipBackdrop" onClick={() => setTipOpen(false)} role="presentation">
                <div className="tipCard" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
                  <div className="tipTop">
                    <div className="tipTitle">Tip</div>
                    <button type="button" className="tipClose" onClick={() => setTipOpen(false)} aria-label="Close">
                      <XIcon />
                    </button>
                  </div>

                  <div className="tipMeta">
                    {ethUsd ? (
                      <>
                        1 ETH ≈ ${ethUsd.toFixed(2)} {ethUsdSource ? <span style={{ opacity: 0.7 }}>({ethUsdSource})</span> : null}
                      </>
                    ) : (
                      <>Loading ETH price…</>
                    )}
                  </div>

                  {(() => {
                    const usd = Number(tipCustomUsd) > 0 ? Number(tipCustomUsd) : tipPresetUsd;
                    const eth = ethUsd && ethUsd > 0 ? usd / ethUsd : 0;
                    const ethStr = ethUsd && ethUsd > 0 ? eth.toFixed(6) : "…";
                    return (
                      <>
                        <div className="tipGrid">
                          {[
                            { usd: 10, label: "$10" },
                            { usd: 100, label: "$100" },
                            { usd: 1000, label: "$1000" },
                          ].map((o) => (
                            <button
                              key={o.usd}
                              type="button"
                              className={"tipAmt " + (tipCustomUsd === "" && tipPresetUsd === o.usd ? "tipAmtActive" : "")}
                              onClick={() => {
                                setTipCustomUsd("");
                                setTipPresetUsd(o.usd);
                              }}
                            >
                              <strong>{o.label}</strong>
                              <span>{ethUsd ? `${(o.usd / ethUsd).toFixed(6)} ETH` : "—"}</span>
                            </button>
                          ))}
                        </div>

                        <div className="tipRow">
                          <input
                            className="tipInput"
                            inputMode="decimal"
                            placeholder="Custom USD (e.g. 25)"
                            value={tipCustomUsd}
                            onChange={(e) => setTipCustomUsd(e.target.value.replace(/[^0-9.]/g, ""))}
                          />
                          <div style={{ fontSize: 12, opacity: 0.85, whiteSpace: "nowrap" }}>
                            ≈ {ethStr} ETH
                          </div>
                        </div>

                        <button
                          type="button"
                          className="tipSend"
                          disabled={tipBusy || !ethUsd}
                          onClick={async () => {
                            try {
                              setTipErr("");
                              setTipTx(null);

                              const tipTo = (process.env.NEXT_PUBLIC_TIP_ADDRESS ?? "").trim();
                              if (!tipTo) {
                                setTipErr("Missing NEXT_PUBLIC_TIP_ADDRESS in .env.local");
                                return;
                              }

                              const usd2 = Number(tipCustomUsd) > 0 ? Number(tipCustomUsd) : tipPresetUsd;
                              if (!Number.isFinite(usd2) || usd2 <= 0) {
                                setTipErr("Enter a valid amount");
                                return;
                              }

                              if (!ethUsd || ethUsd <= 0) {
                                setTipErr("ETH price unavailable");
                                return;
                              }

                              const eth2 = usd2 / ethUsd;
                              // Keep a sane decimal precision for parseEther (avoid scientific notation)
                              const ethAmount = eth2.toFixed(6);

                              setTipBusy(true);
                              await ensureConnected();
                              const w = walletRef.current;
                              const tx = await sendEthTip(tipTo, ethAmount, w ? { provider: w.provider, address: w.address as any } : undefined);
                              setTipTx(tx);
                            } catch (e: any) {
                              setTipErr(e?.message ? String(e.message) : "Tip failed");
                            } finally {
                              setTipBusy(false);
                            }
                          }}
                        >
                          {tipBusy ? "Sending…" : "Send tip"}
                        </button>

                        {tipTx ? (
                          <div className="tipMeta" style={{ marginTop: 10 }}>
                            Sent ✅
                            <div style={{ fontSize: 12, opacity: 0.8, marginTop: 4, overflowWrap: "anywhere" }}>{tipTx}</div>
                          </div>
                        ) : null}

                        {tipErr ? <div className="tipErr">{tipErr}</div> : null}
                      </>
                    );
                  })()}
                </div>
              </div>
            ) : null}

            {/* Wallet picker (web only) */}
            {!mini.isMini && walletModalOpen ? (
              <div className="walletModal" onClick={() => setWalletModalOpen(false)} role="presentation">
                <div className="walletCard" onClick={(e) => e.stopPropagation()}>
                  <div className="walletCardTop">
                    <div className="walletTitle">Choose wallet</div>
                    <button type="button" className="driverClose" onClick={() => setWalletModalOpen(false)} aria-label="Close">
                      ✕
                    </button>
                  </div>

                  <div className="walletList">
                    {walletChoices.map((w) => (
                      <button
                        key={w.id}
                        type="button"
                        className="walletRow"
                        disabled={connectBusy}
                        onClick={() => {
                          setWalletModalOpen(false);
                          void ensureConnected({ walletId: w.id, walletLabel: w.name }).catch((e: any) => {
                            setActionErr(e?.message ? String(e.message) : "Wallet connection failed");
                          });
                        }}
                      >
                        {w.icon ? <img className="walletIcon" src={w.icon} alt="" /> : <span className="walletIcon" aria-hidden="true" />}
                        <span>{w.name}</span>
                      </button>
                    ))}
                  </div>

                  <div className="walletHint">Tip: next time the last-used wallet reconnects silently via eth_accounts.</div>
                </div>
              </div>
            ) : null}

            {/* Toast */}
            {state.toastT > 0 && state.toast ? <div className="toast">{state.toast}</div> : null}

            {/* Minimal start hint */}
            {state.status !== "RUN" && !isEnd ? <div className="centerHint">Tap GAS to start</div> : null}

            {/* End screen */}
            {isEnd ? (
              <div className="endScreen">
                <div className="endCard">
                  <div className="endTitle">{state.status === "CRASH" ? "CRASH!" : "OUT OF FUEL"}</div>
                  <div className="endSub">
                    {fmtM(state.distanceM)}m • best {fmtM(bestOnchainM)}m{beatOnchainBest ? " • NEW BEST (pending onchain)" : ""}
                  </div>

                  <div className="endShotWrap">
                    {gameOverShot ? <img className="endShot" src={gameOverShot} alt="Run snapshot" /> : <div className="endShotPlaceholder">Snapshot</div>}
                  </div>

                  <div className="endOnchain">
                    <div className="endOnchainTitle">Onchain (optional)</div>
                    <div className="endOnchainRow">
                      <div className="endOnchainMeta">
                        <div className="endOnchainLine">Network: Base mainnet</div>
                        <div className="endOnchainLine">
                          Wallet: {walletAddr ? walletAddr : "Not connected"}
                          {walletAddr && walletSource ? ` (${walletSource})` : ""}
                        </div>
                        {!scoreboardAddress || !runNftAddress ? (
                          <div className="endOnchainWarn">Set contract addresses in .env.local to enable.</div>
                        ) : null}
                        {scoreTx ? <div className="endOnchainOk">Score tx: {shortHash(scoreTx)}</div> : null}
                        {mintTx ? <div className="endOnchainOk">Mint tx: {shortHash(mintTx)}</div> : null}
                        {actionErr ? <div className="endOnchainErr">{actionErr}</div> : null}
                      </div>
                    </div>

                    <div className="endOnchainBtns">
                      {!walletAddr ? (
                        <button
                          type="button"
                          className="actionBtn btnDark"
                          disabled={scoreBusy || mintBusy || connectBusy}
                          onClick={() => void onConnectWalletClick()}
                        >
                          {connectBusy ? "Connecting…" : "Connect wallet"}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="actionBtn btnDark"
                        disabled={scoreBusy || mintBusy || !scoreboardAddress || connectBusy}
                        onClick={onSubmitScore}
                      >
                        {scoreBusy ? "Submitting…" : "Save score onchain"}
                      </button>
                      <button
                        type="button"
                        className="actionBtn btnDark"
                        disabled={scoreBusy || mintBusy || !runNftAddress || !gameOverShot || connectBusy}
                        onClick={onMintNft}
                      >
                        {mintBusy ? "Minting…" : "Mint run NFT"}
                      </button>
                    </div>
                  </div>

                  <div className="endBtns">
                    <button type="button" className="actionBtn btnPrimary" onClick={onTryAgain}>
                      Try again
                    </button>
                    <button type="button" className="actionBtn btnDark" onClick={doShare}>
                      Share
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            {/* Controls */}
            <div className="controls">
              <Pedal label="BRAKE" side="left" onDown={onBrakeDown} onUp={() => throttleSet(0)} />
              <Pedal label="GAS" side="right" onDown={onGasDown} onUp={() => throttleSet(0)} />
            </div>

            {/* Gauges (RPM + BOOST) */}
            <div className="gauges">
              <Gauge label="RPM" value01={clamp01(state.rpm01)} />
              <GaugeButton
                label="BOOST"
                value01={clamp01(state.boost01)}
                active={boostHeld}
                disabled={state.status !== "RUN" || state.boost01 < 0.05}
                onDown={() => boostSet(true)}
                onUp={() => boostSet(false)}
              />
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

function Gauge(props: { label: string; value01: number }) {
  const { label, value01 } = props;
  const deg = -120 + value01 * 240;
  return (
    <div className="gauge">
      <div className="gaugeFace" />
      <div className="needle" style={{ transform: `translateX(-50%) rotate(${deg}deg)` }} />
      <div className="gaugeCap" />
      <div className="gaugeLabel">{label}</div>
    </div>
  );
}

function GaugeButton(props: {
  label: string;
  value01: number;
  disabled: boolean;
  active: boolean;
  onDown: () => void;
  onUp: () => void;
}) {
  const { label, value01, disabled, active, onDown, onUp } = props;
  const deg = -120 + value01 * 240;
  return (
    <button
      type="button"
      className={"gauge gaugeInteract " + (disabled ? "gaugeDisabled " : "") + (active ? "gaugeActive" : "")}
      onPointerDown={(e) => {
        e.preventDefault();
        if (disabled) return;
        (e.currentTarget as HTMLButtonElement).setPointerCapture(e.pointerId);
        onDown();
      }}
      onPointerUp={(e) => {
        e.preventDefault();
        onUp();
      }}
      onPointerCancel={(e) => {
        e.preventDefault();
        onUp();
      }}
      onPointerLeave={() => onUp()}
      aria-label={label}
      title={disabled ? "Charge boost by doing stunts" : "Hold to boost"}
    >
      <div className="gaugeFace" />
      <div className="needle" style={{ transform: `translateX(-50%) rotate(${deg}deg)` }} />
      <div className="gaugeCap" />
      <div className="gaugeLabel">{label}</div>
    </button>
  );
}

function Pedal(props: { label: string; side: "left" | "right"; onDown: () => void; onUp: () => void }) {
  const { label, side, onDown, onUp } = props;
  return (
    <button
      type="button"
      className={"pedal " + (side === "left" ? "pedalLeft" : "pedalRight")}
      onPointerDown={(e) => {
        e.preventDefault();
        (e.currentTarget as HTMLButtonElement).setPointerCapture(e.pointerId);
        onDown();
      }}
      onPointerUp={(e) => {
        e.preventDefault();
        onUp();
      }}
      onPointerCancel={(e) => {
        e.preventDefault();
        onUp();
      }}
      onPointerLeave={() => onUp()}
    >
      <div className="holes" />
      <div className="pedalLabel">{label}</div>
    </button>
  );
}
