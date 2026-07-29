"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

interface Grant {
  id: string;
  kind: "user" | "group";
  label: string;
}
interface Doc {
  id: string;
  title: string;
  fileName: string;
  fileType: string;
  status: string;
  uploadedAt: string;
  indexedAt: string | null;
  chunkCount: number;
  isPublic: boolean;
  isOwner: boolean;
  ownerLabel: string | null;
  canDelete: boolean;
  grants?: Grant[];
}
interface History {
  document: {
    id: string;
    title: string;
    fileName: string;
    status: string;
    aclVersion: number;
    contentVersion: number;
    chunkCount: number;
  };
  jobs: {
    id: string;
    status: string;
    error: string | null;
    createdAt: string;
    startedAt: string | null;
    completedAt: string | null;
  }[];
  projections: {
    id: string;
    reason: string;
    status: string;
    attempts: number;
    lastError: string | null;
    createdAt: string;
    processedAt: string | null;
  }[];
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Short visibility label for a document, from the owner's perspective vs. a viewer's.
function visibility(d: Doc): { text: string; tone: "public" | "shared" | "private" } {
  if (d.isPublic) return { text: "Public", tone: "public" };
  if (d.isOwner) {
    return (d.grants?.length ?? 0) > 0
      ? { text: `Shared with ${d.grants!.length}`, tone: "shared" }
      : { text: "Private", tone: "private" };
  }
  // A viewer who isn't the owner: they can see it, so it was shared with them.
  return { text: d.ownerLabel ? `Shared by ${d.ownerLabel}` : "Shared", tone: "shared" };
}

export default function DocumentsPage() {
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [history, setHistory] = useState<History | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/documents");
      if (!res.ok) throw new Error(`Failed to load (${res.status})`);
      const json = await res.json();
      setDocs(json.documents as Doc[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
      setDocs([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Merge a fresh sharing state (from a mutation response) into the matching doc.
  const applySharing = (id: string, s: { isPublic: boolean; grants: Grant[] }) =>
    setDocs((prev) =>
      prev ? prev.map((d) => (d.id === id ? { ...d, isPublic: s.isPublic, grants: s.grants } : d)) : prev,
    );

  const remove = async (doc: Doc) => {
    if (!confirm(`Delete "${doc.fileName}" and its ${doc.chunkCount} chunk(s)?`)) return;
    setDeleting(doc.id);
    setError(null);
    try {
      const res = await fetch(`/api/documents/${doc.id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `Delete failed (${res.status})`);
      }
      setDocs((prev) => (prev ? prev.filter((d) => d.id !== doc.id) : prev));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeleting(null);
    }
  };

  const openHistory = async (doc: Doc) => {
    setError(null);
    try {
      const res = await fetch(`/api/documents/${doc.id}/history`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? `History failed (${res.status})`);
      setHistory(json as History);
    } catch (e) {
      setError(e instanceof Error ? e.message : "History failed");
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Documents</h1>
        <Link
          href="/upload"
          className="rounded-lg bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
        >
          Upload
        </Link>
      </div>
      <p className="mt-1 text-sm text-neutral-500">
        Documents you can see — yours, shared with you, and public.{" "}
        {docs ? `${docs.length} document${docs.length === 1 ? "" : "s"}.` : ""}
      </p>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      {docs === null && <p className="mt-8 text-sm text-neutral-400">Loading…</p>}

      {docs && docs.length === 0 && (
        <div className="mt-10 rounded-lg border border-dashed border-neutral-300 px-6 py-12 text-center">
          <p className="text-sm text-neutral-500">No documents yet.</p>
          <Link href="/upload" className="mt-2 inline-block text-sm font-medium underline">
            Upload your first file
          </Link>
        </div>
      )}

      {docs && docs.length > 0 && (
        <ul className="mt-6 divide-y divide-neutral-100 rounded-lg border border-neutral-200">
          {docs.map((d) => {
            const vis = visibility(d);
            return (
              <li key={d.id} className="px-4 py-3">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{d.title}</p>
                    <p className="mt-0.5 truncate text-xs text-neutral-400">
                      <a
                        href={`/api/documents/${d.id}/file`}
                        target="_blank"
                        rel="noreferrer"
                        className="underline decoration-neutral-300 underline-offset-2 hover:text-neutral-600"
                      >
                        {d.fileName}
                      </a>{" "}
                      · {formatDate(d.uploadedAt)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span
                      className={
                        "rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide " +
                        (vis.tone === "public"
                          ? "bg-emerald-50 text-emerald-700"
                          : vis.tone === "shared"
                            ? "bg-amber-50 text-amber-700"
                            : "bg-neutral-100 text-neutral-500")
                      }
                    >
                      {vis.text}
                    </span>
                    <span className="text-xs tabular-nums text-neutral-400">
                      {d.chunkCount} chunk{d.chunkCount === 1 ? "" : "s"}
                    </span>
                    {d.isOwner && (
                      <button
                        onClick={() => setExpanded((cur) => (cur === d.id ? null : d.id))}
                        className="rounded px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800"
                      >
                        {expanded === d.id ? "Close" : "Share"}
                      </button>
                    )}
                    <button
                      onClick={() => openHistory(d)}
                      className="rounded px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800"
                    >
                      History
                    </button>
                    {d.canDelete && (
                      <button
                        onClick={() => remove(d)}
                        disabled={deleting === d.id}
                        className="rounded px-2 py-1 text-xs text-neutral-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                      >
                        {deleting === d.id ? "Deleting…" : "Delete"}
                      </button>
                    )}
                  </div>
                </div>

                {d.isOwner && expanded === d.id && (
                  <SharePanel doc={d} onChange={(s) => applySharing(d.id, s)} />
                )}
              </li>
            );
          })}
        </ul>
      )}

      {history && (
        <div className="fixed inset-0 z-50 bg-black/20 px-4 py-8" onClick={() => setHistory(null)}>
          <div
            role="dialog"
            aria-modal="true"
            className="mx-auto max-h-full max-w-2xl overflow-auto rounded-lg bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 className="truncate text-lg font-semibold">{history.document.title}</h2>
                <p className="mt-0.5 text-xs text-neutral-400">
                  content v{history.document.contentVersion} · ACL v{history.document.aclVersion} · {history.document.chunkCount} chunks
                </p>
              </div>
              <button
                onClick={() => setHistory(null)}
                className="rounded px-2 py-1 text-sm text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"
              >
                Close
              </button>
            </div>

            <h3 className="mt-5 text-sm font-semibold">Ingestion attempts</h3>
            <ul className="mt-2 divide-y divide-neutral-100 rounded border border-neutral-200">
              {history.jobs.map((j) => (
                <li key={j.id} className="px-3 py-2 text-xs">
                  <div className="flex justify-between gap-3">
                    <span className="font-medium">{j.status}</span>
                    <span className="text-neutral-400">{formatDate(j.createdAt)}</span>
                  </div>
                  {j.error && <p className="mt-1 text-red-600">{j.error}</p>}
                </li>
              ))}
              {history.jobs.length === 0 && <li className="px-3 py-2 text-xs text-neutral-400">No jobs.</li>}
            </ul>

            <h3 className="mt-5 text-sm font-semibold">Projection events</h3>
            <ul className="mt-2 divide-y divide-neutral-100 rounded border border-neutral-200">
              {history.projections.map((p) => (
                <li key={p.id} className="px-3 py-2 text-xs">
                  <div className="flex justify-between gap-3">
                    <span className="font-medium">{p.reason}</span>
                    <span className="text-neutral-400">{p.status} · {p.attempts} attempt{p.attempts === 1 ? "" : "s"}</span>
                  </div>
                  {p.lastError && <p className="mt-1 text-red-600">{p.lastError}</p>}
                </li>
              ))}
              {history.projections.length === 0 && (
                <li className="px-3 py-2 text-xs text-neutral-400">No projection events.</li>
              )}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

function SharePanel({
  doc,
  onChange,
}: {
  doc: Doc;
  onChange: (s: { isPublic: boolean; grants: Grant[] }) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [kind, setKind] = useState<"user" | "group">("user");
  const [value, setValue] = useState("");

  // Call the sharing endpoint and fold the returned state back into the parent list.
  const call = async (init: RequestInit & { url?: string }) => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(init.url ?? `/api/documents/${doc.id}/sharing`, init);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? `Failed (${res.status})`);
      onChange({ isPublic: json.isPublic, grants: json.grants });
      return true;
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const togglePublic = () =>
    call({
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isPublic: !doc.isPublic }),
    });

  const addGrant = async () => {
    const v = value.trim();
    if (!v) return;
    const body = kind === "user" ? { email: v } : { groupName: v };
    if (
      await call({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
    ) {
      setValue("");
    }
  };

  const revoke = (grantId: string) =>
    call({ method: "DELETE", url: `/api/documents/${doc.id}/sharing?grantId=${encodeURIComponent(grantId)}` });

  return (
    <div className="mt-3 rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-sm">
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={doc.isPublic} disabled={busy} onChange={togglePublic} />
        <span className="font-medium">Public</span>
        <span className="text-xs text-neutral-500">— anyone in the workspace can find and cite this</span>
      </label>

      <div className="mt-3">
        <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Shared with</p>
        {(doc.grants?.length ?? 0) === 0 ? (
          <p className="mt-1 text-xs text-neutral-400">
            No one yet{doc.isPublic ? " (public overrides this)" : ""}.
          </p>
        ) : (
          <ul className="mt-1 flex flex-wrap gap-1.5">
            {doc.grants!.map((g) => (
              <li
                key={g.id}
                className="flex items-center gap-1 rounded-full border border-neutral-200 bg-white px-2 py-0.5 text-xs"
              >
                <span className="text-[10px] uppercase text-neutral-400">{g.kind}</span>
                <span>{g.label}</span>
                <button
                  onClick={() => revoke(g.id)}
                  disabled={busy}
                  aria-label={`Revoke ${g.label}`}
                  className="ml-0.5 text-neutral-400 hover:text-red-600 disabled:opacity-50"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as "user" | "group")}
          className="rounded border border-neutral-300 bg-white px-1.5 py-1 text-xs"
        >
          <option value="user">User email</option>
          <option value="group">Group name</option>
        </select>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addGrant()}
          placeholder={kind === "user" ? "person@example.com" : "engineering"}
          className="min-w-0 flex-1 rounded border border-neutral-300 px-2 py-1 text-xs"
        />
        <button
          onClick={addGrant}
          disabled={busy || !value.trim()}
          className="rounded bg-neutral-900 px-2.5 py-1 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          Share
        </button>
      </div>

      {err && <p className="mt-2 text-xs text-red-600">{err}</p>}
    </div>
  );
}
