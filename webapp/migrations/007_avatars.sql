-- Member profile photos (member-avatars). Keyed by the lower-cased account, not users: a member can be
-- added to a team, and given a photo, before their first sign-in.
CREATE TABLE user_avatars (
    username     text PRIMARY KEY,
    image        bytea NOT NULL,
    content_type text NOT NULL CHECK (content_type IN ('image/png', 'image/jpeg', 'image/webp')),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    updated_by   text NOT NULL
);
