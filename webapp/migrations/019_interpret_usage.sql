-- Seconds of translated audio received from Azure GPT-Realtime-Translate, per date and purpose (realtime-interpret):
-- 'live' = sessions on the 即時口譯 page, other purposes are entered by hand (python -m interpret_usage add).
-- Nothing else is kept here. The cost shown to administrators is seconds x INTERPRET_USD_PER_HOUR; it is not part
-- of the MAI budget.
CREATE TABLE interpret_usage (
    day date NOT NULL,
    purpose text NOT NULL CHECK (purpose ~ '^[a-z0-9-]{1,40}$'),
    seconds double precision NOT NULL DEFAULT 0 CHECK (seconds >= 0),
    PRIMARY KEY (day, purpose)
);
