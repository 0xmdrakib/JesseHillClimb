import { NextResponse } from "next/server";

// Server-side helper for Tip modal: fetch live ETH/USD.
// Primary: Coinbase public spot price endpoint.
// Fallback: CoinGecko simple price.

export async function GET() {
  // Coinbase (no auth required)
  try {
    const r = await fetch("https://api.coinbase.com/v2/prices/ETH-USD/spot", {
      // keep it fresh but avoid spamming
      next: { revalidate: 30 },
      headers: { "Accept": "application/json" },
    });

    if (r.ok) {
      const j: any = await r.json();
      const usd = Number(j?.data?.amount);
      if (Number.isFinite(usd) && usd > 0) {
        return NextResponse.json({ usd, source: "coinbase" });
      }
    }
  } catch {
    // ignore
  }

  // CoinGecko fallback
  try {
    const r = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd",
      { next: { revalidate: 30 }, headers: { "Accept": "application/json" } },
    );

    if (r.ok) {
      const j: any = await r.json();
      const usd = Number(j?.ethereum?.usd);
      if (Number.isFinite(usd) && usd > 0) {
        return NextResponse.json({ usd, source: "coingecko" });
      }
    }
  } catch {
    // ignore
  }

  return NextResponse.json({ error: "price_unavailable" }, { status: 502 });
}
