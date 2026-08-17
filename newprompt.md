Send Claude Code this prompt next. It is scoped so it **does not prematurely optimize IndexFlow** or contaminate SaaSBench.

````markdown
# IndexFlow — Phase 4: Freeze the Valid Benchmark, Establish the True Retrieval Baseline, and Diagnose Where Quality Is Lost

You are working in the IndexFlow repository.

Do not start by trying to improve MRR, nDCG, or Success@1.

The purpose of this phase is to establish the first trustworthy retrieval baseline on the corrected SaaSBench benchmark and determine whether IndexFlow's remaining retrieval error comes from:

1. candidate generation,
2. chunk/document representation,
3. fusion/ranking,
4. or some remaining benchmark construction defect.

Only after that diagnosis may we change production retrieval behavior.

---

# 1. Context

IndexFlow is a permission-aware hybrid document search and RAG system.

Production retrieval currently uses:

- Elasticsearch BM25 sparse retrieval
- PostgreSQL + pgvector dense retrieval
- local `all-MiniLM-L6-v2` embeddings
- hybrid score fusion
- optional local BGE cross-encoder reranking
- pre-ranking ACL enforcement in both retrieval legs

PostgreSQL is the source of truth.

Elasticsearch is a derived projection.

Permission filtering must remain inside each retrieval engine before ranking.

Do not weaken any authorization or consistency invariant during this phase.

---

# 2. Important benchmark history

SaaSBench went through two invalid constructions.

## Invalid version A — anchor collisions

Too many scenarios shared anchors/fault characteristics.

Queries often did not contain enough information to uniquely determine the relevant scenario.

This produced artificially low metrics.

This version is benchmark-invalid.

## Invalid version B — unique anchors

Every scenario effectively received a unique service/entity anchor.

This made BM25 artificially strong because the anchor became a de facto document identifier.

This produced approximately:

- keyword nDCG@10: 0.612
- hybrid MRR@10: 0.840
- keyword MRR@10: 0.896
- Success@1: ~83.5%

These numbers are also benchmark-invalid and MUST NOT be treated as baselines or resume-safe metrics.

---

# 3. Current corrected SaaSBench design

The corrected design uses:

