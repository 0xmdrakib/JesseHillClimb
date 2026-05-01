export type AchievementId =
  | "first_run"
  | "reach_100m"
  | "reach_500m"
  | "reach_1000m"
  | "first_flip"
  | "triple_flip"
  | "speed_demon"
  | "fuel_saver"
  | "coin_collector"
  | "all_vehicles"
  | "moon_walker";

export interface AchievementDef {
  id: AchievementId;
  name: string;
  emoji: string;
  description: string;
  reward: number;  // coins
}

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: "first_run",      name: "First Ride",      emoji: "🏁", description: "Complete your first run",               reward: 50    },
  { id: "reach_100m",     name: "100m Club",       emoji: "🎯", description: "Reach 100m in one run",                reward: 100   },
  { id: "reach_500m",     name: "Mountain Goat",   emoji: "🏔️", description: "Reach 500m in one run",                reward: 500   },
  { id: "reach_1000m",    name: "1km Legend",      emoji: "👑", description: "Reach 1000m in one run",               reward: 1000  },
  { id: "first_flip",     name: "First Flip",      emoji: "🌀", description: "Do your first backflip",               reward: 75    },
  { id: "triple_flip",    name: "Triple Threat",   emoji: "🎪", description: "3 flips in a single jump",             reward: 300   },
  { id: "speed_demon",    name: "Speed Demon",     emoji: "💨", description: "Reach 80 km/h",                        reward: 150   },
  { id: "fuel_saver",     name: "Fuel Miser",      emoji: "⛽", description: "Reach 200m with >50% fuel remaining",  reward: 200   },
  { id: "coin_collector", name: "Coin Hoarder",    emoji: "🪙", description: "Collect 100 coins in one run",         reward: 150   },
  { id: "all_vehicles",   name: "Gearhead",        emoji: "🔧", description: "Unlock all vehicles",                  reward: 500   },
  { id: "moon_walker",    name: "Moon Walker",     emoji: "🌙", description: "Reach 300m on the Moon map",           reward: 400   },
];

export type UnlockedAchievements = Partial<Record<AchievementId, boolean>>;

const ACH_KEY = "jhc_achievements_v1";

export function loadAchievements(): UnlockedAchievements {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(ACH_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveAchievements(u: UnlockedAchievements) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ACH_KEY, JSON.stringify(u));
  } catch { /* ignore */ }
}

export function checkRunAchievements(params: {
  distanceM: number;
  coins: number;
  flips: number;
  maxSpeedKmh: number;
  fuelRemaining: number;
  map: string;
  prevUnlocked: UnlockedAchievements;
}): { newly: AchievementId[]; totalReward: number } {
  const { distanceM, coins, flips, maxSpeedKmh, fuelRemaining, map, prevUnlocked } = params;
  const newly: AchievementId[] = [];

  const check = (id: AchievementId, cond: boolean) => {
    if (cond && !prevUnlocked[id]) newly.push(id);
  };

  check("first_run",      true);
  check("reach_100m",     distanceM >= 100);
  check("reach_500m",     distanceM >= 500);
  check("reach_1000m",    distanceM >= 1000);
  check("first_flip",     flips >= 1);
  check("triple_flip",    flips >= 3);
  check("speed_demon",    maxSpeedKmh >= 80);
  check("fuel_saver",     distanceM >= 200 && fuelRemaining > 50);
  check("coin_collector", coins >= 100);
  check("moon_walker",    map === "moon" && distanceM >= 300);

  const ach = ACHIEVEMENTS;
  const totalReward = newly.reduce((s, id) => {
    const def = ach.find((a) => a.id === id);
    return s + (def?.reward ?? 0);
  }, 0);

  return { newly, totalReward };
}
