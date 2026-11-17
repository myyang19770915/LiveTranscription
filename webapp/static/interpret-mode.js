/* 即時口譯 mode of the live page (interpret-mode-on-home). app.js keeps the capture, /ws/transcribe (the source text,
   mode "interpret") and the panes; this module adds /ws/interpret: the same audio at 24 kHz goes out, the interpreted
   speech is played (同步播放譯音) and its text comes back to app.js through onText. The source text goes over as its
   changes ({"type":"source","keep","text"}). Stopping sends {"type":"stop"} and resolves with the saved record's id. */
(function () {
  const $ = id => document.getElementById(id);
  const RATE = 24000;
  const NO_ACCESS = '需要申請權限，請聯絡系統管理員';
  const NOT_SET = '即時口譯尚未設定，請聯絡系統管理員';
  const CLOSED = {4401: '登入已失效，口譯已停止', 4403: NO_ACCESS, 4400: '不支援這個輸出語言', 4503: NOT_SET};
  const store = {get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} }};
  let cfg = null, ws = null, ctx = null, gain = null, nextPlay = 0, text = '', sent = '', closing = null, savedId = null, handlers = {};
  let targetMarkup = null, chosenTarget = store.get('yq-interpret-target');

  const ready = fetch('/api/interpret/config').then(r => r.ok ? r.json() : null).catch(() => null).then(c => {
    cfg = c;
    const button = $('modeInterpret');
    button.dataset.locked = usable() ? '' : '1';
    button.disabled = !usable();
    button.title = usable() ? '說話後直接聽到譯音、看到譯文' : reason();
    return cfg;
  });
  function usable() { return !!(cfg && cfg.allowed && cfg.configured); }
  function reason() { return !cfg ? '暫時無法確認口譯權限' : !cfg.configured ? NOT_SET : !cfg.allowed ? NO_ACCESS : ''; }

  // Entering or leaving the mode: the output languages are the interpreter's, and 中日雙向 is not offered.
  function activate(on) {
    const target = $('targetLanguage'), pair = $('language').querySelector('option[value="zh_ja"]');
    if (on) {
      if (targetMarkup === null) targetMarkup = target.innerHTML;
      window.InterpretLangs.fill(target, cfg?.targets, chosenTarget || target.value);
      if (pair) pair.disabled = true;
      if ($('language').value === 'zh_ja') $('language').value = 'zh';
    } else if (targetMarkup !== null) {
      const keep = target.value;
      target.innerHTML = targetMarkup; targetMarkup = null;
      if ([...target.options].some(o => o.value === keep && !o.hidden)) target.value = keep;
      if (pair) pair.disabled = false;
    }
    const play = store.get('yq-interpret-play');
    $('interpretPlay').checked = play === null ? true : play === '1';
  }
  $('targetLanguage').addEventListener('change', () => { if (targetMarkup !== null) { chosenTarget = $('targetLanguage').value; store.set('yq-interpret-target', chosenTarget); } });
  $('interpretPlay').addEventListener('change', () => {
    // Only the volume: the interpreted speech is still saved. Speech already scheduled goes quiet too.
    if (gain) { gain.gain.cancelScheduledValues(0); gain.gain.value = $('interpretPlay').checked ? 1 : 0; }
    store.set('yq-interpret-play', $('interpretPlay').checked ? '1' : '0');
  });

  // Opens /ws/interpret; resolves when the service is connected, rejects with the reason it was not.
  function start({target, sourceLang, onText, onError, onEnd}) {
    handlers = {onText, onError, onEnd}; text = sent = ''; savedId = null; closing = null;
    ctx = new AudioContext({sampleRate: RATE});
    gain = ctx.createGain(); gain.gain.value = $('interpretPlay').checked ? 1 : 0; gain.connect(ctx.destination);
    nextPlay = ctx.currentTime;
    return new Promise((resolve, reject) => {
      let connected = false;
      ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/interpret`);
      ws.onopen = () => ws.send(JSON.stringify({target, sourceLang}));
      ws.onmessage = e => {
        let ev; try { ev = JSON.parse(e.data); } catch { return; }
        if (ev.type === 'status' && ev.state === 'connected') { connected = true; resolve(); }
        else if (ev.type === 'status' && ev.state === 'closed') savedId = ev.saved || null;
        else if (ev.type === 'error') handlers.onError?.(ev.message);
        else if (ev.type === 'out') { text += ev.delta; handlers.onText?.(text); }
        else if (ev.type === 'audio') play(ev.audio);
      };
      ws.onclose = e => {
        const why = CLOSED[e.code] || ([4408, 4413, 4429].includes(e.code) && e.reason) || (e.code === 1011 ? '口譯連線中斷了，已停止並存下目前的內容' : '');
        ws = null;
        if (!connected) { reject(new Error(why || '連不上口譯服務，請稍後再試')); return; }
        if (closing) closing(savedId); else handlers.onEnd?.(why, savedId);   // the server ended it: app.js stops the session
      };
    });
  }
  function play(b64) {
    const bin = atob(b64), f = new Float32Array(bin.length / 2);
    for (let i = 0; i < f.length; i++) f[i] = ((bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8)) << 16 >> 16) / 0x8000;
    const buf = ctx.createBuffer(1, f.length, RATE); buf.copyToChannel(f, 0);
    const s = ctx.createBufferSource(); s.buffer = buf; s.connect(gain);
    const at = Math.max(ctx.currentTime, nextPlay); s.start(at); nextPlay = at + f.length / RATE;
  }
  // The captured audio (any rate) as 24 kHz PCM16, linear interpolation.
  function feed(data, rate) {
    if (!ws || ws.readyState !== 1) return;
    const n = Math.floor(data.length * RATE / rate), pcm = new Int16Array(n), step = rate / RATE;
    for (let i = 0; i < n; i++) { const x = i * step, j = Math.floor(x), a = x - j, v = data[j] * (1 - a) + (data[j + 1] ?? data[j]) * a;
      pcm[i] = Math.max(-1, Math.min(1, v)) * 0x7fff; }
    ws.send(pcm.buffer);
  }
  // Only the change of the settled source text: keep the first `keep` characters of what was sent, then `text`.
  function source(shown) {
    if (!ws || ws.readyState !== 1 || shown === sent) return;
    let keep = 0;
    while (keep < sent.length && keep < shown.length && sent[keep] === shown[keep]) keep++;
    ws.send(JSON.stringify({type: 'source', keep, text: shown.slice(keep)}));
    sent = shown;
  }
  // Ends the session; resolves with the saved record's id (null when nothing was saved or no answer came).
  function stop() {
    const finish = () => { try { ctx?.close(); } catch {} ctx = gain = null; };
    if (!ws) { finish(); return Promise.resolve(savedId); }
    return new Promise(resolve => {
      const timer = setTimeout(() => { closing = null; try { ws?.close(); } catch {} finish(); resolve(savedId); }, 15000);
      closing = id => { clearTimeout(timer); closing = null; finish(); resolve(id); };
      if (ws.readyState === 1) ws.send(JSON.stringify({type: 'stop'})); else ws.close();
    });
  }
  window.InterpretMode = {ready, usable, reason, activate, start, feed, source, stop, sentSource: () => sent,
    volume: () => gain ? gain.gain.value : null};   // for the browser checks: 0 while 同步播放譯音 is off
})();
