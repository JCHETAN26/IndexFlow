/**
 * IndexFlow retrieval evaluation.
 *
 * Seeds a labeled corpus inside a transaction that is ROLLED BACK at the end, so it
 * never touches real data. Eval searches are scoped to the corpus document ids, and
 * index scans are disabled so semantic ranking is exact (brute-force KNN) rather than
 * approximate HNSW — eval numbers should be deterministic.
 *
 * Run: pnpm --filter @indexflow/web eval
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { prisma } from "../lib/prisma";
import { chunkText } from "../lib/chunk";
import { embed, toVectorLiteral } from "../lib/embed";

const HERE = dirname(fileURLToPath(import.meta.url));

interface CorpusDoc {
  fileName: string;
  title: string;
  content: string;
}
interface Query {
  q: string;
  relevant: string[];
  kind: "exact" | "paraphrase";
}
type Strategy = "keyword" | "semantic";

const corpus: CorpusDoc[] = JSON.parse(
  readFileSync(join(HERE, "corpus.json"), "utf8"),
);
const queries: Query[] = JSON.parse(
  readFileSync(join(HERE, "queries.json"), "utf8"),
);

const K_VALUES = [1, 3, 5] as const;

// Thrown to force the seeding transaction to roll back after measurement.
class Rollback extends Error {}

interface QueryResult {
  kind: Query["kind"];
  ranks: Record<Strategy, number | null>; // 1-based rank of first relevant doc, or null
}

async function main() {
  // 1. Chunk every corpus doc.
  const chunks: { fileName: string; index: number; content: string; tokenCount: number }[] = [];
  for (const doc of corpus) {
    for (const c of chunkText(doc.content)) {
      chunks.push({ fileName: doc.fileName, index: c.index, content: c.content, tokenCount: c.tokenCount });
    }
  }

  // 2. Embed chunks and queries up front (outside the DB).
  console.log(`Embedding ${chunks.length} chunks + ${queries.length} queries…`);
  const chunkVecs = await embed(chunks.map((c) => c.content));
  const queryVecs = await embed(queries.map((q) => q.q));

  const results: QueryResult[] = [];

  try {
    await prisma.$transaction(
      async (tx) => {
        // Exact scans: deterministic, ignores approximate HNSW for eval.
        await tx.$executeRawUnsafe("SET LOCAL enable_indexscan = off");
        await tx.$executeRawUnsafe("SET LOCAL enable_bitmapscan = off");

        // Seed corpus; capture document ids by fileName.
        const idByFile = new Map<string, string>();
        for (const doc of corpus) {
          const [{ id }] = await tx.$queryRaw<{ id: string }[]>`
            INSERT INTO documents (id, title, "fileName", "fileType", status, "uploadedAt", "indexedAt")
            VALUES (gen_random_uuid(), ${doc.title}, ${doc.fileName}, 'md', 'INDEXED', now(), now())
            RETURNING id::text AS id
          `;
          idByFile.set(doc.fileName, id);
        }
        for (let i = 0; i < chunks.length; i++) {
          const c = chunks[i];
          await tx.$executeRaw`
            INSERT INTO document_chunks (id, "documentId", "chunkIndex", content, "tokenCount", embedding, "createdAt")
            VALUES (gen_random_uuid(), ${idByFile.get(c.fileName)}::uuid, ${c.index}, ${c.content}, ${c.tokenCount}, ${toVectorLiteral(chunkVecs[i])}::vector, now())
          `;
        }

        const corpusIds = [...idByFile.values()];
        const fileById = new Map([...idByFile].map(([f, id]) => [id, f]));

        // Rank unique documents for a query under each strategy.
        const rankDocs = (rows: { docId: string }[]): string[] => {
          const seen = new Set<string>();
          const order: string[] = [];
          for (const r of rows) {
            if (seen.has(r.docId)) continue;
            seen.add(r.docId);
            order.push(fileById.get(r.docId)!);
          }
          return order;
        };

        for (let i = 0; i < queries.length; i++) {
          const query = queries[i];

          const keywordRows = await tx.$queryRaw<{ docId: string }[]>`
            SELECT dc."documentId"::text AS "docId"
            FROM document_chunks dc
            WHERE dc."documentId"::text = ANY(${corpusIds})
              AND to_tsvector('english', dc.content) @@ plainto_tsquery('english', ${query.q})
            ORDER BY ts_rank(to_tsvector('english', dc.content), plainto_tsquery('english', ${query.q})) DESC
          `;

          const vec = toVectorLiteral(queryVecs[i]);
          const semanticRows = await tx.$queryRaw<{ docId: string }[]>`
            SELECT dc."documentId"::text AS "docId"
            FROM document_chunks dc
            WHERE dc."documentId"::text = ANY(${corpusIds})
              AND dc.embedding IS NOT NULL
            ORDER BY dc.embedding <=> ${vec}::vector
            LIMIT 10
          `;

          const rankOf = (ranked: string[]): number | null => {
            const idx = ranked.findIndex((f) => query.relevant.includes(f));
            return idx === -1 ? null : idx + 1;
          };

          results.push({
            kind: query.kind,
            ranks: {
              keyword: rankOf(rankDocs(keywordRows)),
              semantic: rankOf(rankDocs(semanticRows)),
            },
          });
        }

        throw new Rollback();
      },
      { timeout: 60_000, maxWait: 15_000 },
    );
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }

  report(results);
}

function recallAt(rows: QueryResult[], strat: Strategy, k: number): number {
  if (rows.length === 0) return 0;
  const hits = rows.filter((r) => r.ranks[strat] !== null && r.ranks[strat]! <= k).length;
  return hits / rows.length;
}
function mrr(rows: QueryResult[], strat: Strategy): number {
  if (rows.length === 0) return 0;
  const sum = rows.reduce((s, r) => s + (r.ranks[strat] ? 1 / r.ranks[strat]! : 0), 0);
  return sum / rows.length;
}
const pct = (n: number) => (n * 100).toFixed(0).padStart(3) + "%";
const f2 = (n: number) => n.toFixed(2);

function report(results: QueryResult[]) {
  const strategies: Strategy[] = ["keyword", "semantic"];
  const exact = results.filter((r) => r.kind === "exact");
  const para = results.filter((r) => r.kind === "paraphrase");

  console.log(`\nRetrieval eval — ${results.length} queries over ${corpus.length} docs`);
  console.log("─".repeat(52));
  console.log("strategy    R@1   R@3   R@5    MRR");
  console.log("─".repeat(52));
  for (const s of strategies) {
    const r = K_VALUES.map((k) => pct(recallAt(results, s, k))).join("  ");
    console.log(`${s.padEnd(10)} ${r}   ${f2(mrr(results, s))}`);
  }
  console.log("─".repeat(52));
  console.log("by query kind (R@1 / MRR):");
  console.log("                 keyword        semantic");
  for (const [label, rows] of [["exact", exact], ["paraphrase", para]] as const) {
    const k = `${pct(recallAt(rows, "keyword", 1))} / ${f2(mrr(rows, "keyword"))}`;
    const v = `${pct(recallAt(rows, "semantic", 1))} / ${f2(mrr(rows, "semantic"))}`;
    console.log(`${label.padEnd(12)} ${k.padStart(12)}   ${v.padStart(12)}`);
  }
  console.log("─".repeat(52));

  // Quality gate. Floors sit comfortably below current numbers so the gate catches a
  // real regression, not normal variance. Keyword is intentionally low: plainto_tsquery
  // ANDs terms, so it is brittle by design — hybrid (Step 4) is what lifts it.
  const gate = {
    "keyword R@1 on exact": [recallAt(exact, "keyword", 1), 0.5],
    "semantic R@1 on paraphrase": [recallAt(para, "semantic", 1), 0.7],
    "semantic R@5 overall": [recallAt(results, "semantic", 5), 0.8],
    "best-of R@5 overall": [
      results.filter((r) => [r.ranks.keyword, r.ranks.semantic].some((x) => x !== null && x <= 5)).length /
        results.length,
      0.9,
    ],
  } as const;

  let failed = false;
  console.log("quality gate:");
  for (const [name, [value, floor]] of Object.entries(gate)) {
    const ok = value >= floor;
    if (!ok) failed = true;
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}: ${pct(value)} (floor ${pct(floor)})`);
  }
  console.log("─".repeat(52));

  if (failed) {
    console.error("\nQuality gate FAILED — retrieval regressed below floor.");
    process.exitCode = 1;
  } else {
    console.log("\nQuality gate passed. ✓");
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
