-- 問答 (meeting-qa): one embedding per transcript segment or minutes item, per embedding model. Rows of another model
-- are removed by the indexer; deleting a segment, meeting or item deletes its embedding.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE passage_vectors (
    id           bigserial PRIMARY KEY,
    meeting_id   uuid,
    seq          integer,
    item_id      bigint REFERENCES minute_items (id) ON DELETE CASCADE,
    model        text NOT NULL,
    content_hash text NOT NULL,                -- md5 of the embedded text; a different hash means it must be recomputed
    embedding    vector NOT NULL,              -- no fixed dimension: changing the model needs no schema change
    embedded_at  timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (meeting_id, seq) REFERENCES segments (meeting_id, seq) ON DELETE CASCADE,
    CHECK ((item_id IS NULL AND meeting_id IS NOT NULL AND seq IS NOT NULL) OR (item_id IS NOT NULL AND meeting_id IS NULL AND seq IS NULL))
);
CREATE UNIQUE INDEX passage_vectors_segment ON passage_vectors (meeting_id, seq, model) WHERE item_id IS NULL;
CREATE UNIQUE INDEX passage_vectors_item ON passage_vectors (item_id, model) WHERE item_id IS NOT NULL;
