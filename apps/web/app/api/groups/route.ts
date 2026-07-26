import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { DEMO_MODE, demoReadOnlyResponse } from "@/lib/demo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireUser(): Promise<string | NextResponse> {
  const userId = (await auth())?.user?.id ?? null;
  return userId ?? NextResponse.json({ error: "Sign in to manage groups." }, { status: 401 });
}

export async function GET() {
  const user = await requireUser();
  if (typeof user !== "string") return user;

  const groups = await prisma.group.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      createdAt: true,
      members: {
        orderBy: { user: { email: "asc" } },
        select: {
          user: { select: { id: true, email: true, name: true } },
        },
      },
      _count: { select: { grants: true } },
    },
  });

  return NextResponse.json({
    groups: groups.map((g) => ({
      id: g.id,
      name: g.name,
      createdAt: g.createdAt,
      grantCount: g._count.grants,
      members: g.members.map((m) => ({
        id: m.user.id,
        email: m.user.email,
        name: m.user.name,
        label: m.user.email ?? m.user.name ?? m.user.id,
      })),
    })),
  });
}

export async function POST(req: NextRequest) {
  if (DEMO_MODE) return NextResponse.json(demoReadOnlyResponse, { status: 403 });

  const user = await requireUser();
  if (typeof user !== "string") return user;

  const body = (await req.json().catch(() => ({}))) as { name?: unknown };
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (name.length < 2) {
    return NextResponse.json({ error: "Group name must be at least 2 characters." }, { status: 400 });
  }

  try {
    const group = await prisma.group.create({
      data: { name },
      select: { id: true, name: true, createdAt: true },
    });
    return NextResponse.json({ group: { ...group, grantCount: 0, members: [] } }, { status: 201 });
  } catch (e: any) {
    if (e?.code === "P2002") {
      return NextResponse.json({ error: "A group with that name already exists." }, { status: 409 });
    }
    throw e;
  }
}
