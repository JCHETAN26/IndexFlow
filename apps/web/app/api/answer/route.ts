import { NextRequest } from "next/server";
import { answerQuestion } from "@/lib/rag";
import { REFUSAL_SENTENCE } from "@/lib/llm";

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
        const { contexts, answer } = await answerQuestion(query);
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
        send({ type: "error", error: e instanceof Error ? e.message : "Answer generation failed" });
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
