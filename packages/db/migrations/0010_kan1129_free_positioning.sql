-- KAN-1129 / ADR-0014: free-positioning layout, scoped to the page canvas.
-- Same shape of change as 0002_slice2.sql's `blocks.responsive` column: one
-- new column per envelope level, nullable/defaulted so every existing row
-- keeps its current meaning with zero data change.
--
-- `layout_mode` defaults every existing page to 'flow' — the forward
-- migration this ADR asks for at the storage layer (the JS-level forward
-- migration for documents that reach @prefab/schema without ever touching
-- this column, e.g. a pre-migration export file, is
-- `migrateLegacyPageDocument` in packages/schema/src/document.ts).
--
-- `position` is nullable jsonb on `blocks`, populated only for root-level
-- blocks on a 'free' page. Enforced by @prefab/schema's
-- `validatePageDocument` (required iff layout_mode = 'free' AND parent IS
-- NULL, rejected otherwise), not by a database constraint — the same
-- division of labour `props` and `responsive` already have: this table
-- stores whatever @prefab/schema already validated, it doesn't re-derive
-- the rule itself.

ALTER TABLE pages ADD COLUMN layout_mode text NOT NULL DEFAULT 'flow' CHECK (layout_mode IN ('flow', 'free'));

ALTER TABLE blocks ADD COLUMN position jsonb;
