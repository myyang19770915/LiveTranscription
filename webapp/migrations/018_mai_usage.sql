-- Seconds of audio sent to Azure MAI, per date and purpose (mai-usage): 'live' = the live recognition engine,
-- 'quality' = the quality pass, other purposes are entered by hand (python -m mai_usage add). Nothing else is kept:
-- no meeting, user or text. The cost shown to administrators is seconds x MAI_USD_PER_HOUR.
CREATE TABLE mai_usage (
    day date NOT NULL,
    purpose text NOT NULL CHECK (purpose ~ '^[a-z0-9-]{1,40}$'),
    seconds double precision NOT NULL DEFAULT 0 CHECK (seconds >= 0),
    PRIMARY KEY (day, purpose)
);
