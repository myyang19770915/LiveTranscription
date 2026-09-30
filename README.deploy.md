# 語橋 Live：即時會議轉錄與翻譯

## 啟動

需求：Docker Desktop、NVIDIA GPU、Docker 的 GPU 支援。首次啟動會下載 ASR、VAD，以及約 3.35 GB 的 Google Gemma 4 E2B QAT Q4_0 GGUF 翻譯模型，所需時間取決於網路。

```powershell
Copy-Item .env.example .env
# 編輯 .env，把 ASR_SECRET_KEY 換成隨機長字串
docker compose up --build -d
docker compose logs -f asr
```

ASR 出現 `model warmup complete`、translate 出現 `model loaded` 後，開啟 <http://localhost:18082>。瀏覽器會要求麥克風權限；`localhost` 屬於安全來源，可使用麥克風。

## 語言與繁體中文

R2T2 官方將中文與英文列為主要優化語言，並列出法文、德文、義大利文、日文、韓文、葡萄牙文、俄文、西班牙文、阿拉伯文等其他可辨識語言範例；官方沒有公布精確的語言總數。網頁現在可分別選擇「語音語言」與「翻譯成」，可用「交換」按鈕切換明確的語言方向。日→中、中→日、英→中、中→英等可直接選擇。

選單另外列出 Qwen3-ASR 基礎程式可接受的其他 19 種語言，標為「實驗性」。Gemma 4 官方描述具有 35+ 種開箱可用語言，但並未逐一承諾本介面所列的每一組翻譯方向；小模型在低資源語言上的品質也可能下降。建議先測中文、英文、日文，再逐一驗證其他語言。

中文逐字稿和中文翻譯會在網頁伺服器使用 OpenCC `s2twp` 轉成台灣繁體；複製及匯出的文字也使用繁體。模型本身的辨識結果不會被改寫。

## 翻譯 YouTube 或線上會議聲音

1. 使用 Chrome 開啟網頁，選擇「音訊來源」→「分頁／系統聲音」；若也要轉錄自己說話，選「兩者混合」並選好麥克風。
2. 點「測試音源」或「開始會議」。在 Chrome 的分享選擇器中，若是 YouTube，建議選影片分頁並勾選「分享分頁音訊」；若是其他會議程式，視 Chrome 與作業系統提供的選項選整個畫面並勾選「分享系統音訊」。
3. 播放聲音，觀察測試音量條有沒有反應。若選擇器只分享畫面、沒有音訊軌，網頁會顯示錯誤並停止分享，請重新選擇。

Chrome 不會讓網頁在未經使用者選擇與授權下默默擷取整台電腦的聲音；不同平台和分享類型可提供的音訊選項也不同。建議使用耳機，避免混合模式下回音或重複收音。此功能僅擷取音訊；分享時雖需選畫面或分頁，網頁不會傳送或儲存其畫面影像。

預設針對 RTX 5090 32 GB 與單人會議調整：ASR 使用 `GPU_MEMORY_UTILIZATION=0.40`、`ASR_MAX_MODEL_LEN=16384`；翻譯使用 Gemma 4 E2B QAT Q4_0 量化、純文字模式與全層 GPU offload。翻譯以固定節奏產生暫譯，每輪完成後才原位更新；遇句尾標點、停頓或過長語段再修訂，修訂期間仍保留上一版。實際顯示延遲仍取決於 ASR 和模型推論。

## 驗證

```powershell
Invoke-RestMethod http://localhost:18082/api/health
docker compose exec -T app python -m unittest -v test_server
python smoke_test.py --audio C:\path\to\sample-16k-mono.wav
```

最後一個命令使用附帶錄音，透過網頁的 `/ws/transcribe` 代理連到 ASR；一般使用時 ASR 不對主機公開。它會同時印出模型原始文字與繁體顯示文字。

## 常用操作

```powershell
docker compose ps
docker compose logs -f app asr translate
docker compose down
```

模型快取保存在 Docker named volumes，`docker compose down` 不會刪除；只有加上 `-v` 才會刪除已下載模型。
