# 翻譯品質 Benchmark

用 10 段公開 YouTube 影片（中／日／英各 3–4 段，每段 4 分鐘）測完整流程：ASR → 斷句 → 即時翻譯 → 精修。
評分以盲評為主，ASR 錯字率為輔。

## 準備

```bash
python -m venv .venv && .venv/Scripts/pip install -r bench/requirements.txt   # 另需 ffmpeg、node、playwright（webapp/replay_page.mjs）
python bench/fetch.py            # 下載音訊（裁成 16 kHz wav）與字幕到 bench/data/
```

`bench/data/`、`bench/results/` 含第三方內容，不進 git。

## 流程

| 步驟 | 指令 | 產出 |
|---|---|---|
| 錄 ASR 軌（Confucius） | `python bench/run.py record` | `artifacts/replay/tracks/<case>_...json` |
| 錄 ASR 軌（MAI） | `python bench/mai_record.py [case ...]` | `artifacts/replay/tracks/mai_<case>_...json` |
| ASR 錯字率比較 | `python bench/trackcer.py` | Confucius 與 MAI 的 CER/WER |
| 重播進真實 UI | `python bench/run.py TAG` | `artifacts/replay/TAG_<case>.json` |
| 產生評分表 | `python bench/evaluate.py TAG` | `bench/results/TAG/<case>.md` |
| 盲評分組 | `python bench/blindn.py OUT SEED RUN_A RUN_B [RUN_C]` | `bench/results/OUT/<case>.X/Y/Z.md` |

- `TAG` 以 `cloud` 開頭時會開啟雲端精修。
- `ASR_ENGINE=mai`（或 `hybrid`）透過正式 gateway 錄 MAI 軌（檔名加 `_mai`／`_maip`）；`TRACK_PREFIX=mai_` 則重播 `mai_record.py` 錄的軌。
- 同一批 ASR 軌可重複使用，改翻譯或斷句時比較的是相同輸入。
- 盲評：每段影片由同一位評審依 `rubric.md` 同時評所有版本（滿分 100），評完才看 `mapping.json` 解盲。

## 連線檢查

- `python bench/check_cloud.py clip.wav`：litellm 翻譯模型
- `python bench/check_mai.py clip.wav ja`：MAI Realtime 串流轉錄

## 小工具

- `segcheck.js`：斷句規則案例
- `guardcheck.js`：精修防重複檢查
- `probe.py probe_*.json`：單句翻譯對照

## 2026-11-03 結果（blind6，正式 gateway 版）

| 版本 | 平均 | 英文 | 日文 | 中文 |
|---|---|---|---|---|
| Confucius + 雲端精修（`cloud1`） | 79.8 | 81.7 | 74.8 | **84.7** |
| MAI 規則標點 + 雲端精修（`cloud_mai`，腳本錄製） | 85.2 | 87.7 | **86.8** | 80.7 |
| MAI 正式 gateway + 雲端精修，中文雲端補標點（`cloud_maig`） | 83.8 | **90.3** | 86.5 | 73.7 |

- 混合模式（英日 MAI、中文 Confucius）推算約 **87.1**。
- 中文雲端補標點變差：模型常在話還沒講完時補「。」，斷句切斷句子，因此預設關閉（`TRANSLATE_PUNCTUATE_MAI`）。
- 單支分數在不同輪次會浮動 ±5，看平均與同一輪內的比較。

## 2026-11-03 結果（blind5）

| 版本 | 平均 | 英文 | 日文 | 中文 |
|---|---|---|---|---|
| 本機 v6（Confucius + Gemma） | 78.3 | 82.3 | 74.8 | 79.0 |
| Confucius + 雲端精修 | 82.0 | 84.0 | 77.8 | 85.7 |
| MAI + 雲端精修 | 85.9 | 88.7 | 88.0 | 80.3 |
