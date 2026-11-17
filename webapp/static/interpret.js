/* 即時口譯 (realtime-interpret). Two connections while live:
   /ws/interpret    24 kHz speech → Azure GPT-Realtime-Translate; back come the translated speech and text, saved on stop.
   /ws/transcribe   the same speech at 16 kHz in translate mode → the source text (local Confucius or MAI), handed to
                    /ws/interpret as changes, {"type":"source","keep":n,"text":rest}, so it is saved with the session.
   Everything keeps its place on the session clock (seconds since 已連線), so the waveform, the replay and the saved files line up. */
(function () {
  const $ = id => document.getElementById(id);
  const RATE = 24000, WINDOW = 30, BAR = 0.1;   // the canvas shows 30 s; one bar per 100 ms
  const EOS = 'YOUDAO_ONETIME_ASR_STREAM_EOS';
  const LOCAL = new Set(['zh', 'auto', 'yue']);
  // Output languages: OFFICIAL are the 13 OpenAI lists; MORE are also accepted by the model, quality not described.
  const OFFICIAL = [['zh', '中文（台灣繁體）'], ['en', 'English 英文'], ['ja', '日本語 日文'], ['ko', '한국어 韓文'], ['es', 'Español 西班牙文'],
    ['pt', 'Português 葡萄牙文'], ['fr', 'Français 法文'], ['de', 'Deutsch 德文'], ['it', 'Italiano 義大利文'], ['ru', 'Русский 俄文'],
    ['hi', 'हिन्दी 印地文'], ['id', 'Bahasa Indonesia 印尼文'], ['vi', 'Tiếng Việt 越南文']];
  const MORE = [['th', 'ไทย 泰文'], ['ms', 'Bahasa Melayu 馬來文'], ['tl', 'Tagalog 他加祿文'], ['ar', 'العربية 阿拉伯文'], ['tr', 'Türkçe 土耳其文'],
    ['nl', 'Nederlands 荷蘭文'], ['pl', 'Polski 波蘭文'], ['uk', 'Українська 烏克蘭文'], ['cs', 'Čeština 捷克文'], ['sv', 'Svenska 瑞典文'],
    ['da', 'Dansk 丹麥文'], ['no', 'Norsk 挪威文'], ['fi', 'Suomi 芬蘭文'], ['el', 'Ελληνικά 希臘文'], ['he', 'עברית 希伯來文'],
    ['hu', 'Magyar 匈牙利文'], ['ro', 'Română 羅馬尼亞文'], ['bg', 'Български 保加利亞文'], ['hr', 'Hrvatski 克羅埃西亞文'], ['sr', 'Српски 塞爾維亞文'],
    ['sk', 'Slovenčina 斯洛伐克文'], ['sl', 'Slovenščina 斯洛維尼亞文'], ['lt', 'Lietuvių 立陶宛文'], ['lv', 'Latviešu 拉脫維亞文'], ['et', 'Eesti 愛沙尼亞文'],
    ['fa', 'فارسی 波斯文'], ['ur', 'اردو 烏爾都文'], ['ta', 'தமிழ் 坦米爾文'], ['kn', 'ಕನ್ನಡ 康納達文'], ['mr', 'मराठी 馬拉地文'], ['ne', 'नेपाली 尼泊爾文'],
    ['sw', 'Kiswahili 史瓦希里文'], ['af', 'Afrikaans 南非語'], ['ca', 'Català 加泰隆尼亞文'], ['gl', 'Galego 加利西亞文'], ['cy', 'Cymraeg 威爾斯文'],
    ['is', 'Íslenska 冰島文'], ['mk', 'Македонски 馬其頓文'], ['bs', 'Bosanski 波士尼亞文'], ['be', 'Беларуская 白俄羅斯文'], ['hy', 'Հայերեն 亞美尼亞文'],
    ['az', 'Azərbaycan 亞塞拜然文'], ['kk', 'Қазақ 哈薩克文'], ['mi', 'Māori 毛利文']];
  const LANG_NAME = Object.fromEntries([...OFFICIAL, ...MORE, ['auto', '中英混合'], ['yue', '粵語']].map(([v, n]) => [v, n.replace(/（.*/, '').split(' ').pop()]));
  LANG_NAME.zh = '中文';
  // Close reasons the page explains (stream-limits and realtime-interpret).
  const CLOSED = {4401: '登入已過期，請重新登入。', 4403: '即時口譯只開放給系統管理員。', 4400: '不支援這個輸出語言。', 4503: '即時口譯尚未設定，請聯絡系統管理員。'};
  const store = {get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} }};

  let cfg = {configured: false, usdPerHour: 2.04};
  let ws = null, asr = null, ctx = null, stream = null, tap = null, srcNode = null, liveGain = null;
  let live = false, starting = false, startAt = 0, sentSamples = 0, outSamples = 0, nextPlay = 0, firstAudio = null, firstText = null, firstSent = null;
  // No audio is kept on the page (interpret-long-sessions): only the waveform values; replay plays the saved files.
  let inBars = [], outBars = [], outEnd = 0, players = null, replaying = null, scrub = null, drawLeft = 0, replayMode = 'both';
  let srcFinal = '', srcTent = '', sentSource = '', currentId = null, rest = [], savedNow = null;

  const fmt = s => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
  const rms = f => { let s = 0; for (const v of f) s += v * v; return f.length ? Math.sqrt(s / f.length) : 0; };
  function showError(message) { $('error').textContent = message; $('error').hidden = !message; }
  function setState(text, kind = '') { $('state').textContent = text; $('statePill').className = `pill ${kind}`; }
  function showLoaded(text) { $('loaded').textContent = text; $('loaded').hidden = !text; }

  // --- Settings
  {
    const sel = $('target');
    const group = (label, list) => { const g = document.createElement('optgroup'); g.label = label;
      for (const [v, t] of list) g.append(new Option(t, v, false, v === 'en')); sel.append(g); };
    group('完整支援的 13 種', OFFICIAL); group('也可選用（翻譯品質未經保證）', MORE);
    const saved = store.get('yq-interpret-target');
    if (saved && [...sel.options].some(o => o.value === saved)) sel.value = saved;
    sel.onchange = () => store.set('yq-interpret-target', sel.value);
    const lang = store.get('yq-interpret-source');
    if (lang && [...$('sourceLang').options].some(o => o.value === lang)) $('sourceLang').value = lang;
    $('sourceLang').onchange = () => store.set('yq-interpret-source', $('sourceLang').value);
    const play = store.get('yq-interpret-play');
    if (play !== null) $('playOut').checked = play === '1';
  }
  $('playOut').onchange = () => {
    // Only the volume: the translated speech is still drawn and saved. Speech already scheduled goes quiet too.
    if (liveGain) { liveGain.gain.cancelScheduledValues(0); liveGain.gain.value = $('playOut').checked ? 1 : 0; }
    store.set('yq-interpret-play', $('playOut').checked ? '1' : '0');
  };
  $('themeToggle').onclick = () => { const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next; store.set('interpreter-theme', next); };

  async function loadConfig() {
    const response = await fetch('/api/interpret/config');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    cfg = await response.json();
    $('price').textContent = cfg.usdPerHour;
    if (!cfg.configured) { showError('即時口譯尚未設定，請聯絡系統管理員。'); $('connect').disabled = true; }
  }

  // --- Live session
  const WORKLET = `class Tap extends AudioWorkletProcessor {
    constructor() { super(); this.buf = new Float32Array(2400); this.n = 0; }
    process(inputs) { const ch = inputs[0]?.[0]; if (!ch) return true;
      for (let i = 0; i < ch.length; i++) { this.buf[this.n++] = ch[i]; if (this.n === 2400) { this.port.postMessage(this.buf.slice()); this.n = 0; } }
      return true; } }
  registerProcessor('tap', Tap);`;

  async function openSource() {
    if ($('source').value === 'tab') {
      const media = await navigator.mediaDevices.getDisplayMedia({video: true, audio: {echoCancellation: false, noiseSuppression: false}});
      if (!media.getAudioTracks().length) { media.getTracks().forEach(t => t.stop()); throw new Error('分享時要勾選「同時分享分頁音訊」'); }
      media.getAudioTracks()[0].addEventListener('ended', () => live && stop());
      return media;
    }
    return navigator.mediaDevices.getUserMedia({audio: {channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true}});
  }

  const toPcm = f => { const pcm = new Int16Array(f.length); for (let i = 0; i < f.length; i++) pcm[i] = Math.max(-1, Math.min(1, f[i])) * 0x7fff; return pcm; };
  // 24 kHz → 16 kHz for /ws/transcribe (linear interpolation; 2400 samples become 1600).
  function to16k(f) {
    const n = Math.floor(f.length * 2 / 3), out = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = i * 1.5, j = Math.floor(x), a = x - j; out[i] = f[j] * (1 - a) + (f[j + 1] ?? f[j]) * a; }
    return out;
  }
  const wsUrl = path => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${path}`;

  async function start() {
    if (starting) return;   // a second click while the microphone prompt is open would open a second session
    starting = true; $('connect').disabled = true;
    try { await open(); } finally { starting = false; $('connect').disabled = !cfg || !cfg.configured; }
  }
  async function open() {
    showError(''); resetSession();
    try { stream = await openSource(); } catch (e) { showError(`無法開啟音源：${e.message}`); return; }
    if (ctx && ctx.state !== 'closed') ctx.close();   // one audio context at a time
    ctx = new AudioContext({sampleRate: RATE});
    liveGain = ctx.createGain(); liveGain.gain.value = $('playOut').checked ? 1 : 0; liveGain.connect(ctx.destination);
    await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([WORKLET], {type: 'application/javascript'})));
    srcNode = ctx.createMediaStreamSource(stream);
    tap = new AudioWorkletNode(ctx, 'tap');
    srcNode.connect(tap);
    live = true; setButton(); setState('連線中…', 'busy');
    const sourceLang = $('sourceLang').value, engine = LOCAL.has(sourceLang) ? 'local' : 'mai';

    ws = new WebSocket(wsUrl('/ws/interpret'));
    ws.onopen = () => ws.send(JSON.stringify({target: $('target').value, sourceLang}));
    ws.onmessage = e => onEvent(JSON.parse(e.data));
    ws.onclose = e => {
      if (CLOSED[e.code] || e.code === 4429 || e.code === 4413 || e.code === 4408) showError(CLOSED[e.code] || e.reason);
      if (live) stop(true);
      if (asr && asr.readyState <= 1) asr.close();
      setState($('error').hidden ? '已中斷' : '錯誤', $('error').hidden ? '' : 'bad'); finishSession(); ws = null;
      if (savedNow) { const id = savedNow; savedNow = null; loadSession(id, true); }   // replay comes from the saved files
    };

    // The source text: the same recognition as 即時翻譯, kept on this page only until it is handed to /ws/interpret.
    $('srcEngine').textContent = engine === 'mai' ? '（雲端辨識）' : '（本機辨識）';
    asr = new WebSocket(wsUrl('/ws/transcribe'));
    asr.binaryType = 'arraybuffer';
    asr.onopen = () => { asr.send(JSON.stringify({mode: 'translate', language: sourceLang, engine})); for (const part of rest) asr.send(part); rest = []; };
    asr.onmessage = e => {
      let data; try { data = JSON.parse(e.data); } catch { return; }
      if (data.status === 'error' && data.msg) showError(`原文辨識：${data.msg}`);
      let changed = false;
      if (typeof data.displayText === 'string' && data.displayText !== srcFinal) { srcFinal = data.displayText; srcTent = ''; changed = true; }
      if (typeof data.tentative === 'string') srcTent = data.tentative;
      renderSource();
      if (changed && ws && ws.readyState === 1) sendSource();
    };
    asr.onclose = e => { if (e.code >= 4000 && live) showError(`原文辨識已停止：${e.reason || e.code}（翻譯照常進行）`); };

    tap.port.onmessage = ({data}) => {
      if (!ws || ws.readyState !== 1 || !startAt) return;
      ws.send(toPcm(data).buffer);
      const small = toPcm(to16k(data)).buffer;
      if (asr && asr.readyState === 1) asr.send(small); else if (asr && asr.readyState === 0) rest.push(small);
      if (firstSent === null) firstSent = performance.now();
      inBars.push({t: sentSamples / RATE, v: rms(data)});
      sentSamples += data.length;
      $('sent').textContent = fmt(sentSamples / RATE);
    };
  }

  function onEvent(ev) {
    if (ev.type === 'status' && ev.state === 'connected') { setState('口譯中', 'live'); startAt = performance.now(); nextPlay = ctx.currentTime; }
    else if (ev.type === 'status' && ev.state === 'closed') {
      $('cost').textContent = `$${(ev.usd || 0).toFixed(4)}`;
      if (ev.saved) { currentId = ev.saved; savedNow = ev.saved; showLoaded(`已存檔：${ev.saved}`); loadHistory(); }
    }
    else if (ev.type === 'error') showError(ev.message);
    else if (ev.type === 'out') {
      if (firstText === null && firstSent !== null) { firstText = (performance.now() - firstSent) / 1000; $('firstText').textContent = `${firstText.toFixed(2)} 秒`; }
      const box = $('outText'), stick = box.scrollTop + box.clientHeight >= box.scrollHeight - 30;
      box.append(ev.delta);
      if (stick) box.scrollTop = box.scrollHeight;
    }
    else if (ev.type === 'audio') playChunk(ev.audio);
  }

  // Only the change goes to /ws/interpret: keep the first `keep` characters of what was sent, then `text`.
  function sendSource() {
    let keep = 0;
    while (keep < sentSource.length && keep < srcFinal.length && sentSource[keep] === srcFinal[keep]) keep++;
    ws.send(JSON.stringify({type: 'source', keep, text: srcFinal.slice(keep)}));
    sentSource = srcFinal;
  }

  function renderSource() {
    const box = $('srcText'), stick = box.scrollTop + box.clientHeight >= box.scrollHeight - 30;
    box.textContent = srcFinal;
    if (srcTent) box.append(Object.assign(document.createElement('span'), {className: 'tentative', textContent: srcTent}));
    if (stick) box.scrollTop = box.scrollHeight;
  }

  function playChunk(b64) {
    const bin = atob(b64), f = new Float32Array(bin.length / 2);
    for (let i = 0; i < f.length; i++) f[i] = ((bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8)) << 16 >> 16) / 0x8000;
    if (firstAudio === null && firstSent !== null) { firstAudio = (performance.now() - firstSent) / 1000; $('firstAudio').textContent = `${firstAudio.toFixed(2)} 秒`; }
    const now = ctx.currentTime, at = Math.max(now, nextPlay);
    const buf = ctx.createBuffer(1, f.length, RATE); buf.copyToChannel(f, 0);
    const s = ctx.createBufferSource(); s.buffer = buf; s.connect(liveGain); s.start(at);
    nextPlay = at + f.length / RATE;
    const offset = (at - now) + (performance.now() - startAt) / 1000;   // where the piece is heard on the session clock
    outEnd = Math.max(outEnd, offset + f.length / RATE);
    const step = Math.round(RATE * BAR);
    for (let i = 0; i < f.length; i += step) outBars.push({t: offset + i / RATE, v: rms(f.subarray(i, i + step))});
    outSamples += f.length;   // the translation is charged by the length of the translated speech, not of what was sent
    $('outLen').textContent = `${(outSamples / RATE).toFixed(1)} 秒`;
    $('cost').textContent = `$${(outSamples / RATE / 3600 * cfg.usdPerHour).toFixed(3)}`;
  }

  function stop(fromClose) {
    live = false; setButton();
    stream?.getTracks().forEach(t => t.stop()); srcNode?.disconnect(); tap?.disconnect();
    if (fromClose) return;
    setState('收尾中…', 'busy');
    // The last source text arrives after EOS; hand it over before /ws/interpret saves the session.
    const finish = () => { if (ws && ws.readyState === 1) ws.send(JSON.stringify({type: 'stop'})); };
    if (asr && asr.readyState === 1) {
      const timer = setTimeout(finish, 3000);
      asr.addEventListener('close', () => { clearTimeout(timer); finish(); }, {once: true});
      asr.send(EOS);
    } else finish();
  }

  function finishSession() {
    $('replayOut').disabled = !players || !outBars.length; $('replayIn').disabled = !players || !inBars.length; $('replayBoth').disabled = !players;
  }
  function resetSession() {
    stopReplay(); players = null;
    inBars = []; outBars = []; outEnd = 0; srcFinal = srcTent = sentSource = ''; rest = []; savedNow = null;
    sentSamples = outSamples = 0; startAt = 0; firstAudio = firstText = firstSent = null;
    $('srcEngine').textContent = ''; $('outText').textContent = '';
    $('srcText').replaceChildren(Object.assign(document.createElement('span'), {className: 'hint', textContent: '連線後顯示。'}));
    $('sent').textContent = '0:00.0'; $('cost').textContent = '$0.000'; $('firstAudio').textContent = $('firstText').textContent = '—'; $('outLen').textContent = '0.0 秒';
    stopReplay(); $('replayOut').disabled = $('replayIn').disabled = $('replayBoth').disabled = true;
    currentId = null; showLoaded(''); markCurrent();
  }
  function setButton() {
    $('connect').classList.toggle('live', live); $('connect').textContent = live ? '中斷' : '連線';
    $('source').disabled = $('target').disabled = $('sourceLang').disabled = live;
  }

  // --- Replay: the saved input.wav and output.wav, both on the session clock, streamed from the server (Range), so
  // a session of hours is never held in memory. The playhead is the furthest of the playing tracks.
  const MODE_BUTTON = {both: 'replayBoth', out: 'replayOut', in: 'replayIn'};
  const sessionEnd = () => Math.max(sentSamples / RATE, outEnd, outBars.length ? outBars[outBars.length - 1].t + BAR : 0, 0);
  const playheadAt = () => replaying ? Math.max(replaying.from, ...replaying.els.map(el => el.currentTime || 0)) : 0;
  function setMode(kind) { replayMode = kind; for (const [k, id] of Object.entries(MODE_BUTTON)) $(id).classList.toggle('mode', k === kind); }
  function replay(kind, from = 0) {
    stopReplay(); setMode(kind);
    if (!players) return;
    const els = [...(kind !== 'out' ? [players.in] : []), ...(kind !== 'in' ? [players.out] : [])];
    for (const el of els) { el.currentTime = from; el.play().catch(() => {}); }
    const button = $(MODE_BUTTON[kind]);
    replaying = {els, from, end: sessionEnd(), button, label: button.textContent, kind};
    button.textContent = '停止播放'; button.classList.add('playing');
  }
  function stopReplay() {
    if (!replaying) return;
    for (const el of replaying.els) el.pause();
    replaying.button.textContent = replaying.label; replaying.button.classList.remove('playing');
    replaying = null;
  }
  for (const [kind, id] of Object.entries(MODE_BUTTON))
    $(id).onclick = () => replaying && replaying.kind === kind ? stopReplay() : replay(kind);

  // Click or drag on the waveform: the line follows the pointer, and on release the session plays from there in the
  // current mode (the mode of the playback under way, or the last button used; 整段 when none was).
  const wave = $('wave');
  const timeAt = e => { const r = wave.getBoundingClientRect(), pad = 24;
    return Math.max(0, Math.min(scrub.left + (e.clientX - r.left - pad) / (r.width - 2 * pad) * WINDOW, sessionEnd())); };
  wave.onpointerdown = e => {
    if (live || !players) return;
    const kind = replaying ? replaying.kind : replayMode;
    stopReplay(); setMode(kind);
    scrub = {left: drawLeft, at: 0}; scrub.at = timeAt(e);
    wave.setPointerCapture(e.pointerId);
  };
  wave.onpointermove = e => { if (scrub) scrub.at = timeAt(e); };
  wave.onpointerup = e => { if (!scrub) return; const at = timeAt(e); scrub = null; replay(replayMode, at); };
  wave.onpointercancel = () => { scrub = null; };

  function draw() {
    const c = wave, r = c.getBoundingClientRect(), dpr = devicePixelRatio || 1;
    if (c.width !== Math.round(r.width * dpr) || c.height !== Math.round(r.height * dpr)) { c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr); }
    const g = c.getContext('2d'), W = c.width, H = c.height, mid = H / 2, pad = 24 * dpr, css = getComputedStyle(document.documentElement);
    g.clearRect(0, 0, W, H);
    if (replaying && (replaying.els.every(el => el.ended) || playheadAt() > replaying.end + 0.2)) stopReplay();
    const total = startAt ? (live ? (performance.now() - startAt) / 1000 : sessionEnd()) : 0;
    const now = scrub ? scrub.at : replaying ? playheadAt() : total;
    // Live and replay follow the playhead; while dragging the view holds still so the line stays under the pointer.
    const left = scrub ? scrub.left : live || replaying ? Math.max(0, now - WINDOW * 0.85) : Math.max(0, total - WINDOW * 0.95);
    drawLeft = left;
    const scale = (W - 2 * pad) / WINDOW, x = t => pad + (t - left) * scale;
    g.strokeStyle = css.getPropertyValue('--border'); g.lineWidth = dpr;
    for (let t = Math.ceil(left); t < left + WINDOW; t += 2) { g.beginPath(); g.moveTo(x(t), 8 * dpr); g.lineTo(x(t), H - 8 * dpr); g.stroke(); }
    g.setLineDash([4 * dpr, 4 * dpr]); g.strokeStyle = css.getPropertyValue('--field-border'); g.beginPath(); g.moveTo(pad, mid); g.lineTo(W - pad, mid); g.stroke(); g.setLineDash([]);
    const bw = Math.max(1, BAR * scale * 0.8), amp = v => Math.min(1, v * 4) * (mid - 16 * dpr);
    g.fillStyle = css.getPropertyValue('--accent');
    for (const b of inBars) if (b.t >= left && b.t <= left + WINDOW) g.fillRect(x(b.t), mid - amp(b.v), bw, amp(b.v));
    g.fillStyle = css.getPropertyValue('--accent-2');
    for (const b of outBars) if (b.t >= left && b.t <= left + WINDOW) g.fillRect(x(b.t), mid, bw, amp(b.v));
    if (startAt && (live || replaying || total > 0)) {
      g.strokeStyle = css.getPropertyValue(replaying || scrub ? '--danger' : '--text'); g.lineWidth = 1.5 * dpr;
      g.beginPath(); g.moveTo(x(now), 8 * dpr); g.lineTo(x(now), H - 8 * dpr); g.stroke();
    }
    requestAnimationFrame(draw);
  }

  // --- 我的紀錄
  function markCurrent() { for (const tr of $('historyRows').children) tr.classList.toggle('current', tr.dataset.id === currentId); }
  async function loadHistory() {
    const response = await fetch('/api/interpret/sessions');
    if (!response.ok) return;
    const rows = await response.json();
    $('historyEmpty').hidden = rows.length > 0;
    $('historyRows').closest('.table-wrap').hidden = !rows.length;
    $('historyRows').replaceChildren(...rows.map(s => {
      const tr = document.createElement('tr'); tr.dataset.id = s.id;
      const td = (text, cls) => Object.assign(document.createElement('td'), cls ? {className: cls} : {}, text !== undefined ? {textContent: text} : {});
      const what = td(); what.append(Object.assign(document.createElement('span'), {className: 'preview', textContent: s.preview || '（無文字）'}));
      const acts = td(undefined, 'acts');
      const btn = (label, fn, cls = '') => Object.assign(document.createElement('button'), {type: 'button', className: `text-button ${cls}`, textContent: label, onclick: fn});
      const link = (label, name) => Object.assign(document.createElement('a'), {textContent: label, href: `/api/interpret/sessions/${s.id}/${name}`, download: ''});
      acts.append(btn('載入', () => loadSession(s.id)), link('原音', 'input.wav'), link('譯音', 'output.wav'), link('文字', 'transcript.txt'),
        btn('刪除', () => removeSession(s.id), 'danger'));
      const engine = s.engine === 'mai' ? '・雲端' : s.engine === 'local' ? '・本機' : '';
      tr.append(td(s.startedAt), td(`${LANG_NAME[s.sourceLang] || s.sourceLang || '?'}${engine} → ${LANG_NAME[s.target] || s.target}`),
        td(fmt(s.inputSeconds || 0)), td(`$${(s.usd || 0).toFixed(4)}`), what, acts);
      return tr;
    }));
    markCurrent();
  }
  // savedNow: the session that just ended on this page; its texts and figures are already shown.
  async function loadSession(id, savedNow = false) {
    if (live) return;
    stopReplay();
    if (!savedNow) showError('');
    const base = `/api/interpret/sessions/${id}`;
    const get = url => fetch(url).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); });
    let meta, bars;
    try { [meta, bars] = await Promise.all([get(base), get(`${base}/bars`)]); }
    catch { if (!savedNow) showError('這筆紀錄已不存在或讀取失敗。'); loadHistory().catch(() => {}); return; }
    if (!savedNow) {
      resetSession();
      srcFinal = meta.sourceText || ''; renderSource();
      if (!srcFinal) $('srcText').replaceChildren(Object.assign(document.createElement('span'), {className: 'hint', textContent: '這筆紀錄沒有原文。'}));
      $('outText').textContent = meta.translation || '';
      $('srcEngine').textContent = meta.engine === 'mai' ? '（雲端辨識）' : meta.engine === 'local' ? '（本機辨識）' : '';
      $('cost').textContent = `$${(meta.usd || 0).toFixed(4)}`;
      $('outLen').textContent = `${(meta.outputSeconds || 0).toFixed(1)} 秒`;
      setState('紀錄');
      showLoaded(`目前顯示紀錄：${meta.startedAt}（${LANG_NAME[meta.sourceLang] || meta.sourceLang} → ${LANG_NAME[meta.target] || meta.target}）`);
    }
    // The saved waveform replaces the one drawn live: the translated pieces sit where output.wav has them.
    inBars = (bars.input || []).map((v, i) => ({t: i * BAR, v}));
    outBars = (bars.output || []).map(([t, v]) => ({t, v}));
    outEnd = 0; sentSamples = Math.round((meta.inputSeconds || 0) * RATE); startAt = 1;
    $('sent').textContent = fmt(sentSamples / RATE);
    players = {in: new Audio(`${base}/input.wav`), out: new Audio(`${base}/output.wav`)};
    for (const el of Object.values(players)) el.preload = 'metadata';
    currentId = id;
    finishSession(); markCurrent();
  }
  async function removeSession(id) {
    if (!confirm(`刪除 ${id} 的原音、譯音與文字？刪除後無法復原。`)) return;
    const response = await fetch(`/api/interpret/sessions/${id}`, {method: 'DELETE'});
    if (!response.ok) { showError('刪除失敗，請再試一次。'); return; }
    if (currentId === id) resetSession();
    loadHistory();
  }

  $('connect').onclick = () => live ? stop() : start();
  setMode('both');
  loadConfig().catch(e => { showError(`讀取設定失敗：${e.message}`); $('connect').disabled = true; });
  loadHistory().catch(() => {});
  requestAnimationFrame(draw);
  window.Interpret = {state: () => ({live, replaying: replaying && {kind: replaying.kind, at: playheadAt()}, replayMode, scrub,
    gain: liveGain ? liveGain.gain.value : null, inBars: inBars.length, outBars: outBars.length, players: !!players})};
})();
