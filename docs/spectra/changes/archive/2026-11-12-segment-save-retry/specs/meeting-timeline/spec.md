## ADDED Requirements

### Requirement: Unsaved segments are shown and retried

When saving a meeting's segments fails, the live page SHALL retry with the latest segments after 5, 15 and 30 seconds and then every 60 seconds until a save succeeds, and SHALL show next to the status 段落尚未儲存，<n> 秒後重試 as a warning. After a successful save it SHALL show 段落已儲存 <HH:MM:SS>. When the server answers 401 the page SHALL stop retrying and show 登入已失效，段落尚未儲存，請重新登入. While segments are waiting to be saved or a save has failed, closing or reloading the page SHALL ask for confirmation. Retries SHALL only send segments for the meeting they belong to; once another meeting has started, retries for the previous one SHALL stop.

#### Scenario: The network drops during a meeting

- **WHEN** two saves in a row fail and the third succeeds
- **THEN** the page shows 段落尚未儲存，5 秒後重試, then 段落尚未儲存，15 秒後重試, then 段落已儲存 with the time, and the third request carries the segments finalized up to that moment

##### Example: retry schedule

| Failures in a row | Next retry after | Shown |
| ----------------- | ---------------- | ----- |
| 1 | 5 s | 段落尚未儲存，5 秒後重試 |
| 2 | 15 s | 段落尚未儲存，15 秒後重試 |
| 3 | 30 s | 段落尚未儲存，30 秒後重試 |
| 4 or more | 60 s | 段落尚未儲存，60 秒後重試 |
| answered 401 | none | 登入已失效，段落尚未儲存，請重新登入 |

#### Scenario: Leaving with unsaved segments

- **WHEN** a save has failed and the user closes the tab
- **THEN** the browser asks for confirmation before leaving
