import type { VehicleId } from "./vehicles";

export type UnlockedVehicles = Partial<Record<VehicleId, boolean>>;

const GARAGE_KEY = "jhc_garage_v1";
const COINS_KEY  = "jhc_coins_v1";

// ─── Coins (local wallet) ───────────────────────────────────────────────────

export function loadLocalCoins(): number {
  if (typeof window === "undefined") return 0;
  try {
    return Math.max(0, parseInt(window.localStorage.getItem(COINS_KEY) ?? "0", 10) || 0);
  } catch { return 0; }
}

export function saveLocalCoins(amount: number) {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(COINS_KEY, String(Math.max(0, Math.floor(amount)))); }
  catch { /* ignore */ }
}

export function addLocalCoins(amount: number): number {
  const next = loadLocalCoins() + Math.max(0, Math.floor(amount));
  saveLocalCoins(next);
  return next;
}

export function spendLocalCoins(amount: number): boolean {
  const cur = loadLocalCoins();
  if (cur < amount) return false;
  saveLocalCoins(cur - amount);
  return true;
}

// ─── Garage / unlocked vehicles ─────────────────────────────────────────────

export function loadGarage(): UnlockedVehicles {
  if (typeof window === "undefined") return { jeep: true };
  try {
    const raw = window.localStorage.getItem(GARAGE_KEY);
    const parsed: UnlockedVehicles = raw ? JSON.parse(raw) : {};
    parsed.jeep = true;      // jeep is always free
    parsed.bicycle = true;   // bicycle is also free
    return parsed;
  } catch {
    return { jeep: true, bicycle: true };
  }
}

export function saveGarage(g: UnlockedVehicles) {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(GARAGE_KEY, JSON.stringify(g)); }
  catch { /* ignore */ }
}

export function isVehicleUnlocked(id: VehicleId, garage: UnlockedVehicles): boolean {
  if (id === "jeep" || id === "bicycle") return true;
  return Boolean(garage[id]);
}

export function unlockVehicle(id: VehicleId, garage: UnlockedVehicles): UnlockedVehicles {
  const next = { ...garage, [id]: true };
  saveGarage(next);
  return next;
}

// Try to purchase a vehicle with coins. Returns {success, newGarage, newCoins}
export function purchaseVehicle(
  id: VehicleId,
  price: number,
  garage: UnlockedVehicles,
): { success: boolean; newGarage: UnlockedVehicles; newCoins: number } {
  if (isVehicleUnlocked(id, garage)) {
    return { success: true, newGarage: garage, newCoins: loadLocalCoins() };
  }
  const ok = spendLocalCoins(price);
  if (!ok) return { success: false, newGarage: garage, newCoins: loadLocalCoins() };
  const newGarage = unlockVehicle(id, garage);
  return { success: true, newGarage, newCoins: loadLocalCoins() };
}