```text
ANCHOR_MULTIPLICITY = 5
````

This is a pre-registered structural rule.

It was NOT selected by trying multiple values and choosing the one that produced attractive retrieval metrics.

Current structure:

```text
150 core scenarios
30 anchors
5 scenarios per anchor
```

Each anchor contains five scenarios with distinct faults/root causes.

Example conceptually:

```text
editor-api on iOS
├── autosave debounce regression
├── websocket reconnect failure
├── memory pressure
├── cache invalidation issue
└── stale auth token
```

The anchor narrows retrieval to a small neighborhood, but the query's symptom/fault semantics must determine the correct scenario.

Each query therefore naturally receives four same-anchor hard negatives.

This is the intended benchmark difficulty.

DO NOT change `ANCHOR_MULTIPLICITY`.

---

# 4. Structural validity gates already implemented

`structural.ts` contains five construction rules.

They are data-only checks and run before embeddings/services.

Their purpose is to catch BOTH benchmark failure directions:

```text
artificially trivial
and
artificially impossible
```

Rules 1–3 detect anchor/entity leakage.

Rules 4–5 detect answerability collisions such as same anchor + same fault.

The lexical-overlap check is document-frequency aware.

A shared term is considered suspicious only when it occurs in less than 10% of documents.

This prevents generic template terms such as:

```text
team
service
alert
should
```

from being incorrectly treated as lexical leaks simply because they appear in both query and document.

All structural gates currently pass.

Do NOT weaken or remove any structural gate.

Do NOT lower any threshold after observing retrieval results.

---

# 5. Anchor-ablation diagnostics already implemented

The keyword leg supports:

```text
FULL
ANCHOR-ONLY
ANCHOR-MASKED
```

Diagnostics warn when:

```text
anchor-only >= 80% of FULL
```

because the benchmark may be collapsing into entity lookup.

They also warn when:

```text
anchor-masked < 25% of FULL
```

because retrieval may depend almost entirely on the anchor.

These are diagnostics/warnings, not numbers to optimize directly.

Keep them intact.

---

# 6. Freeze the benchmark before doing anything else

Before running retrieval experiments:

1. Verify the corrected SaaSBench artifacts are frozen.
2. Verify the corpus/query/qrel/config hashes are recorded.
3. Verify structural gates pass.
4. Record the exact commit SHA.
5. Ensure the invalid collided-anchor and unique-anchor results are clearly marked:

   * `BENCHMARK_INVALID`
   * or `SUPERSEDED`
   * never baseline
   * never resume-safe

Once this corrected artifact is frozen:

DO NOT modify:

* anchor multiplicity
* query wording
* query-class distribution
* relevant judgments
* hard-negative counts
* anchor structure
* lexical thresholds
* scenario fault distribution

in response to retrieval results.

If a genuine benchmark defect is discovered, stop and document it explicitly rather than silently editing the benchmark.

---

# 7. Task A — Establish the clean retrieval baseline

Using the corrected frozen benchmark, run the current SHIPPING retrieval implementations unchanged:

```text
keyword
semantic
current hybrid
```

Do not fix the hybrid bug yet.

We need an honest before-state.

Measure at minimum:

```text
nDCG@10
MRR@10
Success@1
Recall@5
Recall@10
```

Report:

* overall
* tune split
* held-out/test split if the current gate architecture requires it
* per query class

Preserve all current held-out discipline.

Do not tune anything using the test split.

Per-class reporting should include whatever classes currently exist, especially:

```text
identifier
paraphrase
troubleshooting
version
multi-document
permission-sensitive
hard-negative
```

Also include the anchor-ablation results:

```text
FULL
ANCHOR-ONLY
ANCHOR-MASKED
```

for keyword retrieval.

The purpose is to establish the FIRST trustworthy baseline after benchmark correction.

Do not react to the number.

Whether MRR is 0.45, 0.65, or 0.90, record it.

---

# 8. Task B — Candidate-recall diagnostics

We need to know whether the correct documents are absent from first-stage retrieval or merely ranked poorly.

For each judged query, collect candidate rankings at:

```text
10
30
50
100
```

for:

```text
keyword
semantic
keyword ∪ semantic
```

Calculate:

```text
Candidate Recall@10
Candidate Recall@30
Candidate Recall@50
Candidate Recall@100
```

for each leg and for the union.

Also report these metrics per query class.

Do not modify production `CANDIDATE_LIMIT` yet.

This is diagnostic evaluation.

If the evaluation system can obtain deeper rankings without modifying shipping behavior, use that mechanism.

---

# 9. Task C — Oracle candidate ceiling

For the candidate union only:

```text
BM25 top-N ∪ Dense top-N
```

use qrels to compute an analytical perfect-ranking ceiling.

Calculate at useful depths, especially 30 and 100:

```text
Oracle MRR@10
Oracle nDCG@10
Oracle Success@1
```

This means:

* collect the candidate union,
* use ground-truth qrels to put relevant documents in ideal order,
* ask how good the system COULD be if ranking were perfect.

These are DIAGNOSTIC ORACLE numbers.

They must be labeled clearly:

```text
NOT DEPLOYABLE
NOT A SYSTEM RESULT
NOT RESUME-SAFE
```

The purpose is only to answer:

> Does IndexFlow already retrieve the right documents and then rank them badly?

---

# 10. Task D — Quantify chunk-to-document candidate collapse

The corrected SaaSBench now averages approximately:

```text
2.25 chunks/document
```

This means chunk-level candidate depth may provide substantially fewer distinct documents.

For each query and each retrieval leg, report:

```text
top 10 chunks  → unique documents
top 30 chunks  → unique documents
top 50 chunks  → unique documents
top 100 chunks → unique documents
```

Produce aggregate statistics:

```text
mean
median
p25
p75
p95
minimum
maximum
```

Also report:

```text
duplicate chunk slots per query
percentage of candidate capacity consumed by repeat documents
```

for:

```text
keyword
semantic
union
```

Do not change document aggregation yet.

This is a diagnosis.

---

# 11. Important known production bug — DO NOT FIX UNTIL BASELINE IS RECORDED

`lib/hybrid.ts` contains a confirmed tail-drop defect.

Current behavior:

```text
normalize()
minimum score → 0
```

then:

```text
blendHybrid()
drops score == 0
```

Therefore:

> the lowest-ranked candidate in one leg, when absent from the other leg, can silently disappear from the hybrid candidate set.

This is a real production bug.

However:

DO NOT fix it before Tasks A–D are complete and their artifacts are saved.

We need:

```text
legacy shipping baseline
```

before changing behavior.

Once the baseline and diagnostics are safely recorded, proceed to Task E.

---

# 12. Task E — Fix the min-max tail-drop bug

After baseline freeze:

Implement the smallest correct fix.

Requirements:

* a valid candidate must not disappear merely because it was the minimum score in a normalized list
* weight endpoints must still behave correctly
* deterministic ranking
* empty-list handling remains correct
* one-leg-only candidates survive
* duplicate IDs remain correctly merged
* no ACL behavior changes

Preserve the old behavior in evaluation only if needed for exact historical reproduction, e.g.:

```text
legacyMinMaxFusion()
correctedMinMaxFusion()
```

Do not expose legacy broken behavior as a production option.

Add/modify unit tests.

The existing test currently documenting the tail drop as a `KNOWN WART` should be replaced with a correctness test proving it no longer occurs.

---

# 13. Task F — Measure corrected hybrid

Without changing anything else, rerun the corrected hybrid on the frozen benchmark.

Compare:

```text
legacy hybrid
vs
corrected hybrid
```

Measure:

```text
MRR@10
nDCG@10
Success@1
Recall@10
```

with query-level paired bootstrap.

Report:

```text
absolute delta
relative delta
95% paired-bootstrap CI
sample size
```

If the fix has negligible metric impact, that is completely acceptable.

Correctness is sufficient justification for the bug fix.

Do not invent an improvement claim.

---

# 14. Task G — Document-level aggregation experiment

Do this only after Tasks A–F.

Current evaluation collapses ranked chunks to documents using first occurrence.

We need to determine whether chunk multiplicity is harming candidate efficiency or ranking.

Do NOT assume first-occurrence is inherently wrong.

If chunks are already score ordered, first occurrence is equivalent to selecting the highest-ranked chunk for a document after ranking.

The actual concern is that multiple chunks from one document can:

* consume candidate slots,
* influence fusion,
* prevent other documents from entering the candidate pool.

Test on the TUNE split only:

## Variant A — current behavior

```text
chunk retrieval
→ chunk fusion
→ document first-occurrence dedup
```

## Variant B — per-leg best-chunk document aggregation

```text
BM25 chunks
→ best chunk per document

