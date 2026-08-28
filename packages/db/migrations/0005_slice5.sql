-- Slice 5: blog and collections — layout/content separation. Posts live in
-- their own table rather than as page blocks, with the same optimistic-
-- concurrency version every other mutation gets (ADR-0006).

CREATE TABLE posts (
  id ulid PRIMARY KEY,
  site_id ulid NOT NULL REFERENCES sites (id) ON DELETE CASCADE,
  slug text NOT NULL,
  title text NOT NULL,
  schema_version integer NOT NULL DEFAULT 1,
  version integer NOT NULL DEFAULT 0,
  -- Both the displayed date and the scheduling gate: a post is publicly
  -- reachable only once status = 'published' AND date <= today (see
  -- @prefab/schema's isPostVisible) — no separate "scheduled" state to
  -- keep in sync with this one.
  date date NOT NULL,
  author text NOT NULL DEFAULT '',
  tags jsonb NOT NULL DEFAULT '[]',
  cover text,
  body text NOT NULL DEFAULT '',
  -- Unused in milestone 1 but present from day one (PLAN.md) so
  -- multilingual is not a migration later.
  locale text NOT NULL DEFAULT 'en',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, slug)
);

CREATE INDEX posts_site_id_status_date_idx ON posts (site_id, status, date DESC, id);

GRANT SELECT, INSERT, UPDATE, DELETE ON posts TO prefab_app;

ALTER TABLE posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE posts FORCE ROW LEVEL SECURITY;

-- Same tenant-context mechanism as every other table (ADR-0008) — the
-- publish pipeline reads posts inside withTenantContext(pool, { siteId })
-- exactly like it reads pages, so there is no need for a public,
-- context-free read policy the way sites/publishes have one: a published
-- bundle serves static files, never a live query.
CREATE POLICY posts_tenant_isolation ON posts
  USING (site_id = current_setting('app.site_id', true));
