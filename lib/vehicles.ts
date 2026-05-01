export type VehicleId = "jeep" | "bicycle" | "sportsCar";

export interface VehiclePhysics {
  chassisDensity: number;
  chassisAngularDamping: number;
  chassisLinearDamping: number;
  wheelRadius: number;
  wheelbase: number;       // half-distance between wheel centers
  wheelDensity: number;
  wheelFriction: number;
  wheelAngularDamping: number;
  suspensionHz: number;
  suspensionDamping: number;
  maxMotorSpeed: number;   // rad/s
  maxMotorTorque: number;
  brakeMaxTorque: number;
  fuelCapacity: number;
  fuelDrainBase: number;
  fuelDrainThrottle: number;
  spawnY: number;          // chassis height offset above terrain
}

export interface VehicleVisual {
  bodyColor: string;
  accentColor: string;
  highlightColor: string;
  bodyShape: VehicleId;
}

export interface VehicleStat {
  speed: number;      // 1-5
  grip: number;       // 1-5
  stability: number;  // 1-5
  fuel: number;       // 1-5
}

export interface VehicleConfig {
  id: VehicleId;
  name: string;
  emoji: string;
  tagline: string;
  price: number;
  stats: VehicleStat;
  physics: VehiclePhysics;
  visual: VehicleVisual;
}

export const VEHICLES: Record<VehicleId, VehicleConfig> = {
  jeep: {
    id: "jeep",
    name: "Jeep",
    emoji: "🚙",
    tagline: "Classic off-road legend. Balanced in every way.",
    price: 0,
    stats: { speed: 3, grip: 4, stability: 4, fuel: 3 },
    physics: {
      // Jeep-only retune: heavier planted chassis, grippier tires, and less bouncy suspension.
      chassisDensity: 4.75,
      chassisAngularDamping: 3.05,
      chassisLinearDamping: 0.13,
      wheelRadius: 0.39,
      wheelbase: 0.92,
      wheelDensity: 1.15,
      wheelFriction: 1.28,
      wheelAngularDamping: 1.08,
      suspensionHz: 5.75,
      suspensionDamping: 0.96,
      maxMotorSpeed: 30,
      maxMotorTorque: 330,
      brakeMaxTorque: 270,
      fuelCapacity: 100,
      fuelDrainBase: 0.16,
      fuelDrainThrottle: 1.35,
      spawnY: 1.22,
    },
    visual: {
      bodyColor: "#e11d2e",
      accentColor: "#a30f1f",
      highlightColor: "#ff6b7a",
      bodyShape: "jeep",
    },
  },

  bicycle: {
    id: "bicycle",
    name: "Drift Bike",
    emoji: "🏍️",
    tagline: "Lightweight & nimble. Easy to flip, hard to master.",
    price: 0,
    stats: { speed: 4, grip: 4, stability: 3, fuel: 5 },
    physics: {
      chassisDensity: 3.5,
      chassisAngularDamping: 2.0,
      chassisLinearDamping: 0.10,
      wheelRadius: 0.32,
      wheelbase: 0.76,
      wheelDensity: 0.5,
      wheelFriction: 1.1,
      wheelAngularDamping: 0.8,
      suspensionHz: 5.5,
      suspensionDamping: 0.92,
      maxMotorSpeed: 42,
      maxMotorTorque: 200,
      brakeMaxTorque: 160,
      fuelCapacity: 80,
      fuelDrainBase: 0.12,
      fuelDrainThrottle: 0.85,
      spawnY: 0.92,
    },
    visual: {
      bodyColor: "#eab308",
      accentColor: "#ca8a04",
      highlightColor: "#fde047",
      bodyShape: "bicycle",
    },
  },

  sportsCar: {
    id: "sportsCar",
    name: "Sports Car",
    emoji: "🏎️",
    tagline: "Blazing top speed. Terrible off-road.",
    price: 500,
    stats: { speed: 5, grip: 3, stability: 4, fuel: 2 },
    physics: {
      chassisDensity: 4.7,
      chassisAngularDamping: 2.9,
      chassisLinearDamping: 0.16,
      wheelRadius: 0.31,
      wheelbase: 1.05,
      wheelDensity: 1.0,
      wheelFriction: 0.96,
      wheelAngularDamping: 0.95,
      suspensionHz: 5.4,
      suspensionDamping: 0.90,
      maxMotorSpeed: 40,
      maxMotorTorque: 390,
      brakeMaxTorque: 300,
      fuelCapacity: 82,
      fuelDrainBase: 0.22,
      fuelDrainThrottle: 1.75,
      spawnY: 1.12,
    },
    visual: {
      bodyColor: "#4f46e5",
      accentColor: "#1e1b4b",
      highlightColor: "#818cf8",
      bodyShape: "sportsCar",
    },
  },

};

const VEHICLE_KEY = "jhc_vehicle_v1";

export function loadVehicle(): VehicleId {
  if (typeof window === "undefined") return "jeep";
  const v = window.localStorage.getItem(VEHICLE_KEY);
  if (v === "bicycle" || v === "sportsCar") return v;
  return "jeep";
}

export function saveVehicle(id: VehicleId) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(VEHICLE_KEY, id);
}
