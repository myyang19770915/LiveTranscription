-- Speaker timeline (speaker-timeline): a speaker's role, e.g. 主持人, shown on its card. Up to 40 characters (the API checks).
ALTER TABLE meeting_speakers ADD COLUMN note text NOT NULL DEFAULT '';
