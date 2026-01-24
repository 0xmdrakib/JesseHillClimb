"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { HeadPicker } from "@/components/HeadPicker";
import { loadHead, saveHead, HeadId, HEADS } from "@/lib/heads";
import { HillClimbCanvas, HillClimbHandle, HillClimbState } from "@/components/HillClimbCanvas";
import { initMiniApp, composeCast, addMiniApp } from "@/lib/miniapp";
import {
  connectWallet,
  ensureBaseMainnet,
  readBestMeters,
  submitScoreMeters,
  getNextTokenId,
  mintRunNft,
} from "@/lib/onchain";

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
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path
        d="M18 16a3 3 0 0 0-2.2 1L8.9 13.6a3.1 3.1 0 0 0 0-3.2L15.8 7A3 3 0 1 0 14.5 5.2L7.3 8.9A3 3 0 1 0 7.3 15l7.2 3.7A3 3 0 1 0 18 16Z"
        stroke="currentColor"
        strokeWidth="2"
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

export default function Page() {
  const [head, setHead] = useState<HeadId>("jesse");
  const [driverOpen, setDriverOpen] = useState(false);
  const [paused, setPaused] = useState(false);
  const [seed] = useState<number>(() => dailySeedUTC());
  const [boostHeld, setBoostHeld] = useState(false);

  const [mini, setMini] = useState<{ isMini: boolean; fid: number | null }>({ isMini: false, fid: null });
  const [isPortrait, setIsPortrait] = useState(false);


  const [walletAddr, setWalletAddr] = useState<string | null>(null);
  const [bestOnchainM, setBestOnchainM] = useState<number>(0);

  const [scoreBusy, setScoreBusy] = useState(false);
  const [mintBusy, setMintBusy] = useState(false);
  const [scoreTx, setScoreTx] = useState<string | null>(null);
  const [mintTx, setMintTx] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string>("");

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

  useEffect(() => setHead(loadHead()), []);

  useEffect(() => {
    saveHead(head);
  }, [head]);

  // Mini App init (non-blocking)
  useEffect(() => {
    (async () => {
      const { sdk, fid } = await initMiniApp();
      setMini({ isMini: Boolean(sdk), fid });
    })();
  }, []);

  // Orientation detection (used for Mini App portrait layout)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(orientation: portrait)");
    const update = () => setIsPortrait(Boolean(mq.matches));
    update();
    // Some WebViews only fire resize; we subscribe to both.
    mq.addEventListener?.("change", update);
    window.addEventListener("resize", update);
    return () => {
      mq.removeEventListener?.("change", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  // Mini App background: match the stage sky so we never show a 1px "gap" stripe on the right.
  useEffect(() => {
    if (!mini.isMini) return;
    document.body.classList.add("miniBody");
    return () => document.body.classList.remove("miniBody");
  }, [mini.isMini]);

  // Mini App "virtual landscape" sizing:
// In portrait, we rotate the page content 90° to behave like a fixed landscape canvas.
// We DO NOT scale the whole page (that creates giant empty margins); instead we:
//   1) compute a stable viewport size (VisualViewport) for layout + canvas sizing
//   2) expose a "virtual landscape" width/height (lvw/lvh) so CSS can size correctly
//   3) trigger a resize after updates so the canvas/UI re-layout immediately
useEffect(() => {
  if (!mini.isMini) return;
  if (typeof window === "undefined") return;

  const vv = (window as any).visualViewport as VisualViewport | undefined;

  let lastW = 0;
  let lastH = 0;
  let scheduled = false;

  const update = () => {
    const w = vv?.width ?? window.innerWidth;
    const h = vv?.height ?? window.innerHeight;

    // Raw viewport (portrait webview area)
    document.documentElement.style.setProperty("--vvw", `${w}px`);
    document.documentElement.style.setProperty("--vvh", `${h}px`);

    // Virtual landscape dims (swap when portrait)
    const portrait = h > w;
    const lvw = portrait ? h : w;
    const lvh = portrait ? w : h;
    document.documentElement.style.setProperty("--lvw", `${lvw}px`);
    document.documentElement.style.setProperty("--lvh", `${lvh}px`);

    // Keep container scale 1 (no letterboxing)
    document.documentElement.style.setProperty("--mini-scale", "1");

    // Make HUD/controls slightly smaller on phones, but keep them readable.
    const shortSide = Math.min(w, h); // in CSS px
    const uiScale = Math.max(0.82, Math.min(0.95, shortSide / 460));
    document.documentElement.style.setProperty("--mini-ui-scale", String(uiScale));

    // Force a relayout for canvas + UI after the viewport actually changes.
    // (Avoid infinite loops: we only dispatch when dimensions changed.)
    const changed = w !== lastW || h !== lastH;
    lastW = w;
    lastH = h;
    if (changed && !scheduled) {
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        window.dispatchEvent(new Event("resize"));
      });
    }
  };

  update();
  vv?.addEventListener?.("resize", update);
  window.addEventListener("resize", update);
  return () => {
    vv?.removeEventListener?.("resize", update);
    window.removeEventListener("resize", update);
  };
}, [mini.isMini]);

    update();
    vv?.addEventListener?.("resize", update);
    window.addEventListener("resize", update);
    return () => {
      vv?.removeEventListener?.("resize", update);
      window.removeEventListener("resize", update);
    };
  }, [mini.isMini]);


  const miniVirtualLandscape = mini.isMini && isPortrait;

  // Pause automatically when the app is backgrounded.
  useEffect(() => {
    const onVis = () => setPaused(Boolean(document.hidden));
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  // Pause while driver picker is open.
  useEffect(() => {
    if (driverOpen) setPaused(true);
    else if (!document.hidden) setPaused(false);
  }, [driverOpen]);

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

  const ensureConnected = async () => {
    setActionErr("");
    const { provider, address } = await connectWallet();
    await ensureBaseMainnet(provider);
    setWalletAddr(address);
    await refreshBest(address);
    return address;
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
      const tx = await submitScoreMeters(scoreboardAddress, meters);
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
      const addr = walletAddr ?? (await ensureConnected());
      void addr;

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
        }),
      });

      if (!resp.ok) {
        const t = await resp.text().catch(() => "");
        throw new Error(t || "IPFS upload failed");
      }

      const out = (await resp.json()) as { tokenUri: string };
      if (!out?.tokenUri) throw new Error("Missing tokenUri from server");

      const tx = await mintRunNft(runNftAddress, meters, driverId, out.tokenUri);
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

  const onGasDown = () => {
    throttleSet(1);
    throttleSet(1);
  };

  const onBrakeDown = () => throttleSet(-1);
  const boostSet = (on: boolean) => {
    setBoostHeld(on);
    gameRef.current?.setBoost?.(on);
  };

  const beatOnchainBest = isEnd && Math.floor(state.distanceM) > Math.floor(bestOnchainM);

  return (
    <main className={"main " + (mini.isMini ? "mainMini" : "")}> 
      <div className={"shell " + (mini.isMini ? "shellMini" : "") + (miniVirtualLandscape ? " miniVirtualLandscape" : "")}> 
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
	          // NOTE: ref callbacks must return void (React's LegacyRef expects void).
	          // Using a block body avoids returning the assigned value.
	          ref={(h) => {
	            gameRef.current = h;
	          }}
            headId={head}
            paused={paused}
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

          {/* Driver button in the stage (top-right) */}
          <button
            type="button"
            className="driverBtn"
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

          {/* Toast */}
          {state.toastT > 0 && state.toast ? <div className="toast">{state.toast}</div> : null}

          {/* Minimal start hint */}
          {state.status !== "RUN" && !isEnd ? <div className="centerHint">Tap GAS to start</div> : null}


          {/* Mini App portrait: wide-mode + optional landscape button */}


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
                    <button
                      type="button"
                      className="actionBtn btnDark"
                      disabled={scoreBusy || mintBusy || !scoreboardAddress}
                      onClick={onSubmitScore}
                    >
                      {scoreBusy ? "Submitting…" : "Save score onchain"}
                    </button>
                    <button
                      type="button"
                      className="actionBtn btnDark"
                      disabled={scoreBusy || mintBusy || !runNftAddress || !gameOverShot}
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
