# Workspace Search — Product Spec

## Goal

Let anyone on the team find a fact that lives inside a document, not just match a
document title. A new hire should be able to type "how do we rotate API keys" and land on
the exact paragraph of the security runbook, even if the runbook never uses the word
"rotate".

## Non-goals

- We are not building a chat assistant. Results are passages, not generated answers.
- We are not indexing external web pages, only files uploaded to the workspace.

## Ranking

Every query runs two retrievers in parallel: a keyword retriever for exact tokens
(error codes, config keys, endpoint names) and a semantic retriever for meaning. The two
score lists are normalized and blended; passages found by both are rewarded. The blend
weight is not guessed — it is chosen by an offline evaluation over a labeled query set.

## Latency budget

The p95 end-to-end search latency target is 250ms for a warm index. The query embedding
is the dominant cost, so we cache the embedding model in memory on the worker.
