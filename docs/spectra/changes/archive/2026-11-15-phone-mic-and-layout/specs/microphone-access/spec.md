## Purpose

Explains in plain words why the microphone or shared audio cannot be used when the page is opened over an insecure connection or in a browser without media capture, instead of showing the browser's raw script error.

## ADDED Requirements

### Requirement: Insecure page explains the microphone is unavailable

When the meeting page is not a secure context (`window.isSecureContext` is false, for example `http://` on a public hostname), the audio source status SHALL show 需要 https 連線才能使用麥克風 as soon as the page loads. Pressing 測試音源 or starting a meeting or translation SHALL NOT call the media capture API; it SHALL show the same status and a message with what to do instead: on a hostname without an explicit port, the https address of the current page (`https://` followed by the hostname, path and query); on an IP address or an explicit port, where that address has no https, the advice to use an https address or open the page as localhost on the same computer, without naming an address. When the page is secure but the browser lacks `navigator.mediaDevices.getUserMedia`, the status SHALL show 此瀏覽器不支援麥克風. No raw script error text (such as `undefined is not an object`) SHALL reach the page.

#### Scenario: Opened over http on a public hostname

- **WHEN** `http://asr.example.test/` is opened, which the browser treats as insecure, and 測試音源 is pressed
- **THEN** the status reads 需要 https 連線才能使用麥克風 and the message contains `https://asr.example.test/`

##### Example: https address in the message

| Current page | Address in the message |
| --- | --- |
| `http://asr.example.test/` | `https://asr.example.test/` |
| `http://asr.example.test/?team=3` | `https://asr.example.test/?team=3` |
| `http://asr.example.test:18082/` | none: 請改用 https 網址，或在這台電腦上以 localhost 開啟 |
| `http://192.168.1.20:18082/` | none: 請改用 https 網址，或在這台電腦上以 localhost 開啟 |

#### Scenario: Status shown before any button is pressed

- **WHEN** the insecure page finishes loading
- **THEN** the audio source status already reads 需要 https 連線才能使用麥克風

#### Scenario: Secure page keeps working

- **WHEN** the page is opened over https or localhost in a browser with media capture
- **THEN** 測試音源 requests the microphone as before

#### Scenario: Browser without media capture

- **WHEN** a secure page is opened in a browser without `navigator.mediaDevices.getUserMedia`
- **THEN** the status reads 此瀏覽器不支援麥克風 and 測試音源 shows a message starting with 此瀏覽器不支援麥克風

#### Scenario: Shared audio on an insecure page

- **WHEN** the insecure page loads, where the browser offers no screen or tab capture either
- **THEN** the 音訊來源 options for sharing a tab or the system are disabled, 音訊來源 stays 麥克風, and the status reads 需要 https 連線才能使用麥克風
