# ADR-0001: The non-technical owner is the beachhead; agents are peers, not a bolt-on

- **Status**: Accepted
- **Date**: 2026-08-27
- **Fork**: FORK-1

## Context

pre-fab has three plausible first users: the non-technical business owner, the
agent operating on their behalf, and the developer who wants a portable stack.
Designing for all three at once produces a product that serves none well, because
they want opposite things from the first screen — a template gallery, a schema, or
a `git clone`.

The temptation is to lead with the agent, since "agent native" is the novel part.
It is also the smallest market. A technical user who wants an agent to build a
website already has Astro and a text editor, and that combination is free.

## Decision

The non-technical business owner is the beachhead. The editor gets the design
effort and the first slice's polish budget.

Agents are nonetheless **peers, not a secondary integration**. Every mutation
available to a human is available to an agent and vice versa. This is enforced by
a conformance test in CI that enumerates API mutations and asserts a
corresponding CLI command and MCP tool for each (ADR-0003), not by review
discipline.

Agents receive no elevated trust: identical validation, identical authorisation,
with per-site scoped, expiring, revocable tokens.

Developers and agencies are a deliberate second segment. No milestone-1 feature
is built for them, though export and the CLI are what will eventually attract
them.

## Consequences

- Slice 1 must produce something visually credible, not just a working schema.
- Template quality is a launch blocker, not a nice-to-have — the owner cannot
  design, so "pretty by default" is a functional requirement (see ADR-0011).
- Agent parity costs work in every slice rather than being a phase. This is
  accepted; retrofitting parity after the fact has never worked in any product
  that tried it.
- We will be slower than an agent-first competitor to serve technical users, and
  faster to revenue.

## Rejected

**Agent-first, UI later.** Smallest addressable market, and the alternative
(Astro plus an agent) is free and already good. We would be competing on
convenience against zero cost.

**Serve all three equally.** Produces an onboarding flow that asks a café owner
whether they want to connect a repository.
