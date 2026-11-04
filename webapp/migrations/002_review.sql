-- Recording timeline, stored segments and review history (meeting-review).
ALTER TABLE meetings
    ADD COLUMN source_language text NOT NULL DEFAULT '',
    ADD COLUMN target_language text NOT NULL DEFAULT '',
    ADD COLUMN glossary        text NOT NULL DEFAULT '',
    ADD COLUMN learned_terms   text NOT NULL DEFAULT '',
    ADD COLUMN audio_bytes     bigint NOT NULL DEFAULT 0,
    ADD COLUMN ended_at        timestamptz;

-- asr_text and live_target are written once, when the segment is first stored, and never change.
CREATE TABLE segments (
    meeting_id  uuid NOT NULL REFERENCES meetings (id) ON DELETE CASCADE,
    seq         integer NOT NULL CHECK (seq > 0),
    start_ms    integer NOT NULL CHECK (start_ms >= 0),
    end_ms      integer NOT NULL CHECK (end_ms >= start_ms),
    asr_text    text NOT NULL,
    source      text NOT NULL,
    live_target text NOT NULL,
    target      text NOT NULL,
    detected    text NOT NULL DEFAULT '',
    state       text NOT NULL DEFAULT 'unreviewed' CHECK (state IN ('unreviewed', 'confirmed', 'edited')),
    version     integer NOT NULL DEFAULT 1,
    PRIMARY KEY (meeting_id, seq)
);

-- Append-only: the app never updates or deletes a history entry.
CREATE TABLE segment_history (
    id            bigserial PRIMARY KEY,
    meeting_id    uuid NOT NULL,
    seq           integer NOT NULL,
    kind          text NOT NULL CHECK (kind IN ('edit', 'retranslate', 'confirm')),
    username      text NOT NULL,
    at            timestamptz NOT NULL DEFAULT now(),
    source_before text NOT NULL,
    source_after  text NOT NULL,
    target_before text NOT NULL,
    target_after  text NOT NULL,
    refine        boolean NOT NULL DEFAULT false,
    FOREIGN KEY (meeting_id, seq) REFERENCES segments (meeting_id, seq) ON DELETE CASCADE
);
CREATE INDEX segment_history_segment ON segment_history (meeting_id, seq, id);
