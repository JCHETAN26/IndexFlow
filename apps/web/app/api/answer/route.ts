import { NextRequest } from "next/server";
import { answerQuestion, RAG_K } from "@/lib/rag";
import { retrieveContexts } from "@/lib/retrieve";
import { REFUSAL_SENTENCE } from "@/lib/llm";
import { auth } from "@/auth";
import { viewerFrom } from "@/lib/acl";
import { DEMO_MODE } from "@/lib/demo";
import { LIMITS, callerKey, checkRateLimit, tooManyRequests } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Streaming grounded-answer endpoint. Responds with newline-delimited JSON frames:
 *   {"type":"contexts","contexts":[{marker,chunkId,documentId,title,fileType}]}  (first)
 *   {"type":"delta","text":"..."}                                                (0..n)
 *   {"type":"done","refused":bool,"usage":{output_tokens}|null}                  (last)
 *   {"type":"error","error":"..."}                                              (on failure)
 * Citations metadata comes first so the UI can wire [n] chips before text arrives.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { q?: unknown };
  const query = typeof body.q === "string" ? body.q.trim() : "";
  if (!query) {
    return Response.json({ error: "Missing query 'q'." }, { status: 400 });
  }

  // Permission-aware: the answer is grounded only in documents this viewer can see, so a
  // restricted document can never be retrieved, cited, or paraphrased into the answer.
  const session = await auth();

  // Retrieval plus (locally) generation — the most expensive per-request path a visitor can
  // reach. Checked before any work starts.
  const rl = checkRateLimit(`answer:${callerKey(req, session?.user?.id ?? null)}`, LIMITS.answer);
  if (!rl.ok) return tooManyRequests(rl, "Too many questions. Please slow down.");

  const viewer = await viewerFrom(session?.user?.id ?? null);

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      // Enqueue that tolerates a client that has already disconnected.
      let closed = false;
      const send = (obj: unknown) => {
        if (closed) return false;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
          return true;
        } catch {
          closed = true; // controller cancelled (client went away)
          return false;
        }
      };

      try {
        // Public demo: there is no Ollama on the host, so retrieval still runs for real (the
        // citations below are genuine, permission-filtered hits) but generation is replaced by
        // an explanation rather than a broken stream or a fabricated answer.
        if (DEMO_MODE) {
          const contexts = await retrieveContexts(query, RAG_K, viewer);
          send({
            type: "contexts",
            contexts: contexts.map((c) => ({
              marker: c.marker,
              chunkId: c.chunkId,
              documentId: c.documentId,
              title: c.title,
              fileType: c.fileType,
            })),
          });
          send({
            type: "delta",
            text:
              contexts.length > 0
                ? `Answer generation is disabled in this public demo — it runs on a local Ollama model that isn't available on the host. Retrieval is live: the ${contexts.length} passage(s) cited below are real, permission-filtered results for your query. Run the project locally to see grounded answers with citations.`
                : "Answer generation is disabled in this public demo, and retrieval found no matching passages for this query.",
          });
          send({ type: "done", refused: false, usage: null });
          controller.close();
          return;
        }

        const { contexts, answer } = await answerQuestion(query, viewer);
        send({
          type: "contexts",
          contexts: contexts.map((c) => ({
            marker: c.marker,
            chunkId: c.chunkId,
            documentId: c.documentId,
            title: c.title,
            fileType: c.fileType,
          })),
        });

        // Nothing retrieved → refuse without spending a generation.
        if (!answer) {
          send({ type: "delta", text: REFUSAL_SENTENCE });
          send({ type: "done", refused: true, usage: null });
          controller.close();
          return;
        }

        for await (const ev of answer) {
          const ok =
            ev.type === "delta"
              ? send({ type: "delta", text: ev.text })
              : send({
                  type: "done",
                  refused: ev.refused,
                  usage: ev.outputTokens != null ? { output_tokens: ev.outputTokens } : null,
                });
          if (!ok) break; // client disconnected — stop consuming the model stream
        }
        if (!closed) controller.close();
      } catch (e) {
        // Log the real cause server-side; never leak internals (DB host, stack) to the client.
        console.error("answer route failed", e);
        send({
          type: "error",
          error: "Couldn't generate an answer — the search backend may be unavailable.",
        });
        if (!closed) controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
