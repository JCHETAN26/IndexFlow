#!/usr/bin/env python3
"""Cross-check the harness metrics against pytrec_eval (NIST trec_eval).

Phase 1a of the evaluation hardening. `eval/metrics.ts` is a from-scratch implementation that
decides whether CI's quality gate passes; this scores identical rankings with the reference
implementation the IR literature uses and reports the delta.

Pre-registered prediction (docs/eval/WORKLOG.md, written before this ran):

    harness_value == (judged / total) * reference_value

for recip_rank, recall@{1,3,5}, P_3 and ndcg_cut_5 -- because trec_eval averages only over
queries that appear in qrels, and a query with no relevant documents cannot appear there, while
the harness divides by all 34. Any residual beyond that factor is a real convention mismatch and
the reference wins.

Exit code is non-zero if anything disagrees beyond tolerance, so this can gate CI.

Usage: python3 eval/crosscheck.py [trec_dir]
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

try:
    import pytrec_eval
except ImportError:
    sys.exit(
        "pytrec_eval is not installed.\n"
        "  pip install pytrec_eval\n"
        "It is a C extension, so it needs a working compiler. On a Mac without Xcode command "
        "line tools this will not build -- run it in CI instead."
    )

MEASURES = {"recip_rank", "recall_1", "recall_3", "recall_5", "P_3", "ndcg_cut_5"}
# Agreement is asserted to 4 decimal places, per the brief.
TOLERANCE = 1e-4


def read_qrels(path: Path) -> dict[str, dict[str, int]]:
    qrels: dict[str, dict[str, int]] = {}
    for line in path.read_text().splitlines():
        if not line.strip():
            continue
        qid, _, docid, rel = line.split()
        qrels.setdefault(qid, {})[docid] = int(rel)
    return qrels


def read_run(path: Path) -> dict[str, dict[str, float]]:
    run: dict[str, dict[str, float]] = {}
    for line in path.read_text().splitlines():
        if not line.strip():
            continue
        qid, _, docid, _, score, _ = line.split()
        run.setdefault(qid, {})[docid] = float(score)
    return run


def main() -> int:
    out_dir = Path(sys.argv[1] if len(sys.argv) > 1 else ".evalrun/trec")
    harness_blob = json.loads((out_dir / "harness.json").read_text())
    total = harness_blob["numQueries"]
    judged = harness_blob["numJudged"]
    scale = judged / total

    print(f"cross-check against pytrec_eval  ({pytrec_eval.__name__})")
    print(f"queries: {total} total, {judged} judged -> predicted scale {judged}/{total} = {scale:.6f}")
    print(f"tolerance: {TOLERANCE} (4 decimal places)\n")

    qrels = read_qrels(out_dir / "qrels.txt")
    if len(qrels) != judged:
        print(f"FAIL  qrels holds {len(qrels)} queries, harness reports {judged} judged")
        return 1

    evaluator = pytrec_eval.RelevanceEvaluator(qrels, MEASURES)
    failures: list[str] = []

    for ranker, expected in harness_blob["metrics"].items():
        run_path = out_dir / f"{ranker}.run"
        if not run_path.exists():
            failures.append(f"{ranker}: missing {run_path}")
            continue

        per_query = evaluator.evaluate(read_run(run_path))
        # trec_eval's own averaging: mean over queries present in qrels.
        reference = {
            m: sum(q[m] for q in per_query.values()) / len(per_query) for m in sorted(MEASURES)
        }

        print(f"── {ranker} " + "─" * (66 - len(ranker)))
        print(f"{'measure':<14}{'harness':>12}{'reference':>12}{'ref x scale':>14}{'delta':>12}  ")
        for m in sorted(MEASURES):
            ours = expected[m]
            ref = reference[m]
            rescaled = ref * scale
            delta = ours - rescaled
            ok = abs(delta) <= TOLERANCE
            if not ok:
                failures.append(
                    f"{ranker}/{m}: harness {ours:.6f} vs reference*scale {rescaled:.6f} "
                    f"(raw reference {ref:.6f}, delta {delta:+.6f})"
                )
            print(
                f"{m:<14}{ours:>12.6f}{ref:>12.6f}{rescaled:>14.6f}{delta:>+12.2e}"
                f"  {'ok' if ok else 'MISMATCH'}"
            )
        print()

    if failures:
        print("FAILED — the reference is right; fix the implementation or document the convention.")
        for f in failures:
            print(f"  {f}")
        return 1

    print("All measures agree with pytrec_eval to 4dp after the judged/total correction.")
    print(
        "Confirms: the metric code is correct, and the only divergence from the reference is the\n"
        "unanswerable query sitting in the harness denominator — which is the Phase 2 finding."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
