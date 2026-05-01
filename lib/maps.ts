export type MapId = "hills" | "desert" | "arctic" | "moon";

export interface MapColors {
  skyTop: string;
  skyMid: string;
  skyHorizon: string;
  skyBottom: string;
  dirtTop: string;
  dirtMid: string;
  dirtBottom: string;
  grassColor: string;
  grassHighlight: string;
  mountainFar: string;
  mountainNear: string;
  hillFar: string;
  hillMid: string;
  hillNear: string;
  forestColor: string;
  sunColor: string;
  sunGlow: string;
}

export interface MapConfig {
  id: MapId;
  name: string;
  emoji: string;
  tagline: string;
  gravity: number;         // default -10
  groundFriction: number;  // default 0.86
  iceZones: boolean;       // random low-friction patches
  seedOffset: number;      // XOR with run seed for unique terrain
  colors: MapColors;
  fogDensity: number;      // 0 = none
  snowParticles: boolean;
  dustParticles: boolean;
}

export const MAPS: Record<MapId, MapConfig> = {
  hills: {
    id: "hills",
    name: "Countryside",
    emoji: "🌲",
    tagline: "Classic green hills. A good place to start.",
    gravity: -10,
    groundFriction: 0.86,
    iceZones: false,
    seedOffset: 0,
    fogDensity: 0,
    snowParticles: false,
    dustParticles: false,
    colors: {
      skyTop: "#a8d4f5",
      skyMid: "#c8e8ff",
      skyHorizon: "#e8f4ff",
      skyBottom: "#f5d6c0",
      dirtTop: "#6c3f1e",
      dirtMid: "#4f2b14",
      dirtBottom: "#33170b",
      grassColor: "#43c566",
      grassHighlight: "rgba(255,255,255,0.38)",
      mountainFar: "#c7d7e6",
      mountainNear: "#b1c7dc",
      hillFar: "#c5e7d4",
      hillMid: "#a8dcc3",
      hillNear: "#8fcaa9",
      forestColor: "#6aa886",
      sunColor: "rgba(255,248,229,0.96)",
      sunGlow: "rgba(255,246,219,0.92)",
    },
  },

  desert: {
    id: "desert",
    name: "Desert",
    emoji: "🏜️",
    tagline: "Scorching dunes. Watch your fuel.",
    gravity: -10,
    groundFriction: 0.84, // Increased friction to help climb hills
    iceZones: false,
    seedOffset: 0x1234abcd,
    fogDensity: 0.04,
    snowParticles: false,
    dustParticles: true,
    colors: {
      skyTop: "#ff8c42",
      skyMid: "#ffb347",
      skyHorizon: "#ffd580",
      skyBottom: "#ffe5a0",
      dirtTop: "#c4892a",
      dirtMid: "#a06520",
      dirtBottom: "#7a4a14",
      grassColor: "#d4a843",
      grassHighlight: "rgba(255,230,150,0.35)",
      mountainFar: "#e8c87a",
      mountainNear: "#d4aa5a",
      hillFar: "#e0c06a",
      hillMid: "#cca042",
      hillNear: "#b88030",
      forestColor: "#8ba030",
      sunColor: "rgba(255,200,100,0.98)",
      sunGlow: "rgba(255,160,60,0.85)",
    },
  },

  arctic: {
    id: "arctic",
    name: "Arctic",
    emoji: "❄️",
    tagline: "Icy and treacherous. Grip is everything.",
    gravity: -10,
    groundFriction: 0.35,
    iceZones: true,
    seedOffset: 0xdeadbeef,
    fogDensity: 0.08,
    snowParticles: true,
    dustParticles: false,
    colors: {
      skyTop: "#1a2a4a",
      skyMid: "#2a4a7a",
      skyHorizon: "#6a9ac4",
      skyBottom: "#aaccdd",
      dirtTop: "#9ab8cc",
      dirtMid: "#7a9ab0",
      dirtBottom: "#5a7a90",
      grassColor: "#d0e8f4",
      grassHighlight: "rgba(255,255,255,0.55)",
      mountainFar: "#8aa8c0",
      mountainNear: "#aac8dc",
      hillFar: "#c0d8e8",
      hillMid: "#d0e4f0",
      hillNear: "#dceef6",
      forestColor: "#4a7890",
      sunColor: "rgba(220,240,255,0.85)",
      sunGlow: "rgba(180,220,255,0.65)",
    },
  },

  moon: {
    id: "moon",
    name: "Moon",
    emoji: "🌙",
    tagline: "Low gravity mayhem. Physics goes wild.",
    gravity: -5.0, // Increased gravity from -3.2 so vehicles don't fly out of control
    groundFriction: 0.55,
    iceZones: false,
    seedOffset: 0x9e3779b9,
    fogDensity: 0,
    snowParticles: false,
    dustParticles: true,
    colors: {
      skyTop: "#03050a",
      skyMid: "#080d1a",
      skyHorizon: "#101828",
      skyBottom: "#151f30",
      dirtTop: "#b0b8c4",
      dirtMid: "#8890a0",
      dirtBottom: "#606878",
      grassColor: "#8898a8",
      grassHighlight: "rgba(200,220,255,0.30)",
      mountainFar: "#404858",
      mountainNear: "#505868",
      hillFar: "#606878",
      hillMid: "#707888",
      hillNear: "#808898",
      forestColor: "#505868",
      sunColor: "rgba(255,255,220,0.96)",
      sunGlow: "rgba(255,255,200,0.60)",
    },
  },
};

const MAP_KEY = "jhc_map_v1";

export function loadMap(): MapId {
  if (typeof window === "undefined") return "hills";
  const v = window.localStorage.getItem(MAP_KEY);
  if (v === "desert" || v === "arctic" || v === "moon") return v;
  return "hills";
}

export function saveMap(id: MapId) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(MAP_KEY, id);
}
