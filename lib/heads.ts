export type HeadId = "jesse" | "brian";

// Per-head placement so pixel-art heads sit naturally inside the jeep cabin.
// Values are in *canvas pixels* (before DPR scaling).
export const HEADS: Record<
  HeadId,
  { label: string; src: string; draw: { x: number; y: number; size: number } }
> = {
  // Slightly more forward + lower = "seated" feel.
  jesse: { label: "Jesse", src: "/assets/heads/head_jesse.png", draw: { x: -26, y: -70, size: 36 } },
  // Brian head needs a touch more size + slightly different anchor.
  brian: { label: "Brian", src: "/assets/heads/head_brian.png", draw: { x: -27, y: -71, size: 36 } },
};

const KEY = "hc_head";

export function loadHead(): HeadId {
  if (typeof window === "undefined") return "jesse";
  const v = window.localStorage.getItem(KEY);
  return v === "brian" ? "brian" : "jesse";
}

export function saveHead(id: HeadId) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, id);
}
