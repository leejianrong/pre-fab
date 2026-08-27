# Decision register — pre-fab

Status of every question raised during planning. Derived and self-answered in one
pass; only `FORK` items went to the user.

- `FORK` — low confidence **and** high cost of being wrong. Escalated.
- `ASSUMED` — answered with a default. If the default is wrong, the cost is
  visible here rather than absent.
- `DEFERRED` — genuinely not needed until after milestone 1.

Round 1 derived 41 questions, of which 9 were forks. Eight were accepted as
recommended; FORK-4 reopened into round 2 alongside a new FORK-10.

---

## 1. Primary user and actors

| # | Question | Status | Answer |
|---|---|---|---|
| 1.1 | Who is the beachhead user for milestone 1? | FORK-1 | See below |
| 1.2 | Are agents first-class actors or a bolt-on? | ASSUMED | First-class. Every mutation an agent can make, a human can make, and vice versa — enforced by both going through one write path (ADR-0003). |
| 1.3 | When a human and an agent conflict on the same site, who wins? | ASSUMED | Neither silently. Optimistic concurrency on document version; the loser is rejected with a structured conflict error, never overwritten (ADR-0006). |
| 1.4 | Is the site *visitor* a user we design for in milestone 1? | ASSUMED | Yes, but only via measurable output quality (LCP, a11y), not features. |
| 1.5 | Are developers/agencies a target segment? | DEFERRED | They are the natural second segment (export + CLI appeals to them) but no milestone-1 feature is built for them. |
| 1.6 | Do we support multiple collaborators per site? | ASSUMED | One owner + invited editors, role = owner/editor/viewer. No per-block permissions. |

## 2. Scope boundary

| # | Question | Status | Answer |
|---|---|---|---|
| 2.1 | Which of the five pillars ship in milestone 1? | FORK-2 | See below |
| 2.2 | E-commerce (product catalogue, cart, inventory)? | DEFERRED | Explicitly out. Payments in scope means *one-off and recurring payment blocks*, not a store. |
| 2.3 | Membership / gated content? | DEFERRED | Out. Depends on visitor identity, which milestone 1 does not have. |
| 2.4 | Multilingual sites? | DEFERRED | Out, but the content model keys content by locale from day one so it is not a migration later. |
| 2.5 | Email marketing / newsletters? | DEFERRED | Out. We capture contacts and export them; sending campaigns is someone else's product. |
| 2.6 | A/B testing, analytics dashboard? | ASSUMED | Basic first-party page-view counts in scope (privacy-preserving, no cookies). Experiments out. |
| 2.7 | Do we build a domain registrar? | ASSUMED | No. Bring-your-own domain; we provision TLS and guide DNS. Reselling domains is a distraction. |

## 3. Core data model and identity

| # | Question | Status | Answer |
|---|---|---|---|
| 3.1 | What is the canonical source of truth for a site? | FORK-3 | See below |
| 3.2 | How is a block addressed? | ASSUMED | Stable ULID per block, assigned on creation, preserved across move/copy/export/re-import. Never positional — positional refs make every agent edit a race (ADR-0002). |
| 3.3 | Does identity survive export and re-import? | ASSUMED | Yes, and this is a tested invariant: export → import → export is byte-identical. |
| 3.4 | Layout and content in one document or separate? | ASSUMED | Separate. `page.json` holds the block tree with content *slots*; long-form content (blog posts) lives in MDX-ish files. Lets a writer edit prose without touching layout. |
| 3.5 | Where do design tokens live? | ASSUMED | One `theme.json` per site (colour, type scale, spacing, radii). Blocks may only reference tokens, never raw hex. This is what makes templates swappable. |
| 3.6 | Is the block tree nested or flat? | ASSUMED | Flat list of nodes with a `parent` + `order`, not a nested JSON tree. Flat lists diff cleanly, survive concurrent edits, and are trivially patchable by an agent. |
| 3.7 | How are uploaded assets identified? | ASSUMED | Content-addressed (sha256), stored in object storage, referenced by hash + a human filename. Deduped and export-safe. |
| 3.8 | Entities in milestone 1? | ASSUMED | Account, Site, Page, Block, Theme, Asset, Collection (blog posts), Submission (form/event), Booking, Publish. |

