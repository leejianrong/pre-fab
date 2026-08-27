# ADR-0002: Database of record, with the file tree as a bidirectional projection

- **Status**: Accepted
- **Date**: 2026-08-27
- **Fork**: FORK-3

## Context

The product promises portability and diffability, which points at a git-style
tree of human-readable files as the source of truth. It is also a hosted
multi-tenant SaaS with history, permissions, row-level isolation and concurrent
editing, which points at a database.

Choosing purely either way breaks something the product sells:

- **Files of record** makes hosted editing genuinely painful. Every keystroke-ish
  save becomes a commit; per-tenant authorisation has to be reimplemented over a
  filesystem; history, search and cross-site queries get slow and awkward.
- **Database of record with export-on-demand** makes the file tree an afterthought
  that is lossy, rarely exercised, and quietly broken — which is exactly the
  export experience the incumbents already offer and that we exist to beat.

## Decision

**The database is the record. The file tree is a first-class bidirectional
projection**, closer in shape to Terraform state than to git.

- `prefab pull` materialises a site as readable files on disk.
- `prefab push` sends them back through exactly the same validation, migration
  and version checks as any other write (ADR-0003).
- `prefab diff` shows local against remote.

The projection is kept honest by making it load-bearing rather than optional:
templates are authored as exported site trees (ADR-0011), and CI asserts that
`export → import → export` is byte-identical (R8). The export path is therefore
exercised on every build by the people making the product.

Document model:

- Blocks are a **flat list** of nodes, each with a **ULID**, a `parent` and an
  `order` — never a nested JSON tree, never positional references.
- Layout and long-form content are separate documents, so a writer can edit prose
  without touching layout.
- One `theme.json` per site holds design tokens. Blocks may reference tokens only,
  never raw values.
- Assets are content-addressed by sha256 and referenced by hash plus a human
  filename.
- Every document carries `schemaVersion`; migrations are forward-only, run on
  read, persisted on next write.

## Consequences

- Offline editing is real but bounded: edit, build and preview a checkout with no
  network (R16); publishing needs the network.
- Flat, ULID-keyed blocks mean an agent patch never has to say "the third block",
  which removes an entire class of concurrent-edit races.
- The same shape leaves the door open to CRDTs later without a format migration,
  should multiplayer editing be built (ADR-0006).
- The token-only constraint on blocks is restrictive and is the reason templates
  can be restyled at all. Blocks that need a one-off colour must add a token.
- Two representations means a sync bug class that neither pure option has. The
  round-trip test is the mitigation, and it must never be allowed to be skipped.

## Rejected

**Git repository of record.** Beautiful demo, and it makes multi-tenant hosted
editing, permissions and history into custom infrastructure. Also exposes the
owner to git as a concept, which ADR-0001 rules out.

**Database only, export as a report.** The export becomes a lossy afterthought.
This is the incumbent behaviour we are differentiating against.
