# Rollback Triggers

Use this table after deploy and during canary.

| Trigger | Signal | Required action |
| --- | --- | --- |
| Local durability regression | `capture_persistence_fallback_failures > 0` | Roll back frontend artifact and halt promotion. |
| Queue non-recovery | `increase(sync_queue_block_events[15m]) >= 5` and `increase(sync_queue_recovery_events[15m]) == 0` | Stop rollout and recover sync path before cap changes. |
| Worker config or routing regression | Sustained `failureCauses.upstream.origin_unconfigured` or `invalidClerkConfig` increase | Roll back worker config/routes, fix config, redeploy. |
| Secret or KV regression | Sustained `invalidRotationSecret`, `kv_unavailable`, or `kvFailures` increase | Stop rollout, restore prior secret or binding, redeploy. |
| Readiness regression | `/ready` remains non-200 after retry budget on `:8788` or `:8080` | Roll back or redeploy prior container image set. |
| Deploy drift | Remote VPS `HEAD` does not match intended release SHA | Fail release and resolve git drift before rerun. |

Primary policy source:

- `docs/RELIABILITY_PROGRAM.md` (`Consolidated Release Gate + Rollback Triggers`)
- `docs/ops/ALERTING.md`
- `docs/ops/DEPENDENCY_RUNBOOK.md`
- `docs/ops/QUEUE_BACKPRESSURE.md`
