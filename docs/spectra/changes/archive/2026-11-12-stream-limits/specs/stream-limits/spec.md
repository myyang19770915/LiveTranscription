## Purpose

The recognition WebSocket is reachable from outside through the tunnel, so it needs limits: a connection that never starts, one user opening many streams, a stream that never ends, and a stream that outlives the user's access must not hold the GPU or keep recording.

## ADDED Requirements

### Requirement: Stream start, count and length limits

The recognition WebSocket (`/ws/transcribe`, for every engine) SHALL close a connection that has not sent its start message within `STREAM_HEADER_TIMEOUT` seconds (default 30) with code 4408. A signed-in user SHALL have at most `MAX_STREAMS_PER_USER` (default 2) streams open at once; a further stream SHALL be closed with code 4429 before any audio is forwarded, and closing a stream SHALL free its place. A stream SHALL accept at most `MAX_STREAM_HOURS` hours (default 4) of audio (16 kHz 16-bit mono, 115,200,000 bytes per hour); when a chunk would exceed it, the chunk SHALL NOT be forwarded or recorded, the system SHALL send `{"status": "error", "msg": "已達單場上限 4 小時，錄音已停止"}` (with the configured number) and close with code 4413, and the meeting recording SHALL be finished normally. The live page SHALL show a message naming the reason for codes 4408, 4413 and 4429.

#### Scenario: A third stream

- **WHEN** alice has two streams open and opens a third
- **THEN** the third is closed with code 4429 and alice's page shows 同時進行的辨識已達上限（2 條）, and after one of the first two ends she can open another

#### Scenario: A stream reaches its length limit

- **WHEN** a meeting stream with `MAX_STREAM_HOURS=4` has received 4 hours of audio and the next chunk arrives
- **THEN** that chunk is neither forwarded nor recorded, the page receives 已達單場上限 4 小時，錄音已停止, the connection closes with 4413, and the meeting's recording is finished as usual

##### Example: audio accepted

| MAX_STREAM_HOURS | Audio received so far | Next chunk | Result |
| ---------------- | --------------------- | ---------- | ------ |
| 4 | 460,799,000 bytes | 1,000 bytes | forwarded (exactly 460,800,000) |
| 4 | 460,800,000 bytes | 2 bytes | refused, closed 4413 |
| 1 | 115,199,999 bytes | 2 bytes | refused, closed 4413 |

#### Scenario: No start message

- **WHEN** a client opens the WebSocket and sends nothing for 30 seconds
- **THEN** the connection is closed with code 4408 and no engine connection is opened

### Requirement: Long streams re-check access

While a stream receives audio, the system SHALL check again, at least every `STREAM_RECHECK_MINUTES` minutes (default 5), that the session cookie it was opened with is still valid, and for a meeting stream that the user is still a member of the meeting's team. When the session has ended (signed out or expired) the stream SHALL be closed with code 4401, and a page with a running meeting SHALL stop it the way the stop button does before asking the user to sign in again; when the user is no longer a member the stream SHALL be closed with code 4403 and the page SHALL show 你已不是這個團隊的成員，錄音已停止. In both cases the audio received before the check SHALL be kept and the recording finished normally. When the database cannot answer the check, the stream SHALL continue and the check SHALL be tried again 30 seconds later.

#### Scenario: Signed out in another tab

- **WHEN** alice signs out in another tab while her meeting stream is running and the next check comes due
- **THEN** the stream is closed with code 4401, her page stops the meeting, keeps the browser recording available for download and shows 登入已失效，錄音已停止；請先下載錄音，再重新登入, and the server recording up to that moment is kept

#### Scenario: Removed from the team

- **WHEN** an administrator removes bob from the team while bob's meeting stream is running and the next check comes due
- **THEN** the stream is closed with code 4403 and bob's page shows 你已不是這個團隊的成員，錄音已停止