## 4. State and storage

| # | Question | Status | Answer |
|---|---|---|---|
| 4.1 | Can the user see and diff their site's state? | ASSUMED | Yes — that is the product. Every save produces a diffable change; `prefab diff` prints it. |
| 4.2 | Multi-tenancy isolation model? | ASSUMED | Shared Postgres with row-level security keyed on `site_id`, plus per-tenant prefixes in object storage. DB-per-tenant is operationally heavy at freelancer price points (ADR-0008). |
| 4.3 | Where do visitor-submitted records (form entries, bookings) live? | ASSUMED | Platform Postgres, exportable as CSV/JSON. They are *not* in the site source tree — mixing visitor PII into an exportable repo is a data-protection trap. |
| 4.4 | Retention of drafts / version history? | ASSUMED | Full history for the life of the subscription; 30 days after cancellation, then export-or-lose with warnings. |

## 5. Concurrency and conflict

| # | Question | Status | Answer |
|---|---|---|---|
| 5.1 | Real-time multiplayer editing in v1? | ASSUMED | No. CRDTs are a large bet for a solo-freelancer product. But the document shape (flat, ULID-keyed, no positional refs) is chosen so Yjs can be added later without a format migration. |
| 5.2 | Two writers, one an agent — mechanism? | ASSUMED | Every write carries the base version; server rejects on mismatch with the current state and a machine-readable diff so an agent can retry. Losing writes are never silent (ADR-0006). |
| 5.3 | Editor open in two tabs? | ASSUMED | Same mechanism; second tab gets a "this page moved on" banner with reload/overwrite. |
| 5.4 | Does publishing block editing? | ASSUMED | No. Publish snapshots the current version; edits after that go into the next publish. |

## 6. Interfaces and contracts

| # | Question | Status | Answer |
|---|---|---|---|
| 6.1 | What surfaces exist? | ASSUMED | Web editor, `prefab` CLI, MCP server, HTTP API. Four surfaces, one write path (ADR-0003). |
| 6.2 | Do all surfaces share one write path? | ASSUMED | Yes, non-negotiable. UI and CLI are clients of the same HTTP API; MCP is a thin adapter over the CLI's command layer. Any mutation not expressible in the API does not exist. |
| 6.3 | Is CLI/MCP output machine-readable? | ASSUMED | `--json` on every command, meaningful exit codes (0 ok, 1 user error, 2 conflict, 3 auth, 4 upstream), errors on stderr as JSON with a stable `code`. |
| 6.4 | Is there a cheap read projection for agents? | ASSUMED | Yes. `prefab site outline` returns the whole site as a compact tree (page → block ids, types, one-line summaries) so an agent orients in one call instead of reading every page. This is a first-class deliverable, not a convenience. |
| 6.5 | Local MCP (stdio, local working copy) or remote MCP (hosted site)? | ASSUMED | Both, same command layer. Local stdio server for a checked-out site; remote OAuth'd MCP for the hosted one. |
| 6.6 | How does an agent preview its work? | ASSUMED | Every draft has a stable preview URL, and `prefab preview --json` returns it plus a rendered screenshot path. Agents that cannot see output produce ugly sites. |
| 6.7 | Public API for third parties in v1? | DEFERRED | Same API, but no published stability guarantee until after milestone 1. |
| 6.8 | Webhooks? | ASSUMED | Yes for Submission and Booking created — cheapest possible integration story and it costs a day. |

## 7. Failure behaviour

| # | Question | Status | Answer |
|---|---|---|---|
| 7.1 | Bad input to a write? | ASSUMED | Hard reject with schema-validation errors naming the block id and field path. No partial application of a patch. |
| 7.2 | Publish fails halfway? | ASSUMED | Atomic. Build to an immutable, content-addressed bundle, then swap a pointer. A failed publish leaves the live site untouched. |
| 7.3 | Rollback? | ASSUMED | One command / one click to repoint at any previous publish. Instant because bundles are immutable. |
| 7.4 | Stripe / calendar provider unavailable? | ASSUMED | The page still renders; the interactive widget degrades to an explicit error state, and the failure is surfaced in the owner's dashboard. Never a blank page. |
| 7.5 | A block type in the document is unknown to the renderer? | ASSUMED | Render a visible placeholder in the editor, skip it on the published page, and never drop it from the document. Forward-compatibility matters once export exists. |

