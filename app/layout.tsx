import "./globals.css";
import type { Metadata } from "next";

// Mini App embed metadata (Base/Farcaster)
// - Farcaster spec: `fc:miniapp` meta tag is the preferred format (and `fc:frame` is
//   supported for backward compatibility).
// - Base docs: ensure your `homeUrl` has embed metadata.
export async function generateMetadata(): Promise<Metadata> {
  const URL = process.env.NEXT_PUBLIC_URL || "https://YOUR_DOMAIN";
  const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || "Jesse Hill Climb";

  const imageUrl =
    process.env.NEXT_PUBLIC_APP_HERO_IMAGE || `${URL}/embed.png`;
  const splashImageUrl =
    process.env.NEXT_PUBLIC_SPLASH_IMAGE || `${URL}/splash.png`;
  const splashBackgroundColor =
    process.env.NEXT_PUBLIC_SPLASH_BG || "#8fd3ff";

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

  return {
    title: APP_NAME,
    description: "Classic hill-climb mini game optimized for Base + Farcaster Mini Apps.",
    other: {
      // Preferred
      "fc:miniapp": JSON.stringify(embed),
      // Legacy compatibility
      "fc:frame": JSON.stringify(embed),
      // Base Build verification (from Base Build UI)
      "base:app_id": "696f2cefc0ab25addaaaf751",
    },
    openGraph: {
      title: APP_NAME,
      description: "Drive the hills, collect coins, share your best run.",
      images: [{ url: imageUrl }],
    },
  };
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
