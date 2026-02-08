import { NextResponse } from "next/server";

// IMPORTANT:
// Keep the CDP paymaster/bundler URL (which contains your client key) server-side only.
// The frontend should only ever reference this proxy endpoint.
//
// This route forwards JSON-RPC requests to CDP, with a small allowlist to reduce abuse.

export const runtime = "nodejs";

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "cache-control": "no-store",
} as const;

// Allow paymaster methods + a conservative set of bundler methods.
const ALLOWED_BUNDLER_METHODS = new Set([
  "eth_supportedEntryPoints",
  "eth_sendUserOperation",
  "eth_estimateUserOperationGas",
  "eth_getUserOperationReceipt",
  "eth_getUserOperationByHash",
  "eth_chainId",
  "eth_gasPrice",
  "eth_maxPriorityFeePerGas",
  "eth_getUserOperationGasPrice",
]);

function isAllowedMethod(method: string) {
  if (method.startsWith("pm_")) return true;
  if (ALLOWED_BUNDLER_METHODS.has(method)) return true;
  return false;
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function POST(req: Request) {
  const upstream = (process.env.CDP_PAYMASTER_URL ?? "").trim();
  if (!upstream) {
    return NextResponse.json({ error: "Missing CDP_PAYMASTER_URL" }, { status: 500 });
  }

  // Forward the request body as-is (JSON-RPC).
  const bodyText = await req.text();

  // Validate methods to reduce abuse if this endpoint is discovered.
  try {
    const payload: any = JSON.parse(bodyText);
    const requests = Array.isArray(payload) ? payload : [payload];
    for (const r of requests) {
      const method = String(r?.method ?? "");
      if (!isAllowedMethod(method)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: corsHeaders });
      }
    }
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400, headers: corsHeaders });
  }

  const upstreamRes = await fetch(upstream, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: bodyText,
  });

  const text = await upstreamRes.text();
  return new NextResponse(text, {
    status: upstreamRes.status,
    headers: { "content-type": "application/json", ...corsHeaders },
  });
}
