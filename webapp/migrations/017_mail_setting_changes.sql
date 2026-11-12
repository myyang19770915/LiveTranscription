-- Every change of a team's mail settings (mail-settings-audit): an administrator who is not a member can also change
-- where the team's minutes go, so each change keeps who made it, whether they were a member, and before / after.
CREATE TABLE team_mail_changes (
    id             bigserial PRIMARY KEY,
    team_id        bigint NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
    changed_at     timestamptz NOT NULL DEFAULT now(),
    changed_by     text NOT NULL,
    by_member      boolean NOT NULL,
    target_before  text NOT NULL,
    address_before text NOT NULL,
    auto_before    boolean NOT NULL,
    target_after   text NOT NULL,
    address_after  text NOT NULL,
    auto_after     boolean NOT NULL
);
CREATE INDEX team_mail_changes_team ON team_mail_changes (team_id, id DESC);
