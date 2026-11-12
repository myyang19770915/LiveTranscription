-- Claiming and sending a reminder are two steps (reminder-outbox): a claim has claimed_at and no sent_at until the mail
-- server accepts the mail. A claim left unsent for 10 minutes belongs to a run that was killed and is taken over.
ALTER TABLE reminder_log ADD COLUMN claimed_at timestamptz;
UPDATE reminder_log SET claimed_at = sent_at;
ALTER TABLE reminder_log ALTER COLUMN claimed_at SET NOT NULL, ALTER COLUMN claimed_at SET DEFAULT now();
ALTER TABLE reminder_log ALTER COLUMN sent_at DROP NOT NULL, ALTER COLUMN sent_at DROP DEFAULT;
