# ADR 0002: Generation Metrics Require Judge Calibration

## Status

Accepted.

## Context

Retrieval and ACL evaluations have explicit ground truth. Generation quality was different:
faithfulness, relevance, citation correctness, and refusal correctness were judged by local LLMs.
That made the numbers useful for regression detection but not yet independently calibrated.

## Decision

`eval:rag` persists the full report. `judge:export` creates a blind human audit sheet and a
separate answer key. `judge:calibrate` compares human labels against judge verdicts and reports
agreement, Cohen's kappa, and disagreement direction for each judge surface.

## Consequences

- Generation metrics must be quoted as LLM-judged until a human audit is completed.
- High agreement upgrades the metrics from an assertion to evidence.
- Low agreement is treated as a finding about the judge, not as a failure of the product.
