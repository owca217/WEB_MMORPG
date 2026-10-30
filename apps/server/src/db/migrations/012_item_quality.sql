CREATE TYPE item_quality AS ENUM ('BASIC', 'NORMAL', 'GOOD', 'EXCELLENT', 'PERFECT', 'MASTERWORK');

-- The definition supplies future grants; existing owned copies retain their own quality.
ALTER TABLE item_versions ADD COLUMN quality item_quality NOT NULL DEFAULT 'NORMAL';
ALTER TABLE item_instances ADD COLUMN quality item_quality NOT NULL DEFAULT 'NORMAL';
