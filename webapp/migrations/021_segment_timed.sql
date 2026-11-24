-- segment-audio-times: a segment whose start and end were corrected from the speaker turns of the recording
-- (diarize.retime). Until then the times are the meeting page's estimate, and playback allows for that.
ALTER TABLE segments ADD COLUMN timed boolean NOT NULL DEFAULT false;
