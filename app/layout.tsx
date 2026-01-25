import "./globals.css";
import type { Metadata, Viewport } from "next";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

// IMPORTANT:
// Base's "Verify & Add URL" checks for <meta name="base:app_id" ...> in the initial HTML <head>.
// Next.js can stream metadata, which may place tags in <body> in some cases.
// To keep Base/Farcaster parsers happy, keep metadata synchronous/static and put base:app_id in app/head.tsx.

const URL = process.env.NEXT_PUBLIC_URL || "https://jessehillclimb.online";
const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || "Jesse Hill Climb";
const BASE_APP_ID = (process.env.NEXT_PUBLIC_BASE_APP_ID || "6976213f88e3bac59cf3d818").trim();

const imageUrl = process.env.NEXT_PUBLIC_APP_HERO_IMAGE || `${URL}/embed.png`;
const splashImageUrl = process.env.NEXT_PUBLIC_SPLASH_IMAGE || `${URL}/splash.png`;
const splashBackgroundColor = process.env.NEXT_PUBLIC_SPLASH_BG || "#8fd3ff";

const embed = {
  version: "1",
  imageUrl,
  button: {
    title: `Play ${APP_NAME}`.slice(0, 32),
    action: {
      type: "launch_frame",
      name: APP_NAME.slice(0, 32),
      url: URL,
      splashImageUrl,
      splashBackgroundColor,
    },
  },
};

export const metadata: Metadata = {
  title: APP_NAME,
  description: "Classic hill-climb mini game optimized for Base + Farcaster Mini Apps.",
  other: {
    // Base + Farcaster embed discovery
    "fc:miniapp": JSON.stringify(embed),
    "fc:frame": JSON.stringify(embed),
    // Redundant with app/head.tsx, but harmless and useful for some parsers.
    "base:app_id": BASE_APP_ID,
  },
  openGraph: {
    title: APP_NAME,
    description: "Drive the hills, collect coins, share your best run.",
    images: [{ url: imageUrl }],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
