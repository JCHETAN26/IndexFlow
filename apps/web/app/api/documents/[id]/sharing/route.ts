import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { assertOwner, getSharing, setPublic, addGrant, removeGrant, SharingError } from "@/lib/sharing";
import { DEMO_MODE, demoReadOnlyResponse } from "@/lib/demo";

export const runtime = "nodejs";

/**
 * Owner-only document sharing:
 *   GET    → current sharing state { isPublic, ownerId, grants[] }
 *   PATCH  → { isPublic } toggle public visibility
 *   POST   → { email } | { groupName } add a grant
 *   DELETE → ?grantId=… revoke a grant
 * Every mutation re-syncs the document's ACL into Elasticsearch (see lib/sharing).
 */

const currentUserId = async () => (await auth())?.user?.id ?? null;

function fail(e: unknown): NextResponse {
  if (e instanceof SharingError) return NextResponse.json({ error: e.message }, { status: e.status });
  throw e; // unexpected → 500 via the framework
}

/** Read-only public demo: refuse every sharing mutation. GET (reading state) stays allowed. */
function demoBlocked(): NextResponse | null {
  return DEMO_MODE ? NextResponse.json(demoReadOnlyResponse, { status: 403 }) : null;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await assertOwner(id, await currentUserId());
    return NextResponse.json(await getSharing(id));
  } catch (e) {
    return fail(e);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const blocked = demoBlocked();
  if (blocked) return blocked;
  const body = (await req.json().catch(() => ({}))) as { isPublic?: unknown };
  try {
    await assertOwner(id, await currentUserId());
    return NextResponse.json(await setPublic(id, Boolean(body.isPublic)));
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const blocked = demoBlocked();
  if (blocked) return blocked;
  const body = (await req.json().catch(() => ({}))) as { email?: string; groupName?: string };
  try {
    await assertOwner(id, await currentUserId());
    return NextResponse.json(await addGrant(id, body), { status: 201 });
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const blocked = demoBlocked();
  if (blocked) return blocked;
  const grantId = req.nextUrl.searchParams.get("grantId");
  try {
    await assertOwner(id, await currentUserId());
    if (!grantId) throw new SharingError(400, "Missing grantId.");
    return NextResponse.json(await removeGrant(id, grantId));
  } catch (e) {
    return fail(e);
  }
}
