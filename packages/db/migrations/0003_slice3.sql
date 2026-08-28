-- Slice 3: real signup with email verification, on top of slice 1's minimal
-- identity primitive (accounts/sessions) — dev/login is untouched and keeps
-- working for local dev, tests and CI (SLICES.md: "built on slice 1's
-- identity primitive rather than replacing it").

ALTER TABLE accounts
  ADD COLUMN email_verified_at timestamptz,
  ADD COLUMN verification_code_hash text,
  ADD COLUMN verification_code_expires_at timestamptz;
