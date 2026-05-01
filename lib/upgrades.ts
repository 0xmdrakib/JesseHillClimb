import type { VehicleId } from "./vehicles";

export type UpgradeCategory = "engine" | "suspension" | "tires" | "fuelTank";
export const UPGRADE_CATEGORIES: UpgradeCategory[] = ["engine", "suspension", "tires", "fuelTank"];

export const MAX_LEVEL = 5;

// Cost in coins per level (index = level 1..5)
export const UPGRADE_COSTS: number[] = [100, 250, 500, 1000, 2000];

export const UPGRADE_META: Record<UpgradeCategory, { name: string; emoji: string; description: string }> = {
  engine:     { name: "Engine",     emoji: "⚙️",  description: "+15% torque & top speed per level" },
  suspension: { name: "Suspension", emoji: "🔩",  description: "Smoother handling, better damping" },
  tires:      { name: "Tires",      emoji: "🛞",  description: "+10% grip & brake force per level" },
  fuelTank:   { name: "Fuel Tank",  emoji: "⛽",  description: "+20% fuel capacity per level" },
};

// Per-category multipliers applied to base physics values
export function getUpgradeMultiplier(category: UpgradeCategory, level: number): number {
  const l = Math.max(0, Math.min(MAX_LEVEL, level));
  switch (category) {
    case "engine":     return 1 + 0.15 * l;   // torque + speed
    case "suspension": return 1 + 0.12 * l;   // suspension freq
    case "tires":      return 1 + 0.10 * l;   // friction
    case "fuelTank":   return 1 + 0.20 * l;   // fuel capacity
  }
}

export type UpgradeLevels = Record<UpgradeCategory, number>;
export type AllUpgrades = Record<VehicleId, UpgradeLevels>;

export function defaultUpgradeLevels(): UpgradeLevels {
  return { engine: 0, suspension: 0, tires: 0, fuelTank: 0 };
}

const UPGRADES_KEY = "jhc_upgrades_v2";

export function loadAllUpgrades(): AllUpgrades {
  if (typeof window === "undefined") return emptyAllUpgrades();
  try {
    const raw = window.localStorage.getItem(UPGRADES_KEY);
    if (!raw) return emptyAllUpgrades();
    const parsed = JSON.parse(raw) as AllUpgrades;
    return mergeWithDefaults(parsed);
  } catch {
    return emptyAllUpgrades();
  }
}

export function saveAllUpgrades(all: AllUpgrades) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(UPGRADES_KEY, JSON.stringify(all));
  } catch { /* ignore */ }
}

function emptyAllUpgrades(): AllUpgrades {
  return {
    jeep: defaultUpgradeLevels(),
    bicycle: defaultUpgradeLevels(),
    sportsCar: defaultUpgradeLevels(),
  };
}

function mergeWithDefaults(partial: Partial<AllUpgrades>): AllUpgrades {
  const def = emptyAllUpgrades();
  const vIds = Object.keys(def) as VehicleId[];
  for (const vid of vIds) {
    def[vid] = { ...defaultUpgradeLevels(), ...(partial[vid] ?? {}) };
  }
  return def;
}

export function upgradeCostForLevel(current: number): number {
  if (current >= MAX_LEVEL) return Infinity;
  return UPGRADE_COSTS[current] ?? Infinity;
}
