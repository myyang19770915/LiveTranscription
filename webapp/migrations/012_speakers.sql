-- Speaker diarization (speaker-diarization): one diarization per meeting (its status and the model's speaker turns),
-- the meeting's speakers with the names people gave them, and each segment's speaker.
CREATE TABLE diarizations (
    meeting_id   uuid PRIMARY KEY REFERENCES meetings (id) ON DELETE CASCADE,
    status       text NOT NULL CHECK (status IN ('queued', 'running', 'done', 'failed')),
    message      text NOT NULL DEFAULT '',
    turns        jsonb NOT NULL DEFAULT '[]',   -- [[start_ms, end_ms, label, text], ...] of the last finished run
    requested_by text,                          -- NULL: queued automatically when the recording closed
    queued_at    timestamptz NOT NULL DEFAULT now(),
    started_at   timestamptz,
    finished_at  timestamptz,
    seconds      real
);
CREATE INDEX diarizations_queue ON diarizations (queued_at) WHERE status = 'queued';

-- name: free text; username: a member of the meeting's team. Both empty: shown as 說話者 <label>.
CREATE TABLE meeting_speakers (
    meeting_id uuid NOT NULL REFERENCES meetings (id) ON DELETE CASCADE,
    label      smallint NOT NULL CHECK (label > 0),
    name       text NOT NULL DEFAULT '',
    username   text,
    PRIMARY KEY (meeting_id, label)
);

-- speaker_manual: chosen by a person, so labelling segments stored later leaves it alone.
ALTER TABLE segments
    ADD COLUMN speaker        smallint,
    ADD COLUMN speaker_manual boolean NOT NULL DEFAULT false,
    ADD CONSTRAINT segments_speaker FOREIGN KEY (meeting_id, speaker) REFERENCES meeting_speakers (meeting_id, label)
        ON DELETE SET NULL (speaker);
