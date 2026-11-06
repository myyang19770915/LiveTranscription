-- Meeting series and in-meeting progress suggestions (meeting-series).
CREATE TABLE meeting_series (
    id         bigserial PRIMARY KEY,
    team_id    bigint NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
    name       text NOT NULL,
    name_key   text NOT NULL,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (team_id, name_key)
);

ALTER TABLE meetings ADD COLUMN series_id bigint REFERENCES meeting_series (id) ON DELETE SET NULL;
CREATE INDEX meetings_series ON meetings (series_id, started_at);

-- One suggestion per meeting, item and status: a dismissed one is not suggested again in that meeting.
CREATE TABLE progress_suggestions (
    id         bigserial PRIMARY KEY,
    meeting_id uuid NOT NULL REFERENCES meetings (id) ON DELETE CASCADE,
    item_id    bigint NOT NULL REFERENCES minute_items (id) ON DELETE CASCADE,
    to_status  text NOT NULL CHECK (to_status IN ('doing', 'done', 'cancelled')),
    note       text NOT NULL DEFAULT '',
    evidence   integer[] NOT NULL DEFAULT '{}',
    state      text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'accepted', 'dismissed')),
    created_at timestamptz NOT NULL DEFAULT now(),
    decided_by text,
    decided_at timestamptz,
    UNIQUE (meeting_id, item_id, to_status)
);
