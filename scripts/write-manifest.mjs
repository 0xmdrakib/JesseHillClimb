import fs from "fs";
import path from "path";

/**
 * Keeps `public/.well-known/farcaster.json` aligned with your deploy URL.
 *
 * Important: Once you generate/sign `accountAssociation` (Base Build / Farcaster tools),
 * changing the manifest can invalidate the signature. If the manifest is already signed,
 * this script will NO-OP by default.
 */

const ROOT = process.cwd();
const MANIFEST_PATH = path.join(ROOT, "public", ".well-known", "farcaster.json");

function normalizeUrl(u) {
  if (!u) return "";
  let url = String(u).trim();
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  return url.replace(/\/$/, "");
}

function resolveBaseUrl() {
  const direct =
    process.env.NEXT_PUBLIC_URL ||
    process.env.PUBLIC_URL ||
    process.env.APP_URL ||
    "";
  if (direct) return normalizeUrl(direct);
  if (process.env.VERCEL_URL) return normalizeUrl(process.env.VERCEL_URL);
  return "";
}

function isSigned(assoc) {
  if (!assoc) return false;
  return Boolean(assoc.header && assoc.payload && assoc.signature);
}

function main() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    console.warn(`[manifest] missing: ${MANIFEST_PATH}`);
    process.exit(0);
  }

  const raw = fs.readFileSync(MANIFEST_PATH, "utf8");
  const json = JSON.parse(raw);

  if (isSigned(json.accountAssociation) && process.env.FORCE_MANIFEST_WRITE !== "true") {
    console.log("[manifest] already signed; skipping write to avoid invalidating signature");
    process.exit(0);
  }

  const baseUrl = resolveBaseUrl() || "https://YOUR_DOMAIN";

  json.miniapp = json.miniapp || {};
  json.miniapp.homeUrl = baseUrl;
  json.miniapp.iconUrl = `${baseUrl}/icon.png`;
  json.miniapp.splashImageUrl = `${baseUrl}/splash.png`;
  json.miniapp.heroImageUrl = `${baseUrl}/hero.png`;
  json.miniapp.screenshotUrls = [`${baseUrl}/embed.png`, `${baseUrl}/hero.png`];
  json.miniapp.ogImageUrl = `${baseUrl}/hero.png`;
  json.miniapp.ogTitle = json.miniapp.ogTitle || json.miniapp.name;

  // If webhookUrl exists (or is a placeholder), keep it aligned to the deploy URL.
  // Base docs note webhookUrl should be a valid, reachable URL when present.
  // If you do NOT use notifications, you may remove webhookUrl entirely.
  const currentWebhook = json.miniapp.webhookUrl;
  if (!currentWebhook || String(currentWebhook).includes("YOUR_DOMAIN")) {
    json.miniapp.webhookUrl = `${baseUrl}/api/webhook`;
  }

  const noindex =
    process.env.NEXT_PUBLIC_NOINDEX === "true"
      ? true
      : process.env.NODE_ENV !== "production";
  json.miniapp.noindex = noindex;

  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(json, null, 2) + "\n", "utf8");
  console.log(`[manifest] wrote ${MANIFEST_PATH} (homeUrl=${baseUrl})`);
}

main();
