"use client";

import { useCallback, useEffect, useState } from "react";

interface Member {
  id: string;
  email: string | null;
  name: string | null;
  label: string;
}

interface Group {
  id: string;
  name: string;
  createdAt: string;
  grantCount: number;
  members: Member[];
}

export default function GroupsPage() {
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/groups");
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? `Failed to load (${res.status})`);
      setGroups(json.groups as Group[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load groups");
      setGroups([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const create = async () => {
    const v = name.trim();
    if (!v) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: v }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? `Create failed (${res.status})`);
      setGroups((prev) => [...(prev ?? []), json.group].sort((a, b) => a.name.localeCompare(b.name)));
      setName("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed");
    } finally {
      setBusy(false);
    }
  };

  const applyMembers = (groupId: string, members: Member[]) =>
    setGroups((prev) => prev?.map((g) => (g.id === groupId ? { ...g, members } : g)) ?? prev);

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Groups</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Manage reusable principals for document sharing.
      </p>

      <div className="mt-6 flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && create()}
          placeholder="engineering"
          className="min-w-0 flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10"
        />
        <button
          onClick={create}
          disabled={busy || !name.trim()}
          className="rounded-lg bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40"
        >
          Create
        </button>
      </div>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
      {groups === null && <p className="mt-8 text-sm text-neutral-400">Loading…</p>}

      {groups && groups.length === 0 && (
        <p className="mt-10 text-center text-sm text-neutral-400">No groups yet.</p>
      )}

      {groups && groups.length > 0 && (
        <ul className="mt-6 divide-y divide-neutral-100 rounded-lg border border-neutral-200">
          {groups.map((g) => (
            <li key={g.id} className="px-4 py-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="truncate font-medium">{g.name}</p>
                  <p className="mt-0.5 text-xs text-neutral-400">
                    {g.members.length} member{g.members.length === 1 ? "" : "s"} · {g.grantCount} document grant
                    {g.grantCount === 1 ? "" : "s"}
                  </p>
                </div>
              </div>
              <MemberEditor group={g} onChange={(members) => applyMembers(g.id, members)} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MemberEditor({
  group,
  onChange,
}: {
  group: Group;
  onChange: (members: Member[]) => void;
}) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    const v = email.trim();
    if (!v) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/groups/${group.id}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: v }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? `Add failed (${res.status})`);
      onChange(json.members as Member[]);
      setEmail("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Add failed");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (member: Member) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/groups/${group.id}/members?userId=${encodeURIComponent(member.id)}`, {
        method: "DELETE",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? `Remove failed (${res.status})`);
      onChange(json.members as Member[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Remove failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3">
      {group.members.length === 0 ? (
        <p className="text-xs text-neutral-400">No members yet.</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {group.members.map((m) => (
            <li
              key={m.id}
              className="flex items-center gap-1 rounded-full border border-neutral-200 bg-neutral-50 px-2 py-0.5 text-xs"
            >
              <span>{m.label}</span>
              <button
                onClick={() => remove(m)}
                disabled={busy}
                aria-label={`Remove ${m.label}`}
                className="text-neutral-400 hover:text-red-600 disabled:opacity-50"
              >
                x
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex gap-2">
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="person@example.com"
          className="min-w-0 flex-1 rounded border border-neutral-300 px-2 py-1 text-xs"
        />
        <button
          onClick={add}
          disabled={busy || !email.trim()}
          className="rounded bg-neutral-900 px-2.5 py-1 text-xs font-medium text-white hover:opacity-90 disabled:opacity-40"
        >
          Add
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}
