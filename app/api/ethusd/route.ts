import { NextResponse } from "next/server";

export async function GET() {
  try {
    const r = await fetch("https://api.coinbase.com/v2/prices/ETH-USD/spot", {
      headers: { accept: "application/json" },
      next: { revalidate: 60 },
    });

    if (!r.ok) {
      return NextResponse.json({ error: "price_fetch_failed" }, { status: 502 });
    }

    const j: any = await r.json();
    const usd = Number(j?.data?.amount);
    if (!Number.isFinite(usd) || usd <= 0) {
      return NextResponse.json({ error: "bad_price" }, { status: 502 });
    }

    const res = NextResponse.json({ usd });
    res.headers.set("Cache-Control", "public, s-maxage=60, stale-while-revalidate=60");
    return res;
  } catch {
    return NextResponse.json({ error: "price_fetch_error" }, { status: 502 });
  }
}
