-- Accounts, teams and meeting ownership (team-accounts).
CREATE TABLE users (
    username     text PRIMARY KEY,
    display_name text NOT NULL DEFAULT '',
    first_seen   timestamptz NOT NULL DEFAULT now(),
    last_seen    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE teams (
    id         bigserial PRIMARY KEY,
    name       text NOT NULL,
    name_key   text NOT NULL UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- username need not exist in users yet: members can be added before their first sign-in.
CREATE TABLE team_members (
    team_id  bigint NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
    username text NOT NULL,
    added_by text NOT NULL,
    added_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (team_id, username)
);
CREATE INDEX team_members_username ON team_members (username);

CREATE TABLE sessions (
    token_hash bytea PRIMARY KEY,
    username   text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL
);

CREATE TABLE login_failures (
    username        text PRIMARY KEY,
    count           integer NOT NULL,
    first_failed_at timestamptz NOT NULL,
    last_failed_at  timestamptz NOT NULL
);

CREATE TABLE meetings (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id    bigint NOT NULL REFERENCES teams (id),
    created_by text NOT NULL,
    started_at timestamptz NOT NULL DEFAULT now(),
    language   text NOT NULL,
    engine     text NOT NULL
);
CREATE INDEX meetings_team ON meetings (team_id, started_at DESC);

CREATE TABLE meeting_files (
    meeting_id uuid NOT NULL REFERENCES meetings (id) ON DELETE CASCADE,
    kind       text NOT NULL CHECK (kind IN ('recording', 'transcript')),
    path       text NOT NULL,
    bytes      bigint NOT NULL,
    saved_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (meeting_id, kind)
);