## 8. External dependencies

| # | Question | Status | Answer |
|---|---|---|---|
| 8.1 | Editor engine? | FORK-4 | See below |
| 8.2 | Scheduling engine — embed Cal.com? | ASSUMED | **No.** Cal.com is AGPLv3; self-hosting it inside a commercial multi-tenant SaaS puts the network-copyleft obligation over our service, and the commercial licence reintroduces exactly the vendor dependency we are selling against. Build a small booking core (availability rules → slots → ICS) and sync to Google/Microsoft calendars via their APIs (ADR-0009). |
| 8.3 | Payments provider? | FORK-5 | See below |
| 8.4 | Hosting/runtime platform? | ASSUMED | Cloudflare: Workers for Platforms (isolated per-tenant compute), SSL for SaaS (automated certs for thousands of customer domains), R2 (zero egress fees on asset-heavy sites), D1/Postgres. The custom-domain-at-scale problem is the one that is genuinely hard elsewhere (ADR-0007). |
| 8.5 | Transactional email? | ASSUMED | Resend or Postmark behind a one-interface adapter. Swappable, low switching cost, not worth a fork. |
| 8.6 | Framework for the published site? | ASSUMED | Astro (MIT) for the static shell + React islands for interactive blocks. Astro's zero-JS-by-default is what makes the performance number achievable, and the eject story is a real Astro project. |
| 8.7 | Language/stack? | ASSUMED | TypeScript end-to-end, pnpm monorepo. The renderer must be JS (React blocks), and one language means one shared schema package. *Note: the repo's `.gitignore` is Python-flavoured — flagging in case a Python backend was assumed.* |
| 8.8 | Database? | ASSUMED | Postgres (Neon or Cloudflare Hyperdrive-fronted). RLS, JSONB for documents, boring and portable. |
| 8.9 | Licence for our own open-source runtime? | ASSUMED | Apache-2.0, matching the repo. Permissive is the point — a copyleft self-host runtime would undercut the no-lock-in promise. |
| 8.10 | Does anything need to run offline? | ASSUMED | The CLI must work against a local checkout with no network (edit, build, preview). Publishing obviously needs network. |

## 9. Runtime and deployment

| # | Question | Status | Answer |
|---|---|---|---|
| 9.1 | Rendering model for published sites? | FORK-6 | See below |
| 9.2 | What crosses the tenant boundary? | ASSUMED | Nothing tenant-authored executes on a shared origin. Published sites are served from per-site hostnames; any embedded third-party HTML is iframe-sandboxed. |
| 9.3 | How are custom domains onboarded? | ASSUMED | CNAME + Cloudflare SSL for SaaS, with a verification poll and a plain-English DNS guide per common registrar. |
| 9.4 | Preview environments? | ASSUMED | Every draft gets `<site>-<hash>.preview.prefab.app`, no auth by default but unguessable, with an option to password-protect. |
| 9.5 | Can a customer self-host the whole platform? | ASSUMED | Not the platform — the *site runtime* (see FORK-7). Open-sourcing the control plane is not milestone 1. |

## 10. Measurable success

| # | Question | Status | Answer |
|---|---|---|---|
| 10.1 | Editor responsiveness? | ASSUMED | Block drag/drop feedback under 100 ms p95; save round-trip under 400 ms p95. |
| 10.2 | Published page performance? | ASSUMED | LCP < 1.5 s p75 on simulated 4G for a template-derived page; Lighthouse performance ≥ 90 out of the box. |
| 10.3 | Publish speed? | ASSUMED | Under 10 s for a 50-page site, p95. |
| 10.4 | Time-to-live-site for a new user? | ASSUMED | Template → published on a `.prefab.app` subdomain in under 10 minutes, measured on five unassisted test users. |
| 10.5 | Agent parity — how is it checked? | ASSUMED | A conformance suite: every mutation in the API has a CLI command and an MCP tool, asserted in CI. Parity is a test, not an aspiration. |
| 10.6 | Export fidelity? | ASSUMED | Exported site renders pixel-identical to the hosted one for all first-party blocks (screenshot diff, ≤ 0.1% pixel delta), and re-import round-trips byte-identically. |
| 10.7 | Accessibility? | ASSUMED | Every first-party block passes axe-core with zero criticals; templates ship WCAG 2.2 AA contrast. |

