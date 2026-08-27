# ADR-0003: One write path for the editor, CLI, MCP and API

- **Status**: Accepted
- **Date**: 2026-08-27

## Context

pre-fab has four surfaces: a visual editor, a CLI, an MCP server, and an HTTP
API. The default outcome for a product like this is that the UI gets features
first, the API lags, and the CLI and MCP become a permanently incomplete subset.
Every vendor with an "API-first" claim and a UI-only feature list arrived there
the same way.

Since the entire agent story depends on an agent being able to do what a human
can, a lagging API is not a papercut here. It is the product failing.

## Decision

There is exactly one write path. The editor, CLI and MCP server are all clients
of the same HTTP API. MCP is a thin adapter over the CLI's command layer, so it
cannot drift from the CLI independently.

**A mutation that is not in the API does not exist.** No surface gets a
back-door into the database.

Parity is a test, not a policy: CI enumerates every API mutation and fails the
build unless each has a corresponding CLI command and MCP tool (R12).

Agent-facing ergonomics are treated as contract, not convenience:

- `--json` on every CLI command.
- Errors as JSON on stderr with stable `code` values.
- Exit codes: 0 ok, 1 user error, 2 conflict, 3 auth, 4 upstream.
- `site outline` returns the whole site as a compact tree of ids, types and
  one-line summaries, so an agent orients in one call rather than reading every
  page (R14).
- `preview --json` returns a stable preview URL and a rendered screenshot path,
  so an agent can see its own output (R15). Agents that cannot see what they made
  produce ugly sites.

## Consequences

- Every feature costs slightly more: an API endpoint, a CLI command, an MCP tool.
  Accepted, and the reason parity survives.
- The API's shape is effectively public from day one even though it carries no
  stability guarantee until after milestone 1.
- The editor cannot take shortcuts for latency. Where the UI needs to feel
  instant, that is solved with optimistic local state over the same API, not with
  a private path.
- `site outline` and screenshot preview are deliverables with their own tests,
  not afterthoughts.

## Rejected

**UI-first with an API that follows.** The failure mode described above, and it
is the normal outcome rather than a risk.

**A separate agent-optimised write path.** Two paths means two validation
implementations and, eventually, two behaviours.
