# Dead-Letter Queue Inspection & Replay Runbook

This runbook covers diagnosing, inspecting, replaying, and dismissing permanently-failed background jobs from the notification, oracle-signing, and IPFS-pinning queues.

---

## Overview

BACKit's background work (notification dispatch, oracle price signing, IPFS pinning) runs on BullMQ queues backed by Redis. A job that exhausts all its configured retry attempts is moved into the dead-letter queue (`dead-letter`) by `DeadLetterService.moveToDeadLetter`, rather than being silently dropped.

The dead-letter queue is **not itself processed** - nothing ever picks jobs off it. It behaves as a durable, append-mostly store: entries sit permanently in the `waiting` state until an operator resolves them (replay or dismiss) and retention cleanup eventually removes the resolved ones. Redaction is applied before anything is written there, so what an operator sees is always a queue-specific allowlisted view, never the raw job payload.

---

## 1. Safety & Guarantees

1. **Redacted at rest**: dead-letter entries never contain secrets, signed envelopes, credentials, or raw free-text beyond a bounded, allowlisted view. Fields outside each queue's allowlist are dropped, not masked.
2. **Replay operates on the real job, not the redacted copy**: replay retries the _original_ job still held in its source queue (all three source queues keep failed jobs via `removeOnFail: false`), using BullMQ's own `job.retry()`. This is what preserves each queue's existing deduplication behavior (e.g. notifications key jobs by `notificationId`) and guarantees a job is enqueued **at most once** even under concurrent replay requests.
3. **Schema-checked before replay**: replay re-validates the source job's data against the queue's _current_ expected shape immediately before retrying it. A job that failed months ago under an old schema will be rejected rather than replayed blindly.
4. **Every replay/dismiss requires a reason** and is written to the immutable `audit_logs` table (actor, action, target, timestamp) via the existing `@Audited()` mechanism - there is no way to replay or dismiss an entry without leaving an audit trail.
5. **Admin-only**: every endpoint under `/admin/queues` requires `AdminGuard` - unauthenticated and non-admin requests are rejected before anything else runs.

---

## 2. Classification

Entries are automatically classified from the triggering error when the entry is created:

| Classification             | Meaning                                                                                      | Typical operator action                                                                       |
| -------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `RETRYABLE_INFRASTRUCTURE` | Transient external dependency failure (connection reset, timeout, upstream 5xx, rate limit). | Replay once the dependency has recovered.                                                     |
| `PERMANENT_VALIDATION`     | The job payload itself doesn't satisfy current business rules or schema.                     | Investigate the source data; replay will likely fail again unless something upstream changed. |
| `PERMANENT_CONFIGURATION`  | Missing/invalid config, credentials, or an auth failure (401/403).                           | Fix the underlying configuration first, then replay.                                          |
| `UNKNOWN`                  | Classification couldn't be determined from the error (or the entry predates classification). | Inspect manually before deciding.                                                             |

Classification is a heuristic based on the error's name/message and is intentionally conservative - anything not clearly infra or config related falls to `PERMANENT_VALIDATION` rather than being nudged toward an automatic-looking replay.

---

## 3. Operator Execution Workflow

### Step 1: Check queue health

```bash
GET /admin/queues/status
Header: Authorization: Bearer <ADMIN_JWT>
```

Returns job counts (`waiting`, `active`, `delayed`, `completed`, `failed`, `paused`) per queue, including the dead-letter queue itself.

### Step 2: List and filter dead-letter entries

```bash
GET /admin/queues/dead-letter?limit=20&sourceQueue=oracle-signing&classification=RETRYABLE_INFRASTRUCTURE&replayStatus=OPEN
Header: Authorization: Bearer <ADMIN_JWT>
```

Response:

```json
{
  "entries": [
    {
      "dlqJobId": "42",
      "correlationId": "a1b2c3d4-...",
      "sourceQueue": "oracle-signing",
      "jobId": "1001",
      "classification": "RETRYABLE_INFRASTRUCTURE",
      "replayStatus": "OPEN",
      "movedAt": "2026-08-20T10:15:00.000Z",
      "attemptsMade": 3,
      "attempts": 3
    }
  ],
  "nextCursor": "MjA="
}
```

Filters (`sourceQueue`, `classification`, `replayStatus`, `from`, `to`) are applied over an in-memory scan of the dead-letter queue, not an indexed database query - see the implementation note in `DeadLetterService.listEntries` if pages start feeling slow at very high volume. Pass `nextCursor` back as `cursor` to get the next page.

