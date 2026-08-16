# SaaSBench — design, and the gate that nearly rejected it

**Status: PASS at the 3,400-document rung.** The generator is frozen by hash and the
benchmark-quality gate clears without any threshold being relaxed. Scaling to 100K is justified;
limitations are in §7.

SaaSBench answers what BEIR structurally cannot — how IndexFlow behaves on **its own product
domain**, under **permission filtering**, at **scale**, with **every document labelled** rather than
667 labelled among 99,333 distractors. It does not replace BEIR. BEIR remains the external control,
because no self-generated corpus can validate a pipeline against the outside world.

---

## 1. The failure mode this is built against

A generator that realises documents and queries from one vocabulary produces a benchmark where BM25
matches tokens the generator planted, all strategies score ~0.95, and nothing is distinguishable.
The numbers look excellent and mean nothing.

IndexFlow has shipped that mistake once: `R@5 = 97%` which was really 100% of attainable, for three
strategies simultaneously, with a zero-width confidence interval. A second, self-generated instance
would be worse — the first was at least an accident.

So the corpus is built on **paired disjoint vocabularies**. Each of 18 fault concepts carries:

| side | used by | example |
|---|---|---|
| `docPhrases` / `docFixes` | documents only | "the periodic persistence timer began firing at a far shorter interval than configured" |
| `userPhrases` / `userGoals` | queries only | "typing stutters and pauses every couple of seconds" |

Both describe the same fault. They share no content word. That is not an intention — it is
`assertLexiconDisjoint()`, which tokenises both sides, strips stopwords, exempts identifiers, and
throws. **It caught 9 of 18 concepts leaking on first authoring** (`write`, `account`, `payment`,
`preview`, `rows`, `changes`, `edits`, `text`, `healthy`, `everyone`), and it runs as a unit test so
a later edit that drifts a word across the boundary breaks the build.

## 2. Structure before prose

Ground truth is generated first: a scenario states its own service, platform, error code, versions,
quantity, root cause and mitigation. Documents are realisations of it. **Relevance therefore follows
from provenance, not from someone reading text** — which is the weakness recorded against the
in-domain corpus, where every number rests on one person's unaudited judgment.

The limitation is the mirror image and belongs in the ledger: qrels derived this way are true **by
construction**. They cannot be wrong about which document discusses which incident, and they cannot
capture a human finding a document useful for a reason the generator never modelled.

## 3. Core and filler

- **Core** — 150 labelled scenarios, fixed at every scale, the only ones queried.
- **Near-miss siblings** — ~670, graded 0, each differing from its core along exactly one axis.
- **Filler** — unlabelled, grows to hit the requested corpus size.

Only the filler grows, so **queries and qrels freeze once and stay valid at 3,400 documents and at
100,000**. A scale curve then measures scale rather than comparing two different benchmarks. A unit
test pins this by generating at two sizes and asserting the query and qrel hashes match.

## 4. Result at the 3,400 rung

Test split, 895 judged queries, 7,651 chunks (2.25 per document), production blend weight, exact KNN.

| strategy | nDCG@10 | MRR@10 | R@5 | R@10 | Success@1 |
|---|---|---|---|---|---|
| keyword | 0.238 | 0.415 | 12.5% | 22.3% | 27.8% |
| semantic | 0.168 | 0.445 | 9.3% | 14.7% | **30.2%** |
| hybrid | **0.250** | **0.490** | **12.7%** | **24.1%** | 29.1% |

### Chunking changed which strategy wins

An earlier revision produced **1.00 chunks per document** — documents ran ~120 words against a
180-word chunk target, so nothing ever split. On that corpus keyword led at 0.238 and hybrid trailed
at 0.229. With documents lengthened to a 369-word median, hybrid leads at 0.250 and keyword is
unchanged at 0.238.

The mechanism is the one the architecture is built around. Both legs retrieve **chunks**; hybrid
correlates them by chunk id — which is why chunk UUIDs are generated in application code before
either store is written — blends, and only then de-duplicates to documents. When the two legs match
*different chunks of the same document*, blending rewards that document before de-duplication. At one
chunk per document that mechanism is inert, and the benchmark was suppressing hybrid's advantage
while reporting keyword as the winner.

Had the corpus been scaled before this was fixed, every rung of the scale curve would have carried
the artifact — and the conclusion drawn from it would have been that hybrid does not help on this
domain.

By class (nDCG@10) — the reason the benchmark is worth running:

