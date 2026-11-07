-- Action items created on the board (board-created-actions): an item carries its own team, and one that belongs
-- to no meeting may carry a series instead, so it is brought up before that series' next meeting.
ALTER TABLE minute_items
    ADD COLUMN team_id   bigint REFERENCES teams (id) ON DELETE CASCADE,
    ADD COLUMN series_id bigint REFERENCES meeting_series (id) ON DELETE SET NULL;
UPDATE minute_items i SET team_id = m.team_id FROM meetings m WHERE m.id = i.meeting_id;
ALTER TABLE minute_items
    ALTER COLUMN team_id SET NOT NULL,
    ALTER COLUMN meeting_id DROP NOT NULL,
    ADD CONSTRAINT minute_items_board_item CHECK (
        meeting_id IS NOT NULL OR (kind = 'action' AND origin = 'manual' AND state = 'confirmed')),
    ADD CONSTRAINT minute_items_series_only_without_meeting CHECK (meeting_id IS NULL OR series_id IS NULL);
CREATE INDEX minute_items_team ON minute_items (team_id, kind, state, status);

-- Inserts that name only the meeting (minutes generation, the minutes page, tests) get the meeting's team.
CREATE FUNCTION minute_items_team() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.team_id IS NULL AND NEW.meeting_id IS NOT NULL THEN
        SELECT team_id INTO NEW.team_id FROM meetings WHERE id = NEW.meeting_id;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER minute_items_team BEFORE INSERT ON minute_items FOR EACH ROW EXECUTE FUNCTION minute_items_team();