### Step 3: Inspect a single entry

```bash
GET /admin/queues/dead-letter/42
```

Returns the full normalized entry, including the redacted `data`, `failedReason`, and `stacktrace`. If `redactionFailed: true`, the job's data didn't match the expected shape for its queue at the time it was dead-lettered - `data` will be an empty object rather than a best-effort guess. Treat this as a signal to investigate manually before replaying.

### Step 4: Replay or dismiss

Replay (requires a reason, minimum 5 characters):

```bash
POST /admin/queues/dead-letter/42/replay
Content-Type: application/json

{ "reason": "Upstream RPC was down 10:00-10:20 UTC, confirmed recovered" }
```

On success, the response is the updated entry with `replayStatus: "REPLAYED"`. On failure, the endpoint returns:

- `404` - the dead-letter entry itself doesn't exist.
- `409` - the entry is already replayed/dismissed, the source job no longer exists in its source queue, the source job isn't currently in a `failed` state, or another replay for the same entry is already in progress.
- `422` - the source job's current data fails schema validation against the queue's current expected shape, or the source queue doesn't support replay.

Dismiss (also requires a reason) when a failure is known-safe to ignore (e.g. a duplicate, a since-cancelled call):

```bash
POST /admin/queues/dead-letter/42/dismiss
Content-Type: application/json

{ "reason": "Duplicate of entry 41, already resolved there" }
```

### Step 5: Confirm

Re-fetch the entry (`GET /admin/queues/dead-letter/42`) and confirm `replayStatus` reflects the action, along with `replayedBy`/`replayReason` or `dismissedBy`/`dismissReason`. Cross-check `GET /admin/queues/status` - a successful replay should show the source job back in `waiting`/`active` on its own queue.

---

## 4. Retention & Metrics

- **Cleanup** runs daily (`dead-letter-cleanup` cron, 03:00). `REPLAYED` entries are removed after 7 days, `DISMISSED` entries after 30 days. `OPEN` entries are **never** auto-removed, no matter how old - an unresolved failure disappearing silently is worse than it sitting around, so a stale `OPEN` entry only triggers a warning log, not a deletion.
- **Depth/age metrics** are logged every 15 minutes (`dead-letter-depth-metrics` cron) as structured `logger.log`/`logger.warn` lines: open count, oldest-open-entry age, and breakdowns by source queue and classification. There is no metrics-backend integration yet (no `prom-client` in this repo) - route these log lines into whatever log-based alerting is already in place, and page/alert on `dead_letter.stale_open_entry` and on `openCount` growing without bound.
- **Redaction failures** (`dead_letter.redaction_failed`) and **replay failures** (`dead_letter.replay.failed`) are also logged at `warn` level as they happen - these are worth alerting on directly rather than waiting for the periodic depth scan.

---

## 5. Incident Response

1. **A queue is dead-lettering everything**: check `GET /admin/queues/status` for that queue's `failed` count trending up, then pull a page of its `OPEN` dead-letter entries filtered by `sourceQueue` and check `classification` - `PERMANENT_CONFIGURATION` across many entries at once usually means a config/credential problem was just introduced, not that each individual job is bad. Fix the configuration, then batch-replay the affected `OPEN` entries one at a time (there is no bulk-replay endpoint by design - each replay requires its own operator reason).
2. **Replay keeps failing with a 409 "source job no longer exists"**: the source job was already cleaned up from its own queue (its own `removeOnComplete`/`removeOnFail` retention window is shorter than the dead-letter entry's). The job cannot be safely reconstructed from the redacted dead-letter copy - dismiss the entry and re-trigger the original action from its origin (e.g. re-queue a fresh notification) if it's still needed.
3. **Replay keeps failing with a 422 schema validation error**: the queue's job schema changed since this job was dead-lettered. Check `dead-letter-schema.ts` against the source job's actual data (visible in the entry's redacted `data`, or in Redis directly for the full picture) to see what no longer matches, then decide whether to dismiss or fix the source data out-of-band before retrying manually.
4. **A lock seems stuck ("another replay ... already in progress" on every attempt)**: the replay lock (`dead-letter:replay-lock:<id>` in Redis) self-expires after 30 seconds, so this should never persist - if it does, check for a hung request rather than clearing the key manually.

---