| class | n | keyword | semantic | hybrid |
|---|---|---|---|---|
| identifier | 120 | **0.874** | 0.016 | 0.542 |
| numeric | 121 | **0.277** | 0.133 | 0.226 |
| hard-negative | 118 | 0.130 | **0.227** | 0.224 |
| paraphrase | 117 | 0.126 | **0.207** | 0.206 |
| multi-document | 120 | 0.092 | **0.201** | 0.182 |
| permission-sensitive | 38 | 0.091 | **0.182** | 0.174 |
| troubleshooting | 121 | 0.094 | 0.173 | **0.180** |
| version | 123 | 0.112 | 0.228 | **0.229** |
| ambiguous | 17 | **0.279** | 0.108 | 0.170 |

Lexical retrieval owns the classes where tokens genuinely match; dense retrieval owns every class
where the query and the document describe the same fact in different words. That separation is the
disjoint-vocabulary design showing up in the measurement, and it is what a benchmark is *for*.

Best-vs-worst spread is **0.082 [0.070, 0.095]**, excluding zero on a paired bootstrap.

Hybrid leads on nDCG@10, MRR@10, R@5 and R@10; semantic takes Success@1. Hybrid beating both legs
here is consistent with the Phase 8 finding that blending helps when neither leg dominates — and on
this corpus neither does, because the disjoint vocabularies split the classes cleanly between them.

## 5. The gate

Fails the build if: any strategy saturates (nDCG@10 > 0.85 or Success@1 > 0.90); the strategies
cannot be told apart (spread < 0.02); BM25 solves the paraphrase class it should not (> 0.75); or
nothing clears an answerability floor (nDCG@10 < 0.15). Warns on thin classes and on hard negatives
that are not biting.

**A benchmark that is too easy is a broken instrument, not a good result.** The saturation ceiling
matters more than the floor.

## 6. Five failures, five real defects

The gate rejected the generator five times. Every failure was a construction defect that looked like
a retrieval finding, and **no threshold was moved to make any of them pass**.

| # | Symptom | Actual cause |
|---|---|---|
| 1 | `R@5 = 2.2%` beside `Success@1 = 39.7%` | Grade-1 same-fault peers inflated the relevant set to a **median of 72 documents**, capping R@5 near 7% by construction |
| 2 | paraphrase 0.022, troubleshooting 0.016 | Queries named no incident — ~8 core scenarios share each concept *and its root-cause phrasings*, so no retriever could be right |
| 3 | every strategy pinned near 0.11 | **Two of four siblings shared both service and platform** with their core; anchored queries faced a coin flip, not a hard negative |
| 4 | identifier 0.189 for BM25 | Error codes repeat across up to **6 core scenarios**, so the class had several correct answers and one graded |
| 5 | version 0.041, multi-document 0.034 | Those classes anchored on service alone while paraphrase and troubleshooting anchored on service *and* platform |

Defects 1, 3 and 4 are the same underlying error: **queries whose correct answer was not determined
by the information the query contained**. Each produced plausible-looking numbers, and reading them
as "SaaSBench is brutally hard" would have shipped four contaminated artifacts into the 100K run.

The temptation each time was to lower the 0.15 floor. Doing so after the first failure would have
made the gate ceremonial — and this project already found one check that printed a hardcoded pass.

## 7. What this does not do

1. ~~**Documents produce 1.00 chunks each.**~~ **Fixed** before scaling — 2.25 chunks per document,
   369-word median, so the production chunk-correlate-de-duplicate path is now exercised. Recorded
   because it changed which strategy wins (§4), and because the fix multiplied embedding cost by
   roughly four, which propagates to every rung of the scale curve.
2. **No user-voice documents.** Support tickets are written as agent summaries in engineering voice,
   because a ticket realised from the same `userPhrases` a query uses would contain the query
   verbatim and restore the circularity. Real knowledge bases *do* contain user-voice text sitting
   lexically close to queries, so **this corpus is harder than reality** and scores here understate
   production. Fixing it properly needs a third vocabulary, colloquial and disjoint from both.
3. **qrels are true by construction**, not by human judgment (§2).
4. **Hard negatives are graded 0**, though a human labeller might give a same-fault-different-service
   document a 1. Defensible because the query names the service, but it is a judgment.
5. **The ambiguous class has 17 judged queries** — too few to read on its own. It is reported and
   should not be quoted.
6. **Only the 3,400 rung is measured.** Nothing here says the separation survives to 100K; that is
   precisely what the scale curve is for, and the point of gating before spending on it.
7. **No permission-aware *scoring* yet.** Permission-sensitive queries carry `authorizedQrels` and
   `forbidden` sets, but the gate scores them against global qrels like any other class. Measuring
   quality against the authorized set is Phase 8.
