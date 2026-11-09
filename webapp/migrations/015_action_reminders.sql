-- Due-date reminders to action item owners (action-reminders): reminders can be switched off per item, and every
-- reminder sent is kept so it is not sent twice. day: the due date for 'soon' and 'due' (once per due date), the
-- run's date for 'overdue' (once a day).
ALTER TABLE minute_items ADD COLUMN remind boolean NOT NULL DEFAULT true;

CREATE TABLE reminder_log (
    item_id  bigint NOT NULL REFERENCES minute_items (id) ON DELETE CASCADE,
    kind     text NOT NULL CHECK (kind IN ('soon', 'due', 'overdue')),
    day      date NOT NULL,
    owner    text NOT NULL,
    due_date date NOT NULL,
    sent_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (item_id, kind, day)
);
