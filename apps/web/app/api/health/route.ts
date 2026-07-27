import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const started = performance.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({
      ok: true,
      service: "indexflow-web",
      db: "ok",
      latencyMs: Math.round(performance.now() - started),
    });
  } catch (e) {
    // Health is unauthenticated, so the response must not describe the failure. Driver errors
    // routinely embed the database host, port and user — occasionally the whole connection
    // string. Log the detail; tell the caller only that the check failed.
    console.error("health check failed", e);
    return NextResponse.json(
      {
        ok: false,
        service: "indexflow-web",
        db: "error",
        latencyMs: Math.round(performance.now() - started),
      },
      { status: 503 },
    );
  }
}
