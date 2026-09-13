import { useState } from "react";
import { ApiClientError, type PageDocument, type PageSummary } from "@prefab/api-client";
import { dedupeSlug, slugify } from "@prefab/schema";
import { api } from "./api.js";
import { Card, FilledButton, SideSheet, StatusBadge, TextField } from "./ui/index.js";

/**
 * KAN-1263: `page.create`/`page.list`/`page.get` have had full three-surface
 * parity (ADR-0003) since Slice 1 — the CLI and MCP could always create and
 * list a site's second page, only the no-code editor couldn't reach one.
 * That blocked the blog and product-catalogue architectures from working
 * end-to-end through this UI: both need a list page and a separate detail
 * page (packages/blocks/src/postdetail/schema.ts), and there was previously
 * no way to create or switch to that second page anywhere in this app.
 *
 * Deliberately the same "toolbar button opens a SideSheet" shape as
 * DomainsPanel/BlogPanel — a list to switch pages plus a one-field form to
 * add another, no new mutation behind it (page.create already does the
 * work). The slug is auto-derived from the title (@prefab/schema's
 * `slugify`/`dedupeSlug`, the same helper post.create's server-side
 * auto-slug uses) rather than asking a non-technical owner to type a URL
 * slug by hand — `api.createPage` still requires a non-empty slug
 * (CreatePageBodySchema), it's just never typed here.
 */
export function PagesPanel({
  siteId,
  pages,
  currentPageId,
  onSelect,
  onCreated,
  onClose,
}: {
  siteId: string;
  pages: PageSummary[];
  /** Null only in the moment right after this site's very first page is being created below. */
  currentPageId: string | null;
  /** Fetches and swaps the canvas to an existing page — thrown errors are shown inline here, not surfaced as a whole-screen error (SiteEditor keeps editing the current page if this fails). */
  onSelect: (pageId: string) => Promise<void>;
  /** Called once `page.create` succeeds — SiteEditor owns adding it to `pages` and switching the canvas to it. */
  onCreated: (page: PageDocument) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function describeError(err: unknown): string {
    // KAN-1272 (parallel fix, same or another agent): a duplicate slug on
    // POST /v1/sites/:siteId/pages is meant to become a clean 409 —
    // handled here either way, since this panel derives the slug itself
    // and a collision (two pages titled the same thing) is still possible.
    if (err instanceof ApiClientError && err.code === "conflict") {
      return "That page URL is already taken — try a different title.";
    }
    return err instanceof Error ? err.message : String(err);
  }

  async function select(pageId: string) {
    if (pageId === currentPageId) {
      onClose();
      return;
    }
    setSwitchingTo(pageId);
    setError(null);
    try {
      await onSelect(pageId);
      onClose();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSwitchingTo(null);
    }
  }

  async function submitCreate(event: React.FormEvent) {
    event.preventDefault();
    setCreating(true);
    setError(null);
    try {
      const slug = dedupeSlug(slugify(title), pages.map((p) => p.slug));
      const created = await api.createPage(siteId, { slug, title });
      onCreated(created);
      onClose();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setCreating(false);
    }
  }

  return (
    <SideSheet title="Pages" ariaLabel="Site pages" closeLabel="Close pages panel" onClose={onClose} width={400}>
      {pages.length === 0 ? (
        <p className="pf-supporting-text">This site has no pages yet — add the first one below.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "0.4rem" }}>
          {pages.map((p) => (
            <li key={p.id}>
              <Card
                interactive
                variant={p.id === currentPageId ? "filled" : "outlined"}
                onClick={() => select(p.id)}
                style={{ padding: "0.6rem", display: "flex", alignItems: "center", gap: "0.5rem" }}
              >
                <div style={{ flex: 1, display: "grid", gap: "0.1rem" }}>
                  <strong>{p.title}</strong>
                  <span className="pf-supporting-text" style={{ margin: 0 }}>
                    /{p.slug}
                  </span>
                </div>
                {p.id === currentPageId ? <StatusBadge tone="positive">Current</StatusBadge> : null}
                {switchingTo === p.id ? <span className="pf-supporting-text">Loading…</span> : null}
              </Card>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={submitCreate} style={{ display: "grid", gap: "0.5rem" }}>
        <h3 className="pf-subsection-title">Add a page</h3>
        <TextField
          label="Page title"
          value={title}
          onChange={setTitle}
          placeholder="e.g. About us"
          required
          supportingText="Its web address is generated from this title."
        />
        <FilledButton type="submit" disabled={creating || title.trim() === ""}>
          {creating ? "Adding…" : "+ Add page"}
        </FilledButton>
        {error ? <p className="pf-error-text">{error}</p> : null}
      </form>
    </SideSheet>
  );
}
