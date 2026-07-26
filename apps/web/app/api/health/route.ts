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
    return NextResponse.json(
      {
        ok: false,
        service: "indexflow-web",
        db: "error",
        error: e instanceof Error ? e.message : "health check failed",
        latencyMs: Math.round(performance.now() - started),
      },
      { status: 503 },
    );
  }
}
