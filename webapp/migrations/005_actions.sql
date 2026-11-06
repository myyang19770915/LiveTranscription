-- Action tracking: the status of confirmed action items and the history of every change (action-tracking).
UPDATE minute_items SET status = 'todo' WHERE status = 'open';
ALTER TABLE minute_items
    ALTER COLUMN status SET DEFAULT 'todo',
    ADD CONSTRAINT minute_items_status CHECK (status IN ('todo', 'doing', 'done', 'cancelled')),
    ADD COLUMN status_note text NOT NULL DEFAULT '',
    ADD COLUMN status_by   text,
    ADD COLUMN status_at   timestamptz;
CREATE INDEX minute_items_board ON minute_items (kind, state, status);

-- meeting_id and evidence: where a progress update was heard (meeting-series); NULL / empty when set by hand.
CREATE TABLE item_updates (
    id          bigserial PRIMARY KEY,
    item_id     bigint NOT NULL REFERENCES minute_items (id) ON DELETE CASCADE,
    from_status text NOT NULL,
    to_status   text NOT NULL,
    note        text NOT NULL DEFAULT '',
    meeting_id  uuid REFERENCES meetings (id) ON DELETE SET NULL,
    evidence    integer[] NOT NULL DEFAULT '{}',
    changed_by  text NOT NULL,
    changed_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX item_updates_item ON item_updates (item_id, id);
