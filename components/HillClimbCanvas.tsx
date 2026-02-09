"use client";

import React, { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import planck from "planck-js";
import { HeadId, HEADS } from "@/lib/heads";

export type HillClimbState = {
  distanceM: number;
  bestM: number;
  coins: number;
  fuel: number;
  status: "IDLE" | "RUN" | "CRASH" | "OUT_OF_FUEL";
  rpm01: number;
  boost01: number;

  // Extra juice
  speedKmh: number;
  airtimeS: number;
  flips: number;

  // UI toast (short-lived message)
  toast: string;
  toastT: number;
};

export type HillClimbHandle = {
  setThrottle: (t: number) => void; // -1 brake, 0 idle, 1 gas
  setBoost: (on: boolean) => void; // hold-to-boost
  reset: () => void;
};

const Vec2 = planck.Vec2;

// World scale: Box2D-style sims like 0.1-10m sized objects.
// We render at ~45 CSS px per meter.
let SCALE = 45; // default; will be recalculated on resize from canvas width

// 60Hz is the canonical Box2D/Planck recommendation for high-quality sims.
// (We still keep iteration counts modest for browser performance.)
const HZ = 60;
const DT = 1 / HZ;
const VEL_ITERS = 8;
const POS_ITERS = 3;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const clamp01 = (v: number) => clamp(v, 0, 1);

/**
 * Track generation
 *
 * For hill-climb games the ground must be (1) continuous, (2) slope-limited,
 * and (3) sampled densely enough that wheels don't "vertex snag".
 *
 * We generate a deterministic, slope-limited polyline and use it for:
 *  - physics collision (Chain)
 *  - rendering
 *  - fuel/coin placement and crash checks
 */
const TRACK_X0 = -40;
// Extend far enough that a normal run never falls off the generated terrain.
const TRACK_X1 = 1800;
const TRACK_DX = 0.25; // denser sampling -> smoother wheels, fewer snags

type Track = { xs: number[]; ys: number[] };

function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildTrack(seed = 1337): Track {
  // Production terrain goal:
  // - looks like real hills (not tiny ripples)
  // - slope/curvature limited so wheels never "vertex snag"
  // - includes flats, rollers, and larger climbs/descents
  //
  // Approach:
  // - generate piecewise "segments" with a target height curve
  // - follow that target but clamp max slope + curvature per step

  const rnd = mulberry32(seed);
  const xs: number[] = [];
  const ys: number[] = [];

  type SegKind = "flat" | "roll" | "hill";

  const smooth01 = (t: number) => {
    const u = clamp01(t);
    return u * u * (3 - 2 * u);
  };

  let x = TRACK_X0;
  let y = 0.86;
  let lastDy = 0;

  let kind: SegKind = "flat";
  let segLen = 24;
  let segT = 0;
  let y0 = y;
  let y1 = y;
  let bump = 0;
  let phase = rnd() * Math.PI * 2;

  // Lookup table (instead of nested ternaries) to avoid TS2367 "no overlap" build failures
  // seen in some Next.js/TypeScript type-check configurations.
  const SLOPE_KIND_MUL: Record<SegKind, number> = {
    flat: 1,
    roll: 1.08,
    hill: 1.16,
  };

  const chooseSeg = (d: number) => {
    // Difficulty ramps very early: within a few seconds you should already see meaningful hills.
    // After that, it keeps getting harder as distance increases.
    const diff = clamp01((d - 2) / 160); // ramps very fast

    // First ~60m: intentionally aggressive so the game becomes fun (hard hills) within seconds.
    if (d < 25) {
      kind = "hill";
    } else if (d < 60) {
      kind = rnd() < 0.15 ? "roll" : "hill";
    } else {
      const wFlat = 0.08;
      const wRoll = 0.32;
      const wHill = 0.60 + 0.32 * diff;
      const sum = wFlat + wRoll + wHill;
      const r = rnd() * sum;
      if (r < wFlat) kind = "flat";
      else if (r < wFlat + wRoll) kind = "roll";
      else kind = "hill";
    }

    // Segment lengths: shorter early = more frequent features.
    if (kind === "flat") segLen = 10 + rnd() * 18; // 10..28
    if (kind === "roll") segLen = 14 + rnd() * 22; // 14..36
    if (kind === "hill") segLen = 18 + rnd() * 44; // 18..62

    segT = 0;
    y0 = y;
    phase = rnd() * Math.PI * 2;

    // Keep the road in a pleasant vertical band (avoids drifting too high/low).
    const baseline = 0.95 + 0.35 * diff;
    const basePull = (baseline - y) * (kind === "hill" ? 0.55 : 0.80);

    if (kind === "flat") {
      y1 = y0 + basePull + (rnd() * 2 - 1) * 0.10;
      bump = 0;
    } else if (kind === "roll") {
      y1 = y0 + basePull + (rnd() * 2 - 1) * (0.34 + 0.20 * diff);
      bump = 0.55 + rnd() * (0.75 + 0.40 * diff);
    } else {
      // Hills: higher amplitude, and they scale with distance.
      y1 = y0 + basePull + (rnd() * 2 - 1) * (1.10 + 0.95 * diff);
      bump = 1.60 + rnd() * (2.35 + 1.75 * diff);
      if (rnd() < 0.30 + 0.20 * diff) bump *= 1.35;
    }
  };

  chooseSeg(0);

  while (x <= TRACK_X1) {
    const d = x - TRACK_X0;
    if (segT >= segLen) chooseSeg(d);

    // Start gentle for the first few seconds, then ramp difficulty.
    const startEase = clamp01(d / 5);
    const diff = clamp01((d - 10) / 220);
    const easy = 1 - clamp01((d - 2) / 40);

    // Playable slope cap, but steeper than before.
    // Also allow hills/rollers to be slightly sharper than flats.
    const slopeKindMul = SLOPE_KIND_MUL[kind];
    const slopeMaxBase = (0.28 * easy) + (0.44 + 0.52 * diff) * (1 - easy);
    const slopeMax = clamp(slopeMaxBase * (0.40 + 0.60 * startEase) * slopeKindMul, 0.08, 0.65);
    const maxStep = slopeMax * TRACK_DX;
    const curvMax = (0.020 + 0.026 * diff) * TRACK_DX; // curvature limiter

    const u = clamp01(segT / Math.max(0.001, segLen));
    const su = smooth01(u);
    let targetY = y0 + (y1 - y0) * su;

    // TS can incorrectly narrow `kind` to a single literal because it is mutated
    // inside `chooseSeg(...)` (a nested function). Runtime is correct; we just
    // need to widen the type here for the compiler.
    if ((kind as SegKind) === "roll") {
      targetY += bump * Math.sin(u * Math.PI * 2 + phase);
    } else if ((kind as SegKind) === "hill") {
      // A hill bump on top of the overall trend.
      targetY += bump * Math.sin(u * Math.PI);
    }

    // Tiny micro undulation so the road isn't mathematically perfect.
    const micro = (Math.sin((x + 12.3) * 0.85) * 0.012 + Math.sin((x - 7.1) * 1.95) * 0.005) * startEase;
    targetY += micro;

    // Follow target but clamp slope + curvature.
    let dy = clamp(targetY - y, -maxStep, maxStep);
    dy = clamp(dy, lastDy - curvMax, lastDy + curvMax);
    lastDy = dy;

    y = clamp(y + dy, -0.55, 4.9);

    xs.push(x);
    ys.push(y);

    x += TRACK_DX;
    segT += TRACK_DX;
  }

  // Light smoothing pass (removes jaggies without flattening hills).
  for (let k = 0; k < 2; k++) {
    for (let i = 1; i < ys.length - 1; i++) {
      ys[i] = ys[i] * 0.50 + (ys[i - 1] + ys[i + 1]) * 0.25;
    }
  }


  // Start pad: keep terrain flat around the spawn so the car doesn't begin tilted.
  // (The procedural generator can produce a slight slope near x=0, which makes first-touch feel bad.)
  const PAD_X0 = -4;
  const PAD_X1 = 8;
  const PAD_BLEND = 3; // meters (smooth blend into the generated hills)
  const i0 = Math.max(0, Math.min(ys.length - 1, Math.round((0 - TRACK_X0) / TRACK_DX)));
  const yPad = ys[i0];

  for (let i = 0; i < xs.length; i++) {
    const xx = xs[i];
    if (xx >= PAD_X0 && xx <= PAD_X1) {
      ys[i] = yPad;
    } else if (xx > PAD_X0 - PAD_BLEND && xx < PAD_X0) {
      const t = smooth01((xx - (PAD_X0 - PAD_BLEND)) / PAD_BLEND);
      ys[i] = ys[i] * (1 - t) + yPad * t;
    } else if (xx > PAD_X1 && xx < PAD_X1 + PAD_BLEND) {
      const t = smooth01((xx - PAD_X1) / PAD_BLEND);
      ys[i] = yPad * (1 - t) + ys[i] * t;
    }
  }

  return { xs, ys };
}

function sampleTrackY(track: Track, x: number) {
  if (x <= track.xs[0]) return track.ys[0];
  if (x >= track.xs[track.xs.length - 1]) return track.ys[track.ys.length - 1];
  const i = Math.floor((x - TRACK_X0) / TRACK_DX);
  const i0 = Math.max(0, Math.min(track.xs.length - 2, i));
  const x0 = track.xs[i0], x1 = track.xs[i0 + 1];
  const y0 = track.ys[i0], y1 = track.ys[i0 + 1];
  const u = (x - x0) / (x1 - x0);
  return y0 + (y1 - y0) * u;
}

type Pickup = { kind: "coin" | "fuel"; x: number; y: number; value: number; taken?: boolean };

type CarRig = {
  chassis: planck.Body;
  wheel1: planck.Body;
  wheel2: planck.Body;
  spring1: planck.WheelJoint;
  spring2: planck.WheelJoint;
};

export const HillClimbCanvas = forwardRef<
  HillClimbHandle,
  {
    headId: HeadId;
    paused: boolean;
    /** True only when running inside a Farcaster/Base Mini App host. */
    miniMode?: boolean;
    seed?: number;
    onState: (s: HillClimbState) => void;
    bestM?: number;
    onGameOver?: (p: { snapshotDataUrl: string | null; meters: number; status: "CRASH" | "OUT_OF_FUEL" }) => void;
  }
>(function HillClimbCanvas(props, ref) {
  const { headId, paused, miniMode, seed, onState, bestM, onGameOver } = props;

  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const pausedRef = useRef(paused);
  const headIdRef = useRef(headId);

  // Mini mode can flip from false->true shortly after mount (once the SDK initializes).
  // The RAF loop captures closures on mount, so keep a ref for runtime checks.
  const miniModeRef = useRef(Boolean(miniMode));

  const throttleTargetRef = useRef(0); // what the user is doing right now
  const throttleRef = useRef(0); // smoothed (game feel)

  const boostHeldRef = useRef(false);

  const camRef = useRef({ x: 0, y: 0 }); // smoothed camera in world meters

  const bestRef = useRef(0);
  const groundedRef = useRef({ w1: 0, w2: 0 }); // wheel contact counts
  const crashFreezeRef = useRef({ t: 0, frozen: false });

  const worldRef = useRef<planck.World | null>(null);
  const carRef = useRef<CarRig | null>(null);
  const pickupsRef = useRef<Pickup[]>([]);
  const trackRef = useRef<Track>(buildTrack());
  const seedRef = useRef<number>(1337);

  // Render time (seconds). Used for subtle pickup bob + background drift.
  const timeRef = useRef(0);

  // Snapshot (for NFT minting): periodically capture the rendered canvas while running.
  const snapshotRef = useRef<string | null>(null);
  const lastSnapTRef = useRef(0);
  const lastEndStatusRef = useRef<"CRASH" | "OUT_OF_FUEL" | null>(null);

  // Airtime + flip tracking (per-jump)
  const airRef = useRef<{
    active: boolean;
    t: number;
    acc: number;
    lastAngle: number;
    flipCount: number;
  }>({ active: false, t: 0, acc: 0, lastAngle: 0, flipCount: 0 });


  const headImgRef = useRef<HTMLImageElement | null>(null);
  const headImg2Ref = useRef<HTMLImageElement | null>(null);

  const stateRef = useRef<HillClimbState>({
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

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    miniModeRef.current = Boolean(miniMode);
  }, [miniMode]);

  useEffect(() => {
    // New seed => fresh terrain/run
    reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed]);

  useEffect(() => {
    headIdRef.current = headId;
  }, [headId]);

  useEffect(() => {
    const bm = typeof bestM === "number" && Number.isFinite(bestM) ? bestM : 0;
    bestRef.current = bm;
    stateRef.current.bestM = bm;
    // keep HUD consistent
    onState({ ...stateRef.current });
  }, [bestM, onState]);

  const resolveSeed = () => {
    const s = typeof seed === "number" && Number.isFinite(seed) ? Math.floor(seed) : 1337;
    return s >>> 0;
  };

  const reset = () => {
    throttleTargetRef.current = 0;
    throttleRef.current = 0;
    boostHeldRef.current = false;

    // Reset run snapshot state.
    snapshotRef.current = null;
    lastSnapTRef.current = 0;
    lastEndStatusRef.current = null;

    seedRef.current = resolveSeed();    // Best score is read from chain in the page and passed in (no local persistence).
    const bm = typeof bestM === "number" && Number.isFinite(bestM) ? bestM : 0;
    bestRef.current = bm;
    groundedRef.current = { w1: 0, w2: 0 };
    crashFreezeRef.current = { t: 0, frozen: false };
    airRef.current = { active: false, t: 0, acc: 0, lastAngle: 0, flipCount: 0 };

    stateRef.current = {
      distanceM: 0,
      bestM: bestRef.current,
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
    };

    buildWorld();

    // Ensure HUD reflects the new run instantly (we throttle state emission in the render loop).
    onState({ ...stateRef.current });
  };

  const buildWorld = () => {
    // fresh deterministic track each run (can be made seed-based per user later)
    const track = buildTrack(seedRef.current);
    trackRef.current = track;

    // Gravity: negative y = down (we use y-up coordinates)
    const world = new planck.World(Vec2(0, -10));
    worldRef.current = world;

    groundedRef.current = { w1: 0, w2: 0 };
    crashFreezeRef.current = { t: 0, frozen: false };
    airRef.current = { active: false, t: 0, acc: 0, lastAngle: 0, flipCount: 0 };

    // Ground body
    const ground = world.createBody();
    ground.setUserData({ kind: "ground" });

    const pts: planck.Vec2[] = [];
    for (let i = 0; i < track.xs.length; i++) pts.push(Vec2(track.xs[i], track.ys[i]));
    // Slightly lower friction than the first prototype to reduce instant wheelies
    // when GAS is pressed.
    ground.createFixture(planck.Chain(pts, false), { friction: 0.86 });

    // Safety floor: prevents the car from falling forever if it somehow leaves the terrain.
    // (In the real game, runs end quickly on crash/out-of-fuel, so you don't see deep free-falls.)
    ground.createFixture(planck.Edge(Vec2(TRACK_X0 - 200, -18), Vec2(TRACK_X1 + 200, -18)), { friction: 0.9 });

    // Jeep chassis (stability-first: lower COM so GAS doesn't insta-flip)
    const spawnX = 0;
    const groundY0 = sampleTrackY(track, spawnX);
    // Spawn a bit closer to ground to avoid the "drop + snap" that can kick the car.
    const spawnY = groundY0 + 1.55;

    const chassis = world.createDynamicBody({
      position: Vec2(spawnX, spawnY),
      // Too much angular damping makes the car feel "stuck" and prevents natural flips.
      angularDamping: 1.6,
      linearDamping: 0.12,
      bullet: true,
    });
    chassis.setUserData({ kind: "chassis" });

    // Main mass (low + wide)
    chassis.createFixture(planck.Box(1.05, 0.24), { density: 1.05, friction: 0.25 });

    // Cabin / upper shape (lighter)
    chassis.createFixture(planck.Box(0.55, 0.18, Vec2(-0.10, 0.30), 0), { density: 0.55, friction: 0.25 });

    // Ballast (below COM): helps stability, but keep it moderate so flips are still possible.
    chassis.createFixture(planck.Box(0.70, 0.12, Vec2(0.0, -0.28), 0), { density: 1.8, friction: 0.25 });

    // Wheels
    const wheelRadius = 0.34;
    // Wheel centers start nearer the terrain so suspension settles smoothly.
    // Start both wheels at the same Y so the car begins level (track can be slightly sloped).
    const wheelY0 = groundY0 + 0.60;
    const wheel1 = world.createDynamicBody({ position: Vec2(spawnX - 0.80, wheelY0), angularDamping: 0.85, bullet: true });
    const wheel2 = world.createDynamicBody({ position: Vec2(spawnX + 0.80, wheelY0), angularDamping: 0.85, bullet: true });
    wheel1.setUserData({ kind: "wheel1" });
    wheel2.setUserData({ kind: "wheel2" });

    wheel1.createFixture(planck.Circle(wheelRadius), { density: 1.35, friction: 0.92 });
    wheel2.createFixture(planck.Circle(wheelRadius), { density: 1.35, friction: 0.92 });

    // Suspension + motor: wheel joint (spring/damper + motor)
    const axis = Vec2(0, 1);
    const common = {
      collideConnected: false,
      enableMotor: true,
      motorSpeed: 0,
      // Default max (we overwrite every frame with our own traction/torque curve)
      maxMotorTorque: 90,
      // Planck's own demo uses HZ~4 and ZETA~0.7 (stable + "bouncy but not silly").
      frequencyHz: 4.2,
      dampingRatio: 0.82,
    };

    const spring1 = world.createJoint(planck.WheelJoint(common as any, chassis, wheel1, wheel1.getPosition(), axis)) as planck.WheelJoint;
    const spring2 = world.createJoint(planck.WheelJoint(common as any, chassis, wheel2, wheel2.getPosition(), axis)) as planck.WheelJoint;

    carRef.current = { chassis, wheel1, wheel2, spring1, spring2 };

    // Ensure a neutral start (no initial tilt/rotation).
    chassis.setAngle(0);
    chassis.setAngularVelocity(0);

    // Contact listeners: detect when wheels touch the ground (for air-control + tuning feel)
    world.on("begin-contact", (c: planck.Contact) => {
      const a = c.getFixtureA().getBody();
      const b = c.getFixtureB().getBody();
      const ak = (a.getUserData() as any)?.kind;
      const bk = (b.getUserData() as any)?.kind;

      if ((ak === "wheel1" && bk === "ground") || (ak === "ground" && bk === "wheel1")) groundedRef.current.w1++;
      if ((ak === "wheel2" && bk === "ground") || (ak === "ground" && bk === "wheel2")) groundedRef.current.w2++;
    });

    world.on("end-contact", (c: planck.Contact) => {
      const a = c.getFixtureA().getBody();
      const b = c.getFixtureB().getBody();
      const ak = (a.getUserData() as any)?.kind;
      const bk = (b.getUserData() as any)?.kind;

      if ((ak === "wheel1" && bk === "ground") || (ak === "ground" && bk === "wheel1")) groundedRef.current.w1 = Math.max(0, groundedRef.current.w1 - 1);
      if ((ak === "wheel2" && bk === "ground") || (ak === "ground" && bk === "wheel2")) groundedRef.current.w2 = Math.max(0, groundedRef.current.w2 - 1);
    });

    // Pickups
    // Deterministic (seeded) so the run layout feels consistent.
    const prnd = mulberry32((seedRef.current ^ 0x9e3779b9) >>> 0);
    const pickups: Pickup[] = [];

    // coins: small clusters that follow the terrain
    for (let i = 12; i <= TRACK_X1 - 40; i += 24) {
      const jitter = (prnd() * 2 - 1) * 4;
      const x = i + jitter;
      const baseY = sampleTrackY(track, x) + 2.05;
      pickups.push({ kind: "coin", x, y: baseY, value: 1 });
      pickups.push({ kind: "coin", x: x + 2.0, y: sampleTrackY(track, x + 2.0) + 2.05, value: 1 });
      pickups.push({ kind: "coin", x: x + 4.0, y: sampleTrackY(track, x + 4.0) + 2.05, value: 1 });
    }

    // fuel: every ~60m with a bit of randomness, placed within reach.
    for (let i = 32; i <= TRACK_X1 - 60; i += 62) {
      const jitter = (prnd() * 2 - 1) * 7;
      const x = i + jitter;
      // A small "arch" puts cans in slightly more interesting positions.
      const arch = 0.25 * Math.sin((i / 62) * Math.PI);
      pickups.push({ kind: "fuel", x, y: sampleTrackY(track, x) + 2.05 + arch, value: 35 });
    }
    pickupsRef.current = pickups;

    // Initialize camera
    camRef.current.x = spawnX;
    camRef.current.y = spawnY;
  };

  // Fixed timestep loop with accumulator (stable physics feel)
  useEffect(() => {
    // World is initialized via reset() (runs on mount and when seed changes).

    // preload head images
    const img1 = new Image();
    img1.src = HEADS.jesse.src;
    headImgRef.current = img1;

    const img2 = new Image();
    img2.src = HEADS.brian.src;
    headImg2Ref.current = img2;

    let raf = 0;
    let lastTime = performance.now() / 1000;
    let accumulator = 0;

    // Reduce React churn: emit HUD state ~30Hz, plus immediately on important events.
    let lastEmit = 0;
    let lastStatus: HillClimbState["status"] = stateRef.current.status;
    let lastToastT = 0;

    // Snapshot capture is intentionally *not* done during the run.
    // Creating image data URLs on an interval can cause periodic frame drops that feel like a "blink".
    // We'll capture once at game-over.
    const offscreenSnap = document.createElement("canvas");
    const captureSnapshot = () => {
      try {
        const c = canvasRef.current;
        if (!c) return null;

        // Stable landscape snapshot (16:9) so Mini App virtual-rotation does not produce portrait/ugly NFTs.
        // Center-crop the source canvas into 960×540.
        const outW = 960;
        const outH = 540;
        const outAspect = outW / outH;

        const srcW = Math.max(1, c.width);
        const srcH = Math.max(1, c.height);
        const srcAspect = srcW / srcH;

        let sx = 0, sy = 0, sw = srcW, sh = srcH;
        if (srcAspect > outAspect) {
          // Crop width
          sw = Math.floor(srcH * outAspect);
          sx = Math.floor((srcW - sw) / 2);
        } else if (srcAspect < outAspect) {
          // Crop height
          sh = Math.floor(srcW / outAspect);
          sy = Math.floor((srcH - sh) / 2);
        }

        offscreenSnap.width = outW;
        offscreenSnap.height = outH;
        const octx = offscreenSnap.getContext("2d");
        if (!octx) return null;

        octx.imageSmoothingEnabled = true;
        // @ts-ignore
        octx.imageSmoothingQuality = "high";
        octx.drawImage(c, sx, sy, sw, sh, 0, 0, outW, outH);
        return offscreenSnap.toDataURL("image/png");
      } catch {
        return null;
      }
    };

    const loop = (tMs: number) => {
      raf = requestAnimationFrame(loop);

      const ctx = canvasRef.current?.getContext("2d");
      const canvas = canvasRef.current;
      if (!ctx || !canvas) return;

      const world = worldRef.current;
      const car = carRef.current;
      if (!world || !car) return;

      const now = tMs / 1000;
      let frameTime = now - lastTime;
      lastTime = now;

      timeRef.current = now;

      // avoid spiral of death if tab is backgrounded
      frameTime = Math.min(frameTime, 0.25);
      if (!pausedRef.current) {
        accumulator += frameTime;

        while (accumulator >= DT) {
          // One fixed simulation tick.
          // stepGame() applies inputs/forces, steps physics, and updates derived state.
          stepGame(world, car);
          accumulator -= DT;
        }

        // camera smoothing (per-frame)
        updateCamera(car, frameTime);
      }

      render(ctx, canvas.width, canvas.height, car, now);

      const sNow = stateRef.current;

      // Fire onGameOver once per end state.
      if ((sNow.status === "CRASH" || sNow.status === "OUT_OF_FUEL") && lastEndStatusRef.current !== sNow.status) {
        lastEndStatusRef.current = sNow.status;

        // Capture the final frame as the run snapshot.
        snapshotRef.current = captureSnapshot() ?? snapshotRef.current;
        try {
          onGameOver?.({
            snapshotDataUrl: snapshotRef.current,
            meters: Math.max(0, Math.floor(sNow.distanceM)),
            status: sNow.status,
          });
        } catch {
          // ignore
        }
      }

      if (sNow.status === "IDLE" || sNow.status === "RUN") {
        lastEndStatusRef.current = null;
      }
      const emitDue = now - lastEmit > 1 / 30;
      const emitImportant = sNow.status !== lastStatus || (sNow.toastT > 0 && sNow.toastT !== lastToastT);

      if (emitDue || emitImportant) {
        lastEmit = now;
        lastStatus = sNow.status;
        lastToastT = sNow.toastT;
        onState({ ...sNow });
      }
    };

    
    let lastPxW = 0;
    let lastPxH = 0;

    const resize = () => {
      const c = canvasRef.current;
      if (!c) return;

      const rect = c.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;

      // IMPORTANT: In Mini Apps we rotate the UI via CSS transforms in portrait.
      // getBoundingClientRect() returns transformed sizes, which can swap/round dimensions.
      // Using clientWidth/clientHeight gives the pre-transform layout size and prevents 1–2px underfill stripes.
      const cssW = Math.max(1, Math.ceil(c.clientWidth || rect.width));
      const cssH = Math.max(1, Math.ceil(c.clientHeight || rect.height));

      // Recompute render scale from visible width (keeps phone landscape nicely framed).
      // Desktop remains unchanged because we cap at the original 45 px/m.
      SCALE = Math.min(45, Math.max(28, cssW / 20));

      const pxW = Math.max(1, Math.ceil(cssW * dpr));
      const pxH = Math.max(1, Math.ceil(cssH * dpr));

      // Always ensure the backing buffer is at least as large as the visible CSS box.
      // This avoids the right-side "gutter" / unrendered strip caused by rounding down.
      if (c.width !== pxW) c.width = pxW;
      if (c.height !== pxH) c.height = pxH;
      lastPxW = pxW;
      lastPxH = pxH;

      // Responsive "contain" scaling: keep roughly a consistent world width visible.
      // - Desktop: close to the original 45 px/m feel.
      // - Phones: lower px/m so more of the world fits (less "zoomed-in").
      const isPhone = cssW < 520;
      const targetWorldWidthM = isPhone ? 18 : 20; // tune this if you want more/less zoom

      const raw = cssW / targetWorldWidthM;
      const minPxPerM = isPhone ? 18 : 28;
      const maxPxPerM = isPhone ? 32 : 46;

      SCALE = Math.max(minPxPerM, Math.min(maxPxPerM, raw));
    };

    // ResizeObserver fixes the "looks wrong until I manually resize the window" bug.
    // The canvas' CSS size can change after first paint (fonts, layout, safe-area, etc.).
    const ro = new ResizeObserver(() => {
      requestAnimationFrame(resize);
    });

    if (canvasRef.current) ro.observe(canvasRef.current);

    window.addEventListener("resize", resize);

    // Extra initial calls: first paint + one more after layout settles.
    requestAnimationFrame(() => {
      resize();
      requestAnimationFrame(resize);
    });

    raf = requestAnimationFrame(loop);

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useImperativeHandle(ref, () => ({
    setThrottle: (t: number) => {
      throttleTargetRef.current = Math.max(-1, Math.min(1, t));
    },
    setBoost: (on: boolean) => {
      boostHeldRef.current = Boolean(on);
    },
    reset,
  }));

  const isGrounded = () => groundedRef.current.w1 + groundedRef.current.w2 > 0;

  const stepGame = (world: planck.World, car: CarRig) => {
    const s = stateRef.current;

    // Smooth input for feel (prevents twitchy motor changes)
    const target = throttleTargetRef.current;
    const cur = throttleRef.current;
    const k = 1 - Math.exp(-10 * DT); // ~100ms response
    throttleRef.current = cur + (target - cur) * k;

    const throttle = throttleRef.current;
    const grounded = isGrounded();

    // start on first input
    if (s.status === "IDLE" && Math.abs(throttle) > 0.02) s.status = "RUN";
    // fuel loop
    // Drain only while actively running. If you are OUT_OF_FUEL you can still pick up fuel
    // and resume driving.
    if (s.status === "RUN") {
      // Drain fuel in a way that "feels" consistent:
      // - small idle drain
      // - most drain comes from GAS usage
      // - speed adds a small multiplier (only matters when accelerating)
      const gas01 = Math.max(0, throttle);
      const vx = Math.abs(car.chassis.getLinearVelocity().x);

      const idleDrain = 0.16;
      const throttleDrain = 1.35 * gas01;
      const speedDrain = 0.012 * vx * gas01;

      s.fuel -= (idleDrain + throttleDrain + speedDrain) * DT;

      if (s.fuel <= 0) {
        s.fuel = 0;
        s.status = "OUT_OF_FUEL";
        // no more GAS, but BRAKE should still work
        throttleTargetRef.current = Math.min(0, throttleTargetRef.current);
      }
    }

    // If out of fuel, GAS is disabled but BRAKE still works.
    const drive = s.status === "OUT_OF_FUEL" ? Math.min(0, throttle) : throttle;

    // Boost: charged via stunts/pickups; hold BOOST button to spend it.
    const boostActive = s.status === "RUN" && boostHeldRef.current && s.boost01 > 0.03;
    if (boostActive) {
      s.boost01 = Math.max(0, s.boost01 - 0.75 * DT);
    }

    // Motor control (HCR-like): rear-wheel drive + soft traction + mid-air tilt.
    // Hill Climb Racing lets you flip if you overdo it, but it shouldn't instantly backflip on tap.
    const forwardMax = 26; // wheel motor target speed (rad/s)
    const reverseMax = 10;

    // Rear wheel = spring1 (x - 0.80). Front wheel = spring2.
    const gr = groundedRef.current;
    const rearGrounded = gr.w1 > 0;
    const frontGrounded = gr.w2 > 0;
    const groundedAny = rearGrounded || frontGrounded;

    // Pitch: + = nose up. We only cut power when angle is *very* extreme.
    const pitch = car.chassis.getAngle();
    const pitchAbs = Math.abs(((pitch + Math.PI) % (2 * Math.PI)) - Math.PI);
    const pitchCut = clamp01(1 - Math.max(0, pitchAbs - 1.35) / 0.65);

    // Traction: in-air still lets you spin wheels a bit (for that classic "tilt" feel),
    // but reduced so it doesn't explode.
    const traction = rearGrounded ? 1 : 0.35;

    // A tiny idle torque keeps the wheels from jittering when settled.
    let motorSpeed = 0;
    let rearTorque = 0;
    let brakeTorque = 0;

    if (s.status === "IDLE") {
      motorSpeed = 0;
      rearTorque = 10;
      brakeTorque = 0;
    }

    if (s.status === "RUN") {
      if (drive > 0.02) {
        // GAS
        const speedMul = boostActive ? 1.15 : 1.0;
        motorSpeed = -(throttle * forwardMax * speedMul);

        // Torque curve: strong at low speed, drops as wheel spins up.
        const omega = Math.abs(car.wheel1.getAngularVelocity());
        const omega01 = clamp01(omega / forwardMax);
        const powerDrop = 1 - 0.62 * omega01;

        const base = 30;
        const max = 92;
        const boostMul = boostActive ? 1.45 : 1.0;
        rearTorque = (base + (max - base) * throttle) * powerDrop * traction * pitchCut * boostMul;
      } else if (drive < -0.02) {
        // BRAKE (and gentle reverse at very low speed)
        const vx = car.chassis.getLinearVelocity().x;
        const brake = clamp01(-drive);

        // Avoid endo: if nose is already down, reduce braking.
        const endoCut = clamp01(1 - Math.max(0, (-pitch) - 0.55) / 0.45);
        brakeTorque = (88 * brake) * (0.55 + 0.45 * endoCut);

        if (vx > 0.8) {
          motorSpeed = 0;
          rearTorque = 0;
        } else {
          // tiny reverse, mostly for getting unstuck
          motorSpeed = brake * reverseMax;
          rearTorque = 36 * brake * traction;
        }
      } else {
        motorSpeed = 0;
        rearTorque = 7;
        brakeTorque = 0;
      }
    }

    if (s.status === "OUT_OF_FUEL") {
      // No drive torque, but still allow braking/reverse nudge.
      motorSpeed = 0;
      rearTorque = 0;
      if (drive < -0.02) {
        const vx = car.chassis.getLinearVelocity().x;
        const brake = clamp01(-drive);

        const endoCut = clamp01(1 - Math.max(0, (-pitch) - 0.55) / 0.45);
        brakeTorque = (88 * brake) * (0.55 + 0.45 * endoCut);

        if (vx <= 0.8) {
          motorSpeed = brake * reverseMax;
          rearTorque = 28 * brake * traction;
        }
      } else {
        brakeTorque = 0;
      }
    }

    if (s.status === "CRASH") {
      motorSpeed = 0;
      rearTorque = 0;
      brakeTorque = 0;
    }

    // Apply to joints
    car.spring1.setMotorSpeed(motorSpeed);
    car.spring1.setMaxMotorTorque(rearTorque + brakeTorque);

    // Front wheel is NOT driven. It only brakes (helps stability).
    car.spring2.setMotorSpeed(0);
    car.spring2.setMaxMotorTorque(brakeTorque * 0.8);

    // Gentle ground assist: reduces jitter but does NOT "lock" the car upright.
    // We only help when BOTH wheels are down and the player isn't mashing the pedals.
    if (s.status === "RUN" && groundedAny) {
      const av = car.chassis.getAngularVelocity();
      const vx = car.chassis.getLinearVelocity().x;
      const bothDown = rearGrounded && frontGrounded;

      const pedalEase = clamp01(1 - Math.abs(throttle)); // 1 when idle, 0 when full pedal
      const speedEase = clamp01((7.5 - Math.abs(vx)) / 7.5); // fades out at speed
      const assist = pedalEase * speedEase * (bothDown ? 1 : 0.35);

      let stab = (-2.8 * pitch) - (0.8 * av);
      stab *= assist;
      const maxStab = 10;
      stab = Math.max(-maxStab, Math.min(maxStab, stab));
      car.chassis.applyTorque(stab);

      // Soft cap angular velocity (keeps the sim stable without killing flips).
      const maxAV = 6.5;
      if (Math.abs(av) > maxAV) car.chassis.setAngularVelocity(Math.sign(av) * maxAV);
    }

    // Air-control: in the air, pedals tilt the chassis (classic HCR feel)
    if ((s.status === "RUN" || s.status === "OUT_OF_FUEL") && !groundedAny) {
      const airTorque = 30 * throttle; // GAS = nose up, BRAKE = nose down
      car.chassis.applyTorque(airTorque);

      // light boost charge while airborne
      s.boost01 = Math.min(1, s.boost01 + 0.05 * DT);
    }

    // --- Physics step (fixed timestep) ---
    // Box2D/Planck sims are most stable with a fixed step (commonly 1/60s).
    // We step after applying forces, then compute derived state from the new positions.
    world.step(DT, VEL_ITERS, POS_ITERS);
    // Planck recommends clearing accumulated forces after stepping.
    // (Safe even if you don't apply custom forces every tick.)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (world as any).clearForces?.();

    // distance scoring (only forward progress counts)
    const x = car.chassis.getPosition().x;    s.distanceM = Math.max(s.distanceM, x);
    // Best score is external (onchain) and is not updated locally.
    s.bestM = bestRef.current;

    // rpm gauge (driven wheel angular velocity normalized)
    const w = Math.abs(car.wheel1.getAngularVelocity());
    s.rpm01 = Math.max(0, Math.min(1, w / forwardMax));

    // Speed + toast decay
    const v = car.chassis.getLinearVelocity();
    s.speedKmh = Math.hypot(v.x, v.y) * 3.6;

    if (s.toastT > 0) {
      s.toastT = Math.max(0, s.toastT - DT);
      if (s.toastT === 0) s.toast = "";
    }

    // Airtime + flips (per-jump)
    if ((s.status === "RUN" || s.status === "OUT_OF_FUEL") && !groundedAny) {
      const a = airRef.current;
      if (!a.active) {
        a.active = true;
        a.t = 0;
        a.acc = 0;
        a.flipCount = 0;
        a.lastAngle = car.chassis.getAngle();
      }
      a.t += DT;
      s.airtimeS = a.t;

      const ang = car.chassis.getAngle();
      let d = ang - a.lastAngle;
      // unwrap angle delta to [-pi,pi]
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      a.acc += d;
      a.lastAngle = ang;

      const flipsNow = Math.floor(Math.abs(a.acc) / (Math.PI * 2));
      if (flipsNow > a.flipCount) {
        const gained = flipsNow - a.flipCount;
        a.flipCount = flipsNow;
        s.flips += gained;
        // tiny stunt rewards (keeps runs alive + feels good)
        const coinBonus = 5 * gained;
        const fuelBonus = 3 * gained;
        s.coins += coinBonus;
        s.fuel = Math.min(100, s.fuel + fuelBonus);
        s.toast = `FLIP +${coinBonus} - FUEL +${fuelBonus}`;
        s.toastT = 1.35;

        // reward boost for stunts
        s.boost01 = Math.min(1, s.boost01 + 0.18 * gained);
      }
    } else {
      airRef.current.active = false;
      s.airtimeS = 0;
    }

    // pickups (robust: check chassis + wheels + head)
    const headLocal = Vec2(-0.25, 0.75);
    const points = [
      car.chassis.getPosition(),
      car.wheel1.getPosition(),
      car.wheel2.getPosition(),
      car.chassis.getWorldPoint(headLocal),
    ];

    for (const p of pickupsRef.current) {
      if (p.taken) continue;

      // Slightly generous pickup radius makes the game feel fair (and fixes missed fuel pickups).
      const r = p.kind === "fuel" ? 1.85 : 1.35;
      const r2 = r * r;

      let hit = false;
      for (const pos of points) {
        const dx = p.x - pos.x;
        const dy = p.y - pos.y;
        if (dx * dx + dy * dy < r2) {
          hit = true;
          break;
        }
      }
      if (!hit) continue;

      p.taken = true;

      if (p.kind === "coin") {
        s.coins += p.value;
        s.toast = `+${p.value} COIN`;
        s.toastT = 0.9;

        // coins lightly charge boost
        s.boost01 = Math.min(1, s.boost01 + 0.015 * p.value);
      } else if (p.kind === "fuel") {
        const before = s.fuel;
        s.fuel = Math.min(100, s.fuel + p.value);
        s.toast = `FUEL +${p.value}`;
        s.toastT = 1.1;

        // fuel cans are a strong boost pickup
        s.boost01 = Math.min(1, s.boost01 + 0.10);

        // If we were out-of-fuel and managed to coast into a can, resume the run.
        if (s.status === "OUT_OF_FUEL" && before <= 0 && s.fuel > 0.5) {
          s.status = "RUN";
          crashFreezeRef.current = { t: 0, frozen: false };
          car.chassis.setAwake(true);
          car.wheel1.setAwake(true);
          car.wheel2.setAwake(true);
          // restore normal damping
          car.chassis.setLinearDamping(0.12);
          car.chassis.setAngularDamping(1.6);
          car.wheel1.setAngularDamping(0.85);
          car.wheel2.setAngularDamping(0.85);
        }
      }
    }

    // Crash rules (HCR-like):
    // 1) Head hits the ground ("neck break" style).
    // 2) Car flips and ends up upside-down on the surface.
    if (s.status === "RUN") {
      const tr = trackRef.current;
      const headLocal = Vec2(-0.25, 0.75);
      const headWorld = car.chassis.getWorldPoint(headLocal);
      const gyHead = sampleTrackY(tr, headWorld.x);

      const pitchNow = car.chassis.getAngle();
      const pitchNorm = ((pitchNow + Math.PI) % (2 * Math.PI)) - Math.PI; // [-pi,pi]
      const upside = Math.abs(pitchNorm) > 2.2; // ~126deg
      const posNow = car.chassis.getPosition();
      const gyBody = sampleTrackY(tr, posNow.x);
      const nearGround = posNow.y < gyBody + 0.85;

      if (headWorld.y < gyHead + 0.08 || (upside && nearGround && groundedAny)) {
        s.status = "CRASH";
        throttleTargetRef.current = 0;
        throttleRef.current = 0;
        crashFreezeRef.current = { t: 0, frozen: false };
        airRef.current = { active: false, t: 0, acc: 0, lastAngle: 0, flipCount: 0 };
        s.airtimeS = 0;
      }
    }

    // End-of-run freeze: after CRASH/OUT_OF_FUEL, let the car settle briefly,
    // then put bodies to sleep so it stays on the surface (no deep falling).
    // For OUT_OF_FUEL we wait a bit longer and only freeze once the car has basically stopped
    // so you can still coast into a nearby fuel can.
    if (s.status === "CRASH" || (s.status === "OUT_OF_FUEL" && s.fuel <= 0.01)) {
      const cf = crashFreezeRef.current;
      if (!cf.frozen) {
        const lv = car.chassis.getLinearVelocity();
        const sp = Math.hypot(lv.x, lv.y);

        const settleT = s.status === "CRASH" ? 0.65 : 1.35;
        const canFreeze = s.status === "CRASH" || sp < 0.35;
        cf.t = canFreeze ? (cf.t + DT) : 0;
        // extra damping to settle faster
        car.chassis.setLinearDamping(2.0);
        car.chassis.setAngularDamping(3.2);
        car.wheel1.setAngularDamping(2.0);
        car.wheel2.setAngularDamping(2.0);

        if (cf.t > settleT) {
          // freeze in-place
          car.spring1.setMotorSpeed(0);
          car.spring1.setMaxMotorTorque(0);
          car.spring2.setMotorSpeed(0);
          car.spring2.setMaxMotorTorque(0);

          car.chassis.setLinearVelocity(Vec2(0, 0));
          car.chassis.setAngularVelocity(0);
          car.wheel1.setAngularVelocity(0);
          car.wheel2.setAngularVelocity(0);
          car.chassis.setAwake(false);
          car.wheel1.setAwake(false);
          car.wheel2.setAwake(false);
          cf.frozen = true;
        }
      }
    }
  };

  const updateCamera = (car: CarRig, frameTime: number) => {
    const p = car.chassis.getPosition();
    const v = car.chassis.getLinearVelocity();

    // look-ahead (HCR camera looks forward)
    // In Mini Apps we bias the camera a bit more forward to feel "ultra wide"
    // (more upcoming terrain visible) without changing gameplay scale.
    const isMini = miniModeRef.current;
    // Mini-app camera tuning:
    // - Keep some look-ahead for a wider forward view
    // - But cap it lower than desktop so the car doesn't get pushed under left-side UI
    const lookMul = isMini ? 0.55 : 0.6;
    const lookMax = isMini ? 6 : 8;
    const lookAhead = Math.max(0, Math.min(lookMax, v.x * lookMul));
    const targetX = p.x + lookAhead;

    // keep slightly above chassis center, but not too jumpy
    const targetY = p.y + 0.6;

    // critically damped-ish smoothing
    const smooth = 1 - Math.exp(-6 * frameTime);
    camRef.current.x += (targetX - camRef.current.x) * smooth;
    camRef.current.y += (targetY - camRef.current.y) * smooth;
  };

  const render = (ctx: CanvasRenderingContext2D, w: number, h: number, car: CarRig, nowS: number) => {
    const dpr = devicePixelRatio || 1;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const camX = camRef.current.x;
    const camY = camRef.current.y;

    // screen center: HCR keeps car left-ish, so you see upcoming terrain
    // Mini Apps: slight left bias, but not so much that the car can slide under left-side UI.
    const viewCX = w * (miniModeRef.current ? 0.32 : 0.33);
    const viewCY = h * 0.62;

    const toScreen = (v: planck.Vec2) => ({
      x: viewCX + (v.x - camX) * SCALE * dpr,
      y: viewCY - (v.y - camY) * SCALE * dpr,
    });

    // sky + background layers (production palette)
    drawSkyPro(ctx, w, h, camX, dpr, seedRef.current);

    // Mountains + hills + forest (parallax). Use stronger contrast than the previous build.
    drawMountains(ctx, w, h, camX, dpr, 0.08, "#c7d7e6", 0.60);
    drawMountains(ctx, w, h, camX, dpr, 0.12, "#b1c7dc", 0.70);

    const track = trackRef.current;

    drawHills(ctx, w, h, track, camX, camY, dpr, 0.18, "#c5e7d4", 0.92);
    drawHills(ctx, w, h, track, camX, camY, dpr, 0.28, "#a8dcc3", 0.84);
    drawHills(ctx, w, h, track, camX, camY, dpr, 0.40, "#8fcaa9", 0.75);

    drawForest(ctx, w, h, camX, dpr, 0.52, "#6aa886", 0.72);

    // ground (dirt + grass)
    // IMPORTANT: must share the same viewCX/viewCY as the car, otherwise the road can
    // appear shifted relative to physics (wheels look like they're floating on slopes).
    drawGround(ctx, w, h, track, camX, camY, dpr, viewCX, viewCY);

    // pickups
    for (const p of pickupsRef.current) {
      if (p.taken) continue;

      // Subtle bob makes pickups easier to see (and feels more "game")
      const bob = Math.sin(nowS * 2.2 + p.x * 0.85) * 0.10;
      const sp = toScreen(Vec2(p.x, p.y + bob));
      if (p.kind === "coin") drawCoin(ctx, sp.x, sp.y, 14 * dpr);
      if (p.kind === "fuel") drawFuel(ctx, sp.x, sp.y, 16 * dpr);
    }

    // car
    drawJeep(
      ctx,
      toScreen,
      car,
      dpr,
      headIdRef.current,
      headImgRef.current,
      headImg2Ref.current,
      miniModeRef.current
    );

    // vignette
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0,0.10)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  };

  return <canvas ref={canvasRef} />;
});

// -------------------- Render helpers --------------------

let skyNoisePattern: CanvasPattern | null = null;

function getSkyNoisePattern(ctx: CanvasRenderingContext2D, seed: number) {
  if (skyNoisePattern) return skyNoisePattern;
  if (typeof document === "undefined") return null;

  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const cctx = c.getContext("2d");
  if (!cctx) return null;

  const rnd = mulberry32((seed ^ 0x6a09e667) >>> 0);
  const img = cctx.createImageData(c.width, c.height);
  for (let i = 0; i < img.data.length; i += 4) {
    // Very subtle grain; helps gradients look less banded.
    const a = Math.floor(6 + rnd() * 18);
    img.data[i + 0] = 255;
    img.data[i + 1] = 255;
    img.data[i + 2] = 255;
    img.data[i + 3] = a;
  }
  cctx.putImageData(img, 0, 0);

  skyNoisePattern = ctx.createPattern(c, "repeat");
  return skyNoisePattern;
}

function drawSkyPro(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  camX: number,
  dpr: number,
  seed: number
) {
  // Nature palette: clean sky, gentle warm horizon, no harsh bands.
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, "#b7e6ff");
  sky.addColorStop(0.44, "#def7ff");
  sky.addColorStop(0.74, "#fff3de");
  sky.addColorStop(1, "#f5d6c0");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  // Subtle film grain (makes gradients look more "premium").
  const pat = getSkyNoisePattern(ctx, seed);
  if (pat) {
    ctx.save();
    ctx.globalAlpha = 0.08;
    ctx.fillStyle = pat;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  // Sun (disc + glow)
  const sx = w * 0.82;
  const sy = h * 0.20;
  const sr = 70 * dpr;
  ctx.save();
  ctx.globalAlpha = 0.90;
  ctx.fillStyle = "rgba(255, 248, 229, 0.96)";
  ctx.beginPath();
  ctx.arc(sx, sy, 30 * dpr, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  const sun = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr);
  sun.addColorStop(0, "rgba(255, 246, 219, 0.92)");
  sun.addColorStop(0.55, "rgba(255, 246, 219, 0.50)");
  sun.addColorStop(1, "rgba(255, 246, 219, 0.0)");
  ctx.fillStyle = sun;
  ctx.beginPath();
  ctx.arc(sx, sy, sr, 0, Math.PI * 2);
  ctx.fill();

  // Clouds (deterministic)
  const rnd = mulberry32((seed ^ 0x51ed270b) >>> 0);
  const drift = (camX * 0.014) % 1;
  const margin = 240 * dpr;

  for (let i = 0; i < 7; i++) {
    const x01 = rnd();
    const y01 = 0.08 + rnd() * 0.22;
    const s01 = 0.55 + rnd() * 0.75;
    const a = 0.22 + rnd() * 0.20;

    // wrap clouds horizontally
    const x = (((x01 - drift + 1) % 1) * (w + margin)) - margin * 0.5;
    const y = h * y01;

    drawCloud(ctx, x, y, 96 * dpr * s01, 36 * dpr * s01, a);
  }

  // Horizon haze (adds depth and makes background layers blend nicer)
  const hz = ctx.createLinearGradient(0, h * 0.42, 0, h);
  hz.addColorStop(0, "rgba(255,255,255,0)");
  hz.addColorStop(1, "rgba(255,255,255,0.18)");
  ctx.fillStyle = hz;
  ctx.fillRect(0, 0, w, h);
}

// Deterministic 1D ridge noise (no allocations, fast, looks natural).
function ridgeNoise(x: number) {
  return (
    Math.sin(x * 0.90) * 0.55 +
    Math.sin(x * 0.37 + 1.9) * 0.28 +
    Math.sin(x * 1.55 - 0.3) * 0.17
  );
}

function drawCloud(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  alpha: number
) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = "#ffffff";

  ctx.beginPath();
  ctx.ellipse(x - w * 0.18, y, w * 0.24, h * 0.40, 0, 0, Math.PI * 2);
  ctx.ellipse(x + w * 0.00, y - h * 0.12, w * 0.32, h * 0.52, 0, 0, Math.PI * 2);
  ctx.ellipse(x + w * 0.22, y, w * 0.24, h * 0.40, 0, 0, Math.PI * 2);
  ctx.ellipse(x + w * 0.06, y + h * 0.06, w * 0.46, h * 0.48, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawHills(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  track: Track,
  camX: number,
  camY: number,
  dpr: number,
  parallax: number,
  color: string,
  alpha: number
) {
  // track/camY are part of the renderer API, but parallax ridges are intentionally independent.
  void track;
  void camY;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();

  // Background ridges should NOT match the road shape. Use a separate ridge noise + parallax.
  const baseY = h * (0.70 - 0.12 * parallax);
  const ampPx = (60 + 110 * parallax) * dpr;
  const freq = 0.08 + 0.06 * parallax;
  ctx.moveTo(0, h);

  // Ensure the ridge reaches the very right edge.
  // Without an explicit sample at x=w, the final segment can drop straight to (w, h)
  // leaving a visible "cut" wedge on some viewport sizes.
  const step = 18 * dpr;
  for (let sx = 0; sx < w; sx += step) {
    const worldX = (camX * parallax) + ((sx - w * 0.5) / (SCALE * dpr)) * 0.9;
    const n = ridgeNoise((worldX + 1200 * parallax) * freq);
    const y = baseY - n * ampPx;
    ctx.lineTo(sx, y);
  }
  {
    const sx = w;
    const worldX = (camX * parallax) + ((sx - w * 0.5) / (SCALE * dpr)) * 0.9;
    const n = ridgeNoise((worldX + 1200 * parallax) * freq);
    const y = baseY - n * ampPx;
    ctx.lineTo(sx, y);
  }

  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawForest(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  camX: number,
  dpr: number,
  parallax: number,
  color: string,
  alpha: number
) {
  // Near-horizon tree line: simple triangles on a rolling ridge.
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;

  const baseY = h * 0.70;
  const amp = 32 * dpr;
  const freq = 0.12;
  const step = 14 * dpr;
  const widthWorld = (w / (SCALE * dpr)) * 0.9;

  // Ridge fill
  ctx.beginPath();
  ctx.moveTo(0, h);
  let lastSx = 0;
  for (let sx = 0; sx <= w; sx += 18 * dpr) {
    lastSx = sx;
    const worldX = (camX * parallax) + ((sx - w * 0.5) / (SCALE * dpr)) * 0.85;
    const n = ridgeNoise((worldX + 999) * freq);
    const y = baseY - n * amp;
    ctx.lineTo(sx, y);
  }
  // Ensure the ridge reaches the right edge to avoid a visible "cut wedge"
  // when the step size doesn't land exactly on w.
  if (lastSx < w) {
    const sx = w;
    const worldX = (camX * parallax) + ((sx - w * 0.5) / (SCALE * dpr)) * 0.85;
    const n = ridgeNoise((worldX + 999) * freq);
    const y = baseY - n * amp;
    ctx.lineTo(sx, y);
  }
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fill();

  // Trees
  ctx.globalAlpha = alpha * 0.90;
  for (let sx = -40 * dpr; sx <= w + 40 * dpr; sx += step) {
    const worldX = (camX * parallax) + ((sx - w * 0.5) / (SCALE * dpr)) * 0.85;
    const n = ridgeNoise((worldX + 333) * (freq * 1.35));
    const ridgeY = baseY - n * amp;

    // Height varies smoothly; clamp so it stays subtle.
    const th = (16 + (n + 1) * 8) * dpr;
    const tw = 7.5 * dpr;

    // Only draw trees roughly within the camera band (cheap cull)
    const camBand = Math.abs(((worldX - camX) / widthWorld));
    if (camBand > 1.1) continue;

    ctx.beginPath();
    ctx.moveTo(sx, ridgeY);
    ctx.lineTo(sx + tw, ridgeY - th);
    ctx.lineTo(sx + tw * 2, ridgeY);
    ctx.closePath();
    ctx.fill();
  }

  ctx.restore();
}

function drawMountains(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  camX: number,
  dpr: number,
  parallax: number,
  color: string,
  alpha: number
) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();

  const baseY = h * 0.52;
  ctx.moveTo(0, h);

  // Deterministic peaks + parallax camera drift.
  // Ensure the ridge reaches the very right edge (avoids a visible wedge cut-off).
  const step = 24 * dpr;
  for (let sx = 0; sx < w; sx += step) {
    const worldX = (camX * parallax) + ((sx - w * 0.5) / (SCALE * dpr)) * 0.85;
    const t = worldX * (0.09 + parallax * 0.03);
    const peak = ridgeNoise(t);
    const y = baseY - (52 + peak * 78) * dpr * (0.68 + parallax * 1.35);
    ctx.lineTo(sx, y);
  }
  {
    const sx = w;
    const worldX = (camX * parallax) + ((sx - w * 0.5) / (SCALE * dpr)) * 0.85;
    const t = worldX * (0.09 + parallax * 0.03);
    const peak = ridgeNoise(t);
    const y = baseY - (52 + peak * 78) * dpr * (0.68 + parallax * 1.35);
    ctx.lineTo(sx, y);
  }

  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawGround(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  track: Track,
  camX: number,
  camY: number,
  dpr: number,
  viewCX: number,
  viewCY: number
) {

  const screenYOfGround = (xWorld: number) => {
    const yWorld = sampleTrackY(track, xWorld);
    return viewCY - (yWorld - camY) * SCALE * dpr;
  };

  // --- Dirt base (gradient) ---
  const dirtGrad = ctx.createLinearGradient(0, 0, 0, h);
  dirtGrad.addColorStop(0, "#6c3f1e");
  dirtGrad.addColorStop(0.55, "#4f2b14");
  dirtGrad.addColorStop(1, "#33170b");

  ctx.fillStyle = dirtGrad;
  ctx.beginPath();
  ctx.moveTo(0, h);
  let lastSx = 0;
  for (let sx = 0; sx <= w; sx += 4 * dpr) {
    lastSx = sx;
    const xWorld = camX + (sx - viewCX) / (SCALE * dpr);
    ctx.lineTo(sx, screenYOfGround(xWorld));
  }
  // Ensure the fill reaches the right edge even when w is not a multiple of the step
  if (lastSx < w) {
    const sx = w;
    const xWorld = camX + (sx - viewCX) / (SCALE * dpr);
    ctx.lineTo(sx, screenYOfGround(xWorld));
  }
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fill();

  // --- Track edge shadow (packed soil) ---
  ctx.strokeStyle = "rgba(0,0,0,0.16)";
  ctx.lineWidth = 22 * dpr;
  ctx.lineCap = "round";
  ctx.beginPath();
  let lastSx2 = 0;
  for (let sx = 0; sx <= w; sx += 6 * dpr) {
    lastSx2 = sx;
    const xWorld = camX + (sx - viewCX) / (SCALE * dpr);
    const y = screenYOfGround(xWorld) + 4 * dpr;
    if (sx === 0) ctx.moveTo(sx, y);
    else ctx.lineTo(sx, y);
  }
  if (lastSx2 < w) {
    const sx = w;
    const xWorld = camX + (sx - viewCX) / (SCALE * dpr);
    const y = screenYOfGround(xWorld) + 4 * dpr;
    ctx.lineTo(sx, y);
  }
  ctx.stroke();

  // --- Rock/soil texture (subtle) ---
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  for (let i = 0; i < 90; i++) {
    const sx = ((i * 97) % 1000) / 1000 * w;
    const xWorld = camX + (sx - viewCX) / (SCALE * dpr);
    const sy = screenYOfGround(xWorld) + (34 + ((i * 53) % 120)) * dpr;
    const r = (6 + (i % 7)) * dpr;
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = "rgba(0,0,0,0.06)";
  for (let i = 0; i < 70; i++) {
    const sx = ((i * 211) % 1000) / 1000 * w;
    const xWorld = camX + (sx - viewCX) / (SCALE * dpr);
    const sy = screenYOfGround(xWorld) + (60 + ((i * 89) % 140)) * dpr;
    const r = (10 + (i % 9)) * dpr;
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // --- Grass edge (clean + soft highlight) ---
  ctx.strokeStyle = "#43c566";
  ctx.lineWidth = 11 * dpr;
  ctx.lineCap = "round";
  ctx.beginPath();
  let lastSx3 = 0;
  for (let sx = 0; sx <= w; sx += 5 * dpr) {
    lastSx3 = sx;
    const xWorld = camX + (sx - viewCX) / (SCALE * dpr);
    const y = screenYOfGround(xWorld);
    if (sx === 0) ctx.moveTo(sx, y);
    else ctx.lineTo(sx, y);
  }
  if (lastSx3 < w) {
    const sx = w;
    const xWorld = camX + (sx - viewCX) / (SCALE * dpr);
    const y = screenYOfGround(xWorld);
    ctx.lineTo(sx, y);
  }
  ctx.stroke();

  ctx.strokeStyle = "rgba(255,255,255,0.38)";
  ctx.lineWidth = 3.5 * dpr;
  ctx.beginPath();
  let lastSx4 = 0;
  for (let sx = 0; sx <= w; sx += 5 * dpr) {
    lastSx4 = sx;
    const xWorld = camX + (sx - viewCX) / (SCALE * dpr);
    const y = screenYOfGround(xWorld) - 3.5 * dpr;
    if (sx === 0) ctx.moveTo(sx, y);
    else ctx.lineTo(sx, y);
  }
  if (lastSx4 < w) {
    const sx = w;
    const xWorld = camX + (sx - viewCX) / (SCALE * dpr);
    const y = screenYOfGround(xWorld) - 3.5 * dpr;
    ctx.lineTo(sx, y);
  }
  ctx.stroke();

  // --- Grass tufts (subtle; deterministic per world-x) ---
  const rand01 = (x: number) => {
    const s = Math.sin(x * 12.9898) * 43758.5453;
    return s - Math.floor(s);
  };
  ctx.strokeStyle = "rgba(25, 90, 55, 0.32)";
  ctx.lineWidth = 2 * dpr;
  ctx.lineCap = "round";
  for (let sx = 0; sx <= w; sx += 16 * dpr) {
    const xWorld = camX + (sx - viewCX) / (SCALE * dpr);
    const r = rand01(Math.floor(xWorld * 2));
    if (r < 0.55) continue;
    const y = screenYOfGround(xWorld) - 2.5 * dpr;
    const h1 = (6 + rand01(Math.floor(xWorld * 3.3)) * 10) * dpr;
    const x2 = sx + (rand01(Math.floor(xWorld * 4.7)) * 6 - 3) * dpr;
    ctx.beginPath();
    ctx.moveTo(sx, y);
    ctx.lineTo(x2, y - h1);
    ctx.stroke();
  }
}

function drawCoin(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.save();
  ctx.fillStyle = "#ffd60a";
  ctx.strokeStyle = "rgba(0,0,0,0.25)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.beginPath();
  ctx.arc(x - r * 0.25, y - r * 0.25, r * 0.35, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawFuel(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  // Jerrycan style (closer to a real fuel can: bold outline + handle cutout + cap + inner emboss)
  ctx.save();
  ctx.translate(x, y);

  const w = s * 1.55;
  const h = s * 1.90;
  const r = Math.max(2, s * 0.16);

  const outline = Math.max(2, s * 0.14);

  // Main body
  ctx.fillStyle = "#e11d2e"; // red can
  ctx.strokeStyle = "#0f172a"; // bold outline
  ctx.lineWidth = outline;

  roundRect(ctx, -w / 2, -h / 2, w, h, r);
  ctx.fill();
  ctx.stroke();

  // Handle cutout (punch through)
  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  roundRect(ctx, -w * 0.32, -h * 0.47, w * 0.40, h * 0.22, r * 0.65);
  ctx.fill();
  ctx.restore();

  // Handle outline around the cutout (to match the sample logo)
  ctx.strokeStyle = "#0f172a";
  ctx.lineWidth = outline * 0.8;
  roundRect(ctx, -w * 0.32, -h * 0.47, w * 0.40, h * 0.22, r * 0.65);
  ctx.stroke();

  // Spout / cap
  ctx.fillStyle = "#0f172a";
  roundRect(ctx, w * 0.10, -h * 0.63, w * 0.38, h * 0.18, r * 0.55);
  ctx.fill();
  // Small cap highlight
  ctx.fillStyle = "rgba(255,255,255,0.25)";
  roundRect(ctx, w * 0.16, -h * 0.60, w * 0.18, h * 0.10, r * 0.45);
  ctx.fill();

  // Embossed inner panel
  ctx.strokeStyle = "rgba(255,255,255,0.65)";
  ctx.lineWidth = outline * 0.55;
  roundRect(ctx, -w * 0.28, -h * 0.18, w * 0.56, h * 0.52, r * 0.8);
  ctx.stroke();

  // Inner "X" emboss (white like sample)
  ctx.strokeStyle = "rgba(255,255,255,0.92)";
  ctx.lineWidth = outline * 0.65;
  ctx.lineCap = "round";
  const x0 = -w * 0.18;
  const x1 = w * 0.18;
  const y0 = -h * 0.02;
  const y1 = h * 0.26;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.moveTo(x1, y0);
  ctx.lineTo(x0, y1);
  ctx.stroke();

  // A small specular highlight for depth
  ctx.fillStyle = "rgba(255,255,255,0.16)";
  roundRect(ctx, -w * 0.40, -h * 0.42, w * 0.22, h * 0.70, r * 0.8);
  ctx.fill();

  ctx.restore();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function drawJeep(
  ctx: CanvasRenderingContext2D,
  toScreen: (v: planck.Vec2) => { x: number; y: number },
  car: CarRig,
  dpr: number,
  headId: HeadId,
  headImg: HTMLImageElement | null,
  headImg2: HTMLImageElement | null,
  miniMode: boolean
) {
  const chassis = car.chassis;
  const p = chassis.getPosition();
  const a = chassis.getAngle();
  const sp = toScreen(p);

  // soft shadow: looks nice on desktop, but in Mini Apps it can read as a visual bug
  // (an extra "blob" that doesn't match the terrain perspective), so keep it desktop-only.
  if (!miniMode) {
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.ellipse(sp.x, sp.y + 58 * dpr, 92 * dpr, 18 * dpr, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // wheels
  drawWheel(ctx, toScreen(car.wheel1.getPosition()), car.wheel1.getAngle(), 0.34, dpr);
  drawWheel(ctx, toScreen(car.wheel2.getPosition()), car.wheel2.getAngle(), 0.34, dpr);

  ctx.save();
  ctx.translate(sp.x, sp.y);
  ctx.rotate(-a);
  // IMPORTANT: In mini-app, the viewport SCALE tends to be lower than desktop.
  // Previously the Jeep body was rendered in fixed pixel units (only DPR-scaled),
  // while wheels used world meters * SCALE. That made wheels look "too small"
  // in Mini Apps. We scale the body by SCALE relative to a baseline so body
  // and wheels stay visually consistent.
  const BODY_BASE_PX_PER_M = 45; // tuned against desktop default (keeps desktop look unchanged)
  const bodyScale = miniMode ? (SCALE / BODY_BASE_PX_PER_M) : 1;
  ctx.scale(dpr * bodyScale, dpr * bodyScale);

  // Jeep body (shaded)
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = "rgba(0,0,0,0.55)";
  const bodyGrad = ctx.createLinearGradient(0, -60, 0, 50);
  bodyGrad.addColorStop(0, "#ff3b4c");
  bodyGrad.addColorStop(0.55, "#e11d2e");
  bodyGrad.addColorStop(1, "#a30f1f");
  ctx.fillStyle = bodyGrad;

  ctx.beginPath();
  ctx.moveTo(-54, -10);
  ctx.lineTo(-54, 10);
  ctx.quadraticCurveTo(-54, 34, -28, 34);
  ctx.lineTo(44, 34);
  ctx.quadraticCurveTo(62, 34, 66, 16);
  ctx.lineTo(72, 16);
  ctx.quadraticCurveTo(80, 16, 80, 6);
  ctx.lineTo(80, -6);
  ctx.quadraticCurveTo(80, -20, 60, -20);
  ctx.lineTo(18, -20);
  ctx.lineTo(6, -40);
  ctx.quadraticCurveTo(0, -52, -18, -52);
  ctx.lineTo(-44, -52);
  ctx.quadraticCurveTo(-60, -52, -60, -34);
  ctx.lineTo(-60, -10);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // subtle highlight
  ctx.strokeStyle = "rgba(255,255,255,0.16)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-52, -10);
  ctx.lineTo(-52, 8);
  ctx.quadraticCurveTo(-52, 28, -30, 28);
  ctx.lineTo(36, 28);
  ctx.stroke();

  // window
  ctx.fillStyle = "rgba(200,240,255,0.9)";
  ctx.strokeStyle = "rgba(0,0,0,0.45)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-34, -22);
  ctx.lineTo(-6, -22);
  ctx.lineTo(-14, -46);
  ctx.lineTo(-34, -46);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // roll bar
  ctx.strokeStyle = "rgba(0,0,0,0.55)";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(-4, -20);
  ctx.lineTo(-4, -60);
  ctx.lineTo(18, -60);
  ctx.stroke();

  // driver body (simple silhouette so the head feels "connected")
  ctx.save();
  ctx.fillStyle = "#2b1a0f";
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 3;
  roundRect(ctx, -24, -32, 18, 18, 6);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  // head sprite (pixel-art; keep crisp)
  const head = headId === "brian" ? headImg2 : headImg;
  if (head && head.complete) {
    ctx.imageSmoothingEnabled = false;
    const cfg = HEADS[headId].draw;
    ctx.drawImage(head, cfg.x, cfg.y, cfg.size, cfg.size);
  }

  ctx.restore();
}

function drawWheel(ctx: CanvasRenderingContext2D, sp: { x: number; y: number }, ang: number, radiusM: number, dpr: number) {
  const r = radiusM * SCALE * dpr;
  ctx.save();
  ctx.translate(sp.x, sp.y);
  ctx.rotate(-ang);

  ctx.fillStyle = "#262626";
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#cfcfcf";
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.62, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 3 * dpr;
  for (let i = 0; i < 6; i++) {
    ctx.rotate((Math.PI * 2) / 6);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(r * 0.62, 0);
    ctx.stroke();
  }

  ctx.fillStyle = "#e6e6e6";
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.18, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}
