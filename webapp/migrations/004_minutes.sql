-- Meeting minutes: summary, generation state, and proposed/confirmed items (meeting-minutes).
CREATE TABLE minutes (
    meeting_id      uuid PRIMARY KEY REFERENCES meetings (id) ON DELETE CASCADE,
    summary         text NOT NULL DEFAULT '',
    summary_edited  boolean NOT NULL DEFAULT false,
    summary_version integer NOT NULL DEFAULT 1,
    status          text NOT NULL DEFAULT 'idle' CHECK (status IN ('idle', 'running', 'done', 'failed')),
    model           text NOT NULL DEFAULT '',
    message         text NOT NULL DEFAULT '',
    dropped         integer NOT NULL DEFAULT 0,
    started_by      text,
    started_at      timestamptz,
    finished_at     timestamptz
);

-- status and external_ref are for follow-up (roadmap P3) and the issue tracker; this change only stores them.
CREATE TABLE minute_items (
    id           bigserial PRIMARY KEY,
    meeting_id   uuid NOT NULL REFERENCES meetings (id) ON DELETE CASCADE,
    kind         text NOT NULL CHECK (kind IN ('decision', 'action', 'question', 'risk')),
    content      text NOT NULL,
    owner        text,
    owner_hint   text NOT NULL DEFAULT '',
    due_date     date,
    due_text     text NOT NULL DEFAULT '',
    evidence     integer[] NOT NULL DEFAULT '{}',
    origin       text NOT NULL CHECK (origin IN ('ai', 'manual')),
    state        text NOT NULL DEFAULT 'proposed' CHECK (state IN ('proposed', 'confirmed', 'rejected')),
    status       text NOT NULL DEFAULT 'open',
    external_ref text NOT NULL DEFAULT '',
    version      integer NOT NULL DEFAULT 1,
    updated_by   text,
    updated_at   timestamptz NOT NULL DEFAULT now(),
    confirmed_by text,
    confirmed_at timestamptz
);
CREATE INDEX minute_items_meeting ON minute_items (meeting_id, kind, id);
