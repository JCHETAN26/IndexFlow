# Security Runbook

## Rotating credentials

API keys are rotated every 90 days, or immediately if a leak is suspected. To cycle a
key: issue a new one, deploy it to the affected services, confirm traffic has moved, then
revoke the old key. Never delete the old key before traffic has drained — in-flight
requests will fail with `ERR_AUTH_401`.

## Secrets storage

Secrets live in the managed secrets store, never in the repository or in `.env` files
committed to version control. Local development uses throwaway credentials that only work
against the docker-compose stack.

## Incident response

On a suspected breach, page the on-call security engineer, freeze new deploys, and
snapshot the relevant logs before they age out of the 14-day retention window. File a
timeline in the incident doc as you go — reconstructing it afterward is error-prone.
