-- Whether a person changed an item's kind, content, owner, due date or due phrase (outcome-metrics): tells an AI item
-- adopted as proposed from one adopted after an edit. Items before this migration count as unedited.
ALTER TABLE minute_items ADD COLUMN edited boolean NOT NULL DEFAULT false;
