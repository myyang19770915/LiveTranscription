-- Sending the minutes by e-mail (minutes-mail): members' addresses (from LDAP or entered by the member), each team's
-- sending preferences, when the minutes were finalized, and every send attempt.
ALTER TABLE users
    ADD COLUMN email        text,
    ADD COLUMN email_source text CHECK (email_source IN ('ldap', 'self'));

ALTER TABLE teams
    ADD COLUMN mail_target  text NOT NULL DEFAULT 'members' CHECK (mail_target IN ('members', 'team')),
    ADD COLUMN mail_address text NOT NULL DEFAULT '',
    ADD COLUMN mail_auto    boolean NOT NULL DEFAULT false;

ALTER TABLE minutes
    ADD COLUMN finalized_at timestamptz,
    ADD COLUMN finalized_by text;

-- skipped: members not reached because they have no address (target 'members').
CREATE TABLE minutes_mail (
    id         bigserial PRIMARY KEY,
    meeting_id uuid NOT NULL REFERENCES meetings (id) ON DELETE CASCADE,
    trigger    text NOT NULL CHECK (trigger IN ('auto', 'manual')),
    recipients text[] NOT NULL DEFAULT '{}',
    skipped    text[] NOT NULL DEFAULT '{}',
    sent_by    text NOT NULL,
    sent_at    timestamptz NOT NULL DEFAULT now(),
    ok         boolean NOT NULL,
    error      text NOT NULL DEFAULT ''
);
CREATE INDEX minutes_mail_meeting ON minutes_mail (meeting_id, id DESC);
