-- interpret-mode-on-home: who may use 即時口譯 besides system administrators, whose usage it was, and the settings
-- administrators change in the app (records_retention_days: how long saved 即時翻譯 / 即時口譯 records are kept).
CREATE TABLE interpret_access (
    username   text PRIMARY KEY CHECK (username ~ '^[a-z0-9_][a-z0-9._-]{0,63}$'),
    granted_by text NOT NULL,
    granted_at timestamptz NOT NULL DEFAULT now()
);

-- Rows written before this column existed have no user ('').
ALTER TABLE interpret_usage ADD COLUMN username text NOT NULL DEFAULT '';
ALTER TABLE interpret_usage DROP CONSTRAINT interpret_usage_pkey;
ALTER TABLE interpret_usage ADD PRIMARY KEY (day, purpose, username);

CREATE TABLE app_settings (
    key        text PRIMARY KEY,
    value      jsonb NOT NULL,
    updated_by text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);