Dense chunks
→ best chunk per document

→ document-level fusion
```

## Variant C — optional supporting-chunk aggregation

Only if justified:

```text
document score =
best chunk
+
small capped contribution from supporting chunks
```

Do not give large documents an unbounded advantage for having more chunks.

Compare:

```text
MRR@10
nDCG@10
Success@1
Recall@10
unique candidate documents
```

Use paired bootstrap.

Do not select using the test split.

---

# 15. DO NOT implement these yet

Explicitly postpone:

## Query router

Do not build a sparse/dense router yet.

Earlier evidence used to justify routing came from benchmark-invalid datasets.

We need uncontaminated per-class results first.

## RRF / weighted RRF

Do not implement it in this phase unless needed solely for a tiny diagnostic prototype.

It belongs after the baseline/candidate/document diagnosis.

## Structured BM25

Do not modify Elasticsearch mappings or boosts yet.

## Embedding model bakeoff

Do not replace MiniLM yet.

## Reranker changes

Do not change reranker placement yet.

## RAG generation changes

Do not modify the LLM prompt or answer generation yet.

## 100K scale

Do not scale SaaSBench to 100K yet.

First freeze the retrieval configuration.

---

# 16. Decision report

At the end, produce a report that answers these questions directly.

## Q1. Is the benchmark structurally valid?

Report all structural gates and ablation warnings.

## Q2. What is the clean shipping baseline?

Report keyword / semantic / hybrid.

## Q3. Is IndexFlow failing candidate generation or ranking?

Use candidate recall + oracle ceiling.

Example interpretation:

```text
union Recall@100 high
oracle MRR much higher than shipping MRR
→ ranking/fusion bottleneck
```

versus:

```text
union Recall@100 low
→ first-stage retrieval/representation bottleneck
```

## Q4. How much candidate depth is wasted by repeated chunks from the same document?

Report chunk→document compression.

## Q5. Did fixing the real hybrid bug change quality?

Report paired delta.

## Q6. Does pre-fusion document aggregation appear promising?

Report tune-split results only.

## Q7. What should the NEXT engineering phase be?

Choose based strictly on evidence:

### If union recall is high, oracle ceiling is high:

recommend ranking work such as:

```text
RRF
union reranking
document aggregation
```

### If keyword recall is weak:

recommend lexical/index improvements.

### If dense recall is weak:

recommend embedding/representation investigation.

### If sparse/dense show genuine query-class complementarity:

query routing may become justified.

Do not recommend the router merely because it was in an older plan.

---

# 17. Required files/artifacts

Update or create appropriate remediation/evaluation artifacts.

At minimum record:

```text
benchmark version/hash
git commit SHA
corpus hash
query hash
qrel hash
number of docs
number of chunks
chunks/document
number of tune queries
number of test queries
retrieval candidate depths
embedding model
fusion implementation
```

Produce machine-readable results where practical.

Suggested outputs:

```text
docs/remediation/saasbench-baseline.md
docs/remediation/retrieval-diagnostics.md
eval/saasbench/results/baseline.json
eval/saasbench/results/candidate-recall.json
eval/saasbench/results/oracle-ceiling.json
eval/saasbench/results/chunk-collapse.json
```

Adapt paths to the actual repository structure rather than forcing these exact names if the existing SaaSBench implementation uses a different layout.

Update the claim ledger.

Invalid benchmark numbers must remain explicitly invalid.

---

# 18. Testing

All existing tests must stay green.

Run at minimum:

```text
typecheck
unit
integration
cross-store consistency
sharing lifecycle
permission-leak tests
```

Add focused tests for the corrected hybrid bug.

Do not weaken existing assertions.

If required external services are unavailable, mark the relevant work:

```text
BLOCKED
```

or:

```text
NOT RUN
```

Never silently skip and report PASS.

---

# 19. Security invariant

Any diagnostic or new retrieval path must preserve:

```text
unauthorized candidates = 0
```

Do not fetch unauthorized candidates and filter them later.

The permission architecture is not part of the optimization surface.

---

# 20. Working discipline

This project has repeatedly discovered that apparently attractive benchmark numbers were caused by evaluation defects.

Therefore:

* preregister hypotheses before testing them
* record predictions that turn out wrong
* do not edit thresholds after seeing results
* do not tune on test data
* do not preserve a change merely because it improves a metric
* revert experiments that do not improve correctness or supported quality
* document negative results
* distinguish benchmark diagnostics from shipping system metrics

The objective is not "get a high MRR."

The objective is:

> build the strongest defensible permission-aware retrieval system and let a frozen benchmark measure it honestly.

---

# 21. Stop condition

Do NOT proceed into RRF, adaptive routing, BM25 redesign, new embedding models, reranker redesign, 100K scaling, or RAG-generation work in this phase.

Stop after:

1. corrected SaaSBench frozen and validated,
2. clean shipping baseline recorded,
3. candidate recall measured,
4. oracle ceiling measured,
5. chunk/document collapse measured,
6. hybrid tail-drop bug fixed and measured,
7. document aggregation experiment measured on tune data,
8. evidence-based recommendation for the next phase written.

Then report the results to me before implementing the next retrieval architecture.

```

That prompt is intentionally **diagnostic before optimization**.

The biggest mistake now would be telling Claude, “Get MRR above 0.9.” It would encourage exactly the kind of benchmark/system overfitting you’ve been successfully catching. This prompt instead gets us the few numbers we need to decide whether the next move should be **RRF/reranking, document aggregation, BM25 improvements, or stronger embeddings**.
```
