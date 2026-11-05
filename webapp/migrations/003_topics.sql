-- Meeting topic (meeting-topics). Empty = no topic; pages then show "MM/DD HH:mm 的會議".
ALTER TABLE meetings ADD COLUMN title text NOT NULL DEFAULT '';
CREATE INDEX meetings_created_by ON meetings (created_by);
