# ADR-0006: Optimistic concurrency, and no silently lost writes

- **Status**: Accepted
- **Date**: 2026-08-27

## Context

Four surfaces write to one document (ADR-0003), and at least one of them is an
agent that may issue a burst of edits while a human is dragging blocks around in
the editor. Two tabs open is the mundane version of the same problem.

The failure mode that matters is not a conflict — it is a conflict resolved
silently in favour of whoever wrote last, so the owner's work disappears with no
error and no trace. For an agent, it is worse: the agent believes its write
succeeded and reasons onward from a state that no longer exists.

Real-time multiplayer via CRDTs solves this properly and is a large bet for a
product whose primary user is a solo freelancer.

## Decision

**Optimistic concurrency with an explicit version check. No write is ever
silently lost.**

- Every write carries the base version it was computed against.
- On mismatch, the server rejects with exit code 2 / a `conflict` error code, and
  returns the current state plus a machine-readable diff, so an agent can rebase
  and retry without a second round trip to understand what happened.
- The editor surfaces this as "this page moved on", with reload or overwrite.
- Publishing does not block editing: publish snapshots the current version, and
  later edits go into the next publish.

No CRDTs and no real-time multiplayer in milestone 1. But the document shape
chosen in ADR-0002 — flat, ULID-keyed, no positional references — is precisely
the shape a CRDT layer needs, so adding Yjs later is a feature, not a format
migration.

## Consequences

- Agents must handle a conflict response. This is why the diff is in the
  rejection payload rather than requiring a follow-up fetch.
- Two humans editing the same page simultaneously is a poor experience. Accepted
  for milestone 1: the primary user is a solo owner, and invited editors are rare
  and usually asynchronous.
- Losing an overwrite race is recoverable, because history is retained and any
  prior version can be restored (R5).

## Rejected

**Last write wins.** Cheapest, and it silently destroys work. Disqualifying.

**Pessimistic locking.** Predictable, and it deadlocks in practice the moment a
tab is left open or an agent crashes mid-edit.

**CRDTs in milestone 1.** The right long-term answer for multiplayer, wrong now:
large, invasive, and solving a problem the beachhead user does not have.
