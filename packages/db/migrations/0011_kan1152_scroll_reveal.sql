-- KAN-1152 / ADR-0015: scroll-triggered reveal, a per-block opt-in for the
-- published site. Same shape of change as 0010_kan1129_free_positioning.sql's
-- `blocks.position` column: one new nullable column, no default that
-- rewrites any existing row's meaning, so every existing block keeps
-- rendering exactly as before with zero data change.
--
-- Nullable boolean, not `NOT NULL DEFAULT false`: @prefab/schema's
-- `BlockNodeSchema.scrollReveal` is `.optional()` (not `.default(false)`,
-- unlike `responsive` — see ADR-0015 for why), so this column mirrors that
-- exactly rather than inventing a concrete value the schema layer itself
-- doesn't.

ALTER TABLE blocks ADD COLUMN scroll_reveal boolean;
