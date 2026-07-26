import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { usageSnapshot } from "@/lib/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const userId = (await auth())?.user?.id ?? null;
  if (!userId) {
    return NextResponse.json({ error: "Sign in to view usage telemetry." }, { status: 401 });
  }
  return NextResponse.json(usageSnapshot());
}