## 11. Security and secrets

| # | Question | Status | Answer |
|---|---|---|---|
| 11.1 | What is never logged or committed? | ASSUMED | Tenant OAuth tokens, Stripe secrets, visitor PII from submissions. Site source trees are assumed to be shareable and therefore contain no secrets — connection config lives in the platform, referenced by id. |
| 11.2 | How are tenant credentials stored? | ASSUMED | Envelope encryption with a KMS-held key; per-tenant data keys; decrypt at point of use only. |
| 11.3 | Can users inject custom JS? | ASSUMED | Not on the site's own origin in milestone 1. A raw-HTML block renders inside a sandboxed iframe. Arbitrary first-party JS is the single biggest XSS/tenant-escape risk in this product class. |
| 11.4 | Are agent writes trusted? | ASSUMED | No differently from human writes — same validation, same authz. MCP tokens are per-site, scoped, revocable, and expire. |
| 11.5 | Form spam / abuse? | ASSUMED | Turnstile on public forms, rate limits per IP and per site. |
| 11.6 | Data protection regime? | ASSUMED | Singapore PDPA + GDPR posture: submission data exportable and deletable per record, documented retention, data residency deferred but the storage layer is region-tagged from day one. |
| 11.7 | Phishing / abuse of hosted sites? | DEFERRED | Real risk for any site host. Milestone 1: manual takedown path + newly-published-site heuristics. Not automated. |

## 12. Versioning and migration

| # | Question | Status | Answer |
|---|---|---|---|
| 12.1 | Will the document schema change shape? | ASSUMED | Certainly. Every document carries `schemaVersion`; migrations are forward-only functions run on read and persisted on next write. |
| 12.2 | Block-level versioning? | ASSUMED | Each block type has its own version; a block migration ships with the block. This is what lets us change a block without a site-wide migration. |
| 12.3 | How does an old export re-import? | ASSUMED | Through the same migration chain. Supported for two major versions back, stated in the export manifest. |
| 12.4 | API versioning? | ASSUMED | `/v1` path prefix, additive-only within a major. |

## 13. Templates, blocks and theming (domain)

| # | Question | Status | Answer |
|---|---|---|---|
| 13.1 | Is the block library open to third parties? | FORK-8 | See below |
| 13.2 | Do template updates propagate to sites using them? | ASSUMED | No. A template is a seed — fork-on-use. The *theme* (tokens) is separately swappable, so a site can be restyled without re-templating. Propagating structural updates into edited sites is a known unsolvable-in-practice problem. |
| 13.3 | How many templates at launch? | ASSUMED | Eight, covering the target verticals (consultant, photographer, tutor, café, fitness coach, small agency, event, personal brand). Fewer than that and the "pretty by default" promise fails. |
| 13.4 | Who authors templates? | ASSUMED | Us, in-house, as ordinary site source trees — dogfooding the export format. A template is just an exported site. |
| 13.5 | Responsive behaviour — how is it authored? | ASSUMED | Automatic per-block responsive rules with an optional per-breakpoint override at three breakpoints. Not free-form absolute positioning — that is how no-code builders produce broken mobile layouts. |

## 14. Business model (domain)

| # | Question | Status | Answer |
|---|---|---|---|
| 14.1 | Pricing shape? | FORK-9 | See below |
| 14.2 | Free tier? | ASSUMED | Yes, on a `*.prefab.app` subdomain with a small badge. Custom domain is the first paid gate — that is where intent is. |
| 14.3 | Is export a paid feature? | ASSUMED | **No, ever, on any tier.** Charging for export makes the anti-lock-in promise a bluff and the promise is the product. |
| 14.4 | Metering needed in milestone 1? | ASSUMED | Subscription state and plan gates only. Usage metering (bandwidth, submissions) deferred. |

---

## Round 1 forks — resolved

All nine escalated. User accepted eight recommendations; FORK-4 was reopened.

