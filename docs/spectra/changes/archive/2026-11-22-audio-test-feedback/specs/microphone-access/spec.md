## ADDED Requirements

### Requirement: Audio test result is always visible

The audio source status (`#micStatus`) and the audio test level meter SHALL be shown inside the 測試音源 button, for every audio source (麥克風, 分頁／系統聲音, 麥克風＋系統聲音), and SHALL NOT be hidden together with the microphone selector. The status SHALL be announced to screen readers when it changes (`aria-live="polite"`). While a test runs, the level meter SHALL follow the audio level, and the status SHALL read 訊號正常： followed by the source name once the level has passed the existing signal threshold. When the level has not passed that threshold within 5 seconds of the test starting, the status SHALL read 還沒收到聲音 with advice for the chosen source, in the error style: for 麥克風, 請對麥克風說話，或換一個麥克風來源; for 分頁／系統聲音 and 麥克風＋系統聲音, 請確認分享時勾選了分享音訊，且正在播放. When the level passes the threshold afterwards, the status SHALL change back to 訊號正常：.

#### Scenario: Tab audio test shows its result

- **WHEN** the audio source is 分頁／系統聲音, 測試音源 is pressed, and a tab with sound is shared
- **THEN** the 測試音源 button shows the status 訊號正常： followed by the source name and a moving level meter

#### Scenario: Silent test is reported

- **WHEN** a test runs for 5 seconds and the level never passes the signal threshold
- **THEN** the status reads 還沒收到聲音 with the advice for the chosen source, in the error style

##### Example: advice by source

| Audio source | Status after 5 silent seconds |
| --- | --- |
| 麥克風 | 還沒收到聲音：請對麥克風說話，或換一個麥克風來源 |
| 分頁／系統聲音 | 還沒收到聲音：請確認分享時勾選了分享音訊，且正在播放 |
| 麥克風＋系統聲音 | 還沒收到聲音：請確認分享時勾選了分享音訊，且正在播放 |

#### Scenario: Insecure page status is shown in the button

- **WHEN** the page is not a secure context (where 分頁／系統聲音 is disabled and the source stays 麥克風)
- **THEN** the status 需要 https 連線才能使用麥克風 is shown inside the 測試音源 button
