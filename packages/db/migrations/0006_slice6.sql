-- Slice 6: forms and submissions — the first dynamic runtime (ADR-0007,
-- ADR-0010). A Form block's field definitions live in the page document
-- like any other block's props (portable, no secrets, no PII); this
-- migration adds only what the *runtime* needs and what must never live in
-- the site source tree (R20): a publicly-readable field manifest snapshot
-- to validate submissions against, private notification/webhook settings,
-- the submissions themselves, and webhook delivery/retry bookkeeping.
--
-- `forms` and `form_settings` are deliberately split rather than one table.
-- The runtime's public submit endpoint has no authenticated tenant context
-- (a visitor is not a signed-in owner) and must still resolve a formId to
-- its field manifest — so `forms` carries only publish-safe columns and
-- gets an unconditional public read policy. `notify_email`,
-- `webhook_url` and `webhook_secret` are credential-shaped (R20: "no
-- secrets... in a site source tree... referenced by id" — the platform
-- equivalent is "never in a table any unauthenticated request can read"),
-- so they live in `form_settings`, which carries no public policy at all.

CREATE TABLE forms (
  id ulid PRIMARY KEY,
  site_id ulid NOT NULL REFERENCES sites (id) ON DELETE CASCADE,
  -- A snapshot of the Form block's own props, written by the publish
  -- pipeline every time the site publishes (mirrors how posts are
  -- filtered to "published" at publish time — the runtime never reads
  -- pages/blocks directly, only this materialised, publish-safe manifest).
  heading text NOT NULL DEFAULT '',
  fields jsonb NOT NULL DEFAULT '[]',
  submit_label text NOT NULL DEFAULT 'Submit',
  turnstile_enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX forms_site_id_idx ON forms (site_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON forms TO prefab_app;

ALTER TABLE forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE forms FORCE ROW LEVEL SECURITY;

CREATE POLICY forms_tenant_isolation ON forms
  USING (site_id = current_setting('app.site_id', true));

-- The runtime submit endpoint resolves a formId with no site context at
-- all (same reasoning as custom_domains_public_active_read /
-- sites_public_slug_read) — safe because every column on this table is
-- already publish-safe by construction.
CREATE POLICY forms_public_read ON forms
  FOR SELECT USING (true);

CREATE TABLE form_settings (
  form_id ulid PRIMARY KEY REFERENCES forms (id) ON DELETE CASCADE,
  site_id ulid NOT NULL REFERENCES sites (id) ON DELETE CASCADE,
  notify_email text,
  webhook_url text,
  webhook_secret text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX form_settings_site_id_idx ON form_settings (site_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON form_settings TO prefab_app;

ALTER TABLE form_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE form_settings FORCE ROW LEVEL SECURITY;

-- No public policy: this is exactly the row a visitor's unauthenticated
-- submit request must never be able to read.
CREATE POLICY form_settings_tenant_isolation ON form_settings
  USING (site_id = current_setting('app.site_id', true));

CREATE TABLE submissions (
  id ulid PRIMARY KEY,
  site_id ulid NOT NULL REFERENCES sites (id) ON DELETE CASCADE,
  form_id ulid NOT NULL REFERENCES forms (id) ON DELETE CASCADE,
  values jsonb NOT NULL,
  ip text,
  -- R7.4 behaviour: "a form on a page with the email provider unavailable
  -- still stores the submission and surfaces the failure in the
  -- dashboard" — the submission write itself never depends on the
  -- notification succeeding, so its outcome is recorded here instead of
  -- being allowed to roll back or block anything.
  notify_status text NOT NULL DEFAULT 'skipped' CHECK (notify_status IN ('skipped', 'sent', 'failed')),
  notify_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX submissions_site_id_form_id_created_at_idx ON submissions (site_id, form_id, created_at DESC, id);

GRANT SELECT, INSERT, UPDATE, DELETE ON submissions TO prefab_app;

ALTER TABLE submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE submissions FORCE ROW LEVEL SECURITY;

-- Written by the runtime submit endpoint with app.site_id set explicitly
-- to the siteId it already resolved from the public `forms` read above
-- (never from visitor input) — the same "server resolves, then scopes"
-- pattern app.ts's host-based public routing already uses. No public
-- policy: submission contents are visitor PII and are readable only by
-- the owning tenant (R20).
CREATE POLICY submissions_tenant_isolation ON submissions
  USING (site_id = current_setting('app.site_id', true));

CREATE TABLE webhook_deliveries (
  id ulid PRIMARY KEY,
  site_id ulid NOT NULL REFERENCES sites (id) ON DELETE CASCADE,
  submission_id ulid NOT NULL REFERENCES submissions (id) ON DELETE CASCADE,
  url text NOT NULL,
  -- Snapshotted from form_settings at enqueue time, same reasoning as
  -- `url`/`payload` — a retry must sign with the secret that was current
  -- when the delivery was created, and this table already carries no
  -- public read policy (same protection form_settings' own secret gets).
  secret text,
  payload jsonb NOT NULL,
  attempt integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'failed')),
  last_error text,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz
);

CREATE INDEX webhook_deliveries_status_next_attempt_idx ON webhook_deliveries (status, next_attempt_at);
CREATE INDEX webhook_deliveries_site_id_idx ON webhook_deliveries (site_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON webhook_deliveries TO prefab_app;

ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_deliveries FORCE ROW LEVEL SECURITY;

CREATE POLICY webhook_deliveries_tenant_isolation ON webhook_deliveries
  USING (site_id = current_setting('app.site_id', true));