| Fork | Question | Outcome | ADR |
|---|---|---|---|
| FORK-1 | Beachhead user | **Non-technical business owner**, with agent parity from day one | ADR-0001 |
| FORK-2 | Milestone-1 scope | **Pages + blog + forms, then scheduling.** Payments and events to milestone 2 | ADR-0001 |
| FORK-3 | Source of truth | **Database of record, file tree as a first-class bidirectional projection** (`pull`/`push`, Terraform-like, not git-like) | ADR-0002 |
| FORK-4 | Editor engine | **Reopened — see round 2** | ADR-0004 |
| FORK-5 | Payments | **BYO Stripe via OAuth, zero platform fee.** Money never touches us | ADR-0005 |
| FORK-6 | Rendering model | **Static-first pre-render with islands**, dynamic bits via a small runtime API | ADR-0007 |
| FORK-7 | Lock-in promise | **All three tiers**: static bundle, Apache-2.0 self-host runtime, eject to Astro. Runtime is separable from commit one | ADR-0010 |
| FORK-8 | Block library | **First-party only in milestone 1.** Block contract public but explicitly unstable | ADR-0011 |
| FORK-9 | Pricing | **Flat tiers, no transaction fee, BYO domain, free tier on subdomain.** Export free on every tier | ADR-0012 |

---

## Round 2 forks — open

Smaller round, as required. Both stem from FORK-4 being reopened with a
proposal of Svelte + Vite + FastAPI.

### Research findings that decide most of it

| Fact | Source | Consequence |
|---|---|---|
| Svaro (Svelte, Puck-inspired) is 23 stars, marked WIP | github.com/dotnize/svaro | No Svelte equivalent to Puck exists |
| svelte-visual-builder is 30 stars, MIT, properly packaged | github.com/BluePointDigital/svelte-visual-builder | Closest Svelte option; still not a Puck |
| Puck is 13.2k stars, 2,104 commits, MIT, JSON-tree data model | github.com/puckeditor/puck | Matches ADR-0002's document model closely |
| Svelte island ~1-10 KB runtime vs React ~45 KB gz | Astro islands benchmarks | Real, but static blocks ship 0 KB either way under ADR-0007 |
| Python Workers is open beta; ~1 s cold start with snapshots, requirements.txt deploy still landing | blog.cloudflare.com/python-workers-advancements | FastAPI cannot host the control plane on the platform chosen in ADR-0007 |
| Publishing requires rendering Astro + block components | — | Node is in production regardless of backend language |

### FORK-4 (reopened) — block framework and editor canvas

The decision splits into three, of which only the first is high-stakes:

- **(a) Block framework** — hard to reverse. It is the eject target (ADR-0010),
  the third-party contract (ADR-0011), and the WYSIWYG guarantee.
- **(b) Editor chrome framework** — trivially reversible, purely internal.
- **(c) Backend language** — separate axis, see FORK-10.

Scoring (a): React wins editor build cost (6-10 weeks), eject value, third-party
supply, agent-authored block quality, and hiring. Svelte wins island bundle size
(~40 KB gz delta, only on pages with an interactive block, ~0.1-0.2 s on 4G) and
authoring ergonomics. React wins the irreversible criteria.

Rejected: framework-agnostic blocks via Web Components. Declarative shadow DOM
SSR is immature, shadow-boundary styling fights the `theme.json` token system,
form participation is fiddly, and the canvas still has to be built.

Mitigation applied either way: the framework stays out of the data. The document
format is framework-agnostic JSON, so the framework is a replaceable rendering
layer and a switch costs a renderer rewrite, not a data migration.

Recommendation: **React blocks + Puck, behind our own schema.**
Legitimate override: solo-founder velocity in Svelte. Pre-PMF, a shipped Svelte
product beats an unshipped React one.

### FORK-10 (new) — backend language

Recommendation: **TypeScript end-to-end for the core write path** (API, schema,
renderer, CLI, MCP). The schema is the product's core asset and lives in both the
API and the renderer; two languages means defining it twice and drifting. OpenAPI
codegen fixes API types but not block schemas or migration functions.

Python reserved for analytics/data jobs and AI/ML services — a clean seam at a
process boundary.

Fair alternative: FastAPI control plane on Fly/Cloud Run + Node render service,
Cloudflare demoted to CDN + SSL for SaaS + R2. Costs a permanent
schema-duplication tax and a cross-process hop on the publish path.
