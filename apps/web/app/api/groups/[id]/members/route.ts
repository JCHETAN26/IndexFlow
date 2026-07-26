import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { DEMO_MODE, demoReadOnlyResponse } from "@/lib/demo";

export const runtime = "nodejs";

async function requireUser(): Promise<string | NextResponse> {
  const userId = (await auth())?.user?.id ?? null;
  return userId ?? NextResponse.json({ error: "Sign in to manage groups." }, { status: 401 });
}

async function groupMembers(groupId: string) {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: {
      id: true,
      members: {
        orderBy: { user: { email: "asc" } },
        select: {
          user: { select: { id: true, email: true, name: true } },
        },
      },
    },
  });
  if (!group) return null;
  return group.members.map((m) => ({
    id: m.user.id,
    email: m.user.email,
    name: m.user.name,
    label: m.user.email ?? m.user.name ?? m.user.id,
  }));
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (DEMO_MODE) return NextResponse.json(demoReadOnlyResponse, { status: 403 });

  const user = await requireUser();
  if (typeof user !== "string") return user;

  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { email?: unknown };
  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (!email) return NextResponse.json({ error: "Provide a user email." }, { status: 400 });

  const target = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!target) {
    return NextResponse.json({ error: `No user with email "${email}" has signed in yet.` }, { status: 404 });
  }

  try {
    await prisma.groupMember.create({ data: { groupId: id, userId: target.id } });
  } catch (e: any) {
    if (e?.code === "P2002") {
      return NextResponse.json({ members: await groupMembers(id) });
    }
    if (e?.code === "P2003") {
      return NextResponse.json({ error: "Group not found." }, { status: 404 });
    }
    throw e;
  }

  return NextResponse.json({ members: await groupMembers(id) }, { status: 201 });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (DEMO_MODE) return NextResponse.json(demoReadOnlyResponse, { status: 403 });

  const user = await requireUser();
  if (typeof user !== "string") return user;

  const { id } = await params;
  const userId = req.nextUrl.searchParams.get("userId");
  if (!userId) return NextResponse.json({ error: "Missing userId." }, { status: 400 });

  await prisma.groupMember.deleteMany({ where: { groupId: id, userId } });
  const members = await groupMembers(id);
  if (!members) return NextResponse.json({ error: "Group not found." }, { status: 404 });
  return NextResponse.json({ members });
}
