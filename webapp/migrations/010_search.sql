-- Full-text search (meeting-search): trigram indexes make ILIKE '%term%' fast for any language, Chinese and Japanese
-- included (Postgres' tsvector splits on spaces). pg_trgm ships with the official image and is a trusted extension.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX segments_source_trgm ON segments USING gin (source gin_trgm_ops);
CREATE INDEX segments_target_trgm ON segments USING gin (target gin_trgm_ops);
CREATE INDEX minute_items_content_trgm ON minute_items USING gin (content gin_trgm_ops);
CREATE INDEX meetings_title_trgm ON meetings USING gin (title gin_trgm_ops);
