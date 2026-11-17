/* 我的紀錄 (interpret-mode-on-home): the user's own saved 即時翻譯 and 即時口譯 sessions — list, waveform, replay from
   any point, download, delete. Sessions are run from the live page; nothing is recorded here. Replay plays the saved
   input.wav and output.wav from the server (Range requests), so a session of hours is never held in memory. */
(function () {
  const $ = id => document.getElementById(id);
  const WINDOW = 30, BAR = 0.1;   // the canvas shows 30 s; one bar per 100 ms
  const name = code => window.InterpretLangs.name(code);
  const KIND = {translate: '即時翻譯', interpret: '即時口譯'};
  const store = {get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} }};

  let inBars = [], outBars = [], seconds = 0, players = null, replaying = null, scrub = null, drawLeft = 0, replayMode = 'both';
  let chosenMode = 'both';   // the last button the user used; a 即時翻譯 record shows 原音 without changing it
  let currentId = null, current = null;

  const fmt = s => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
  function showError(message) { $('error').textContent = message; $('error').hidden = !message; }
  function showLoaded(text) { $('loaded').textContent = text; $('loaded').hidden = !text; }
  $('themeToggle').onclick = () => { const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next; store.set('interpreter-theme', next); };

  function finishSession() {
    const interpreting = current && current.kind !== 'translate';
    $('replayOut').disabled = !players || !interpreting || !outBars.length;
    $('replayBoth').disabled = !players || !interpreting;
    $('replayIn').disabled = !players || !inBars.length;
  }
  function resetSession() {
    stopReplay(); players = null; current = null;
    inBars = []; outBars = []; seconds = 0;
    $('srcEngine').textContent = '';
    for (const id of ['srcText', 'outText']) $(id).replaceChildren(Object.assign(document.createElement('span'), {className: 'hint', textContent: '按「載入」顯示紀錄。'}));
    $('sent').textContent = '0:00.0'; $('cost').textContent = '$0.000'; $('outLen').textContent = '0.0 秒';
    finishSession(); currentId = null; showLoaded(''); markCurrent();
  }

  // --- Replay: both tracks on the session clock; the playhead is the furthest of the playing tracks.
  const MODE_BUTTON = {both: 'replayBoth', out: 'replayOut', in: 'replayIn'};
  const sessionEnd = () => Math.max(seconds, outBars.length ? outBars[outBars.length - 1].t + BAR : 0, 0);
  const playheadAt = () => replaying ? Math.max(replaying.from, ...replaying.els.map(el => el.currentTime || 0)) : 0;
  function setMode(kind) { replayMode = kind; for (const [k, id] of Object.entries(MODE_BUTTON)) $(id).classList.toggle('mode', k === kind); }
  function replay(kind, from = 0) {
    stopReplay();
    if (!players || $(MODE_BUTTON[kind]).disabled) return;
    setMode(kind); chosenMode = kind;
    const els = [...(kind !== 'out' ? [players.in] : []), ...(kind !== 'in' && players.out ? [players.out] : [])];
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
  // current mode (the mode of the playback under way, or the last button used; 整段 when none was, 原音 for 即時翻譯).
  const wave = $('wave');
  const timeAt = e => { const r = wave.getBoundingClientRect(), pad = 24;
    return Math.max(0, Math.min(scrub.left + (e.clientX - r.left - pad) / (r.width - 2 * pad) * WINDOW, sessionEnd())); };
  wave.onpointerdown = e => {
    if (!players) return;
    let kind = replaying ? replaying.kind : replayMode;
    if ($(MODE_BUTTON[kind]).disabled) kind = 'in';
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
    const total = players ? sessionEnd() : 0;
    const now = scrub ? scrub.at : replaying ? playheadAt() : total;
    // Replay follows the playhead; while dragging the view holds still so the line stays under the pointer.
    const left = scrub ? scrub.left : replaying ? Math.max(0, now - WINDOW * 0.85) : Math.max(0, total - WINDOW * 0.95);
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
    if (players && (replaying || scrub || total > 0)) {
      g.strokeStyle = css.getPropertyValue(replaying || scrub ? '--danger' : '--text'); g.lineWidth = 1.5 * dpr;
      g.beginPath(); g.moveTo(x(now), 8 * dpr); g.lineTo(x(now), H - 8 * dpr); g.stroke();
    }
    requestAnimationFrame(draw);
  }

  // --- The list
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
      const link = (label, file) => Object.assign(document.createElement('a'), {textContent: label, href: `/api/interpret/sessions/${s.id}/${file}`, download: ''});
      acts.append(btn('載入', () => loadSession(s.id)), link('原音', 'input.wav'), s.kind === 'translate' ? '' : link('譯音', 'output.wav'),
        link('文字', 'transcript.txt'), btn('刪除', () => removeSession(s.id), 'danger'));
      const engine = s.engine === 'mai' ? '・雲端' : s.engine === 'local' ? '・本機' : '';
      tr.append(td(s.startedAt, 'when'), td(KIND[s.kind] || KIND.interpret, 'kind'), td(`${name(s.sourceLang)}${engine} → ${name(s.target)}`, 'langs'),
        td(fmt(s.inputSeconds || 0), 'length'), td(`$${(s.usd || 0).toFixed(4)}`, 'cost'), what, acts);
      what.classList.add('what');
      return tr;
    }));
    markCurrent();
  }
  async function loadSession(id) {
    stopReplay(); showError('');
    const base = `/api/interpret/sessions/${encodeURIComponent(id)}`;
    const get = url => fetch(url).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); });
    let meta, bars;
    try { [meta, bars] = await Promise.all([get(base), get(`${base}/bars`)]); }
    catch { showError('這筆紀錄已不存在或讀取失敗。'); loadHistory().catch(() => {}); return; }
    resetSession();
    current = meta;
    const box = $('srcText');
    box.textContent = meta.sourceText || '';
    if (!meta.sourceText) box.replaceChildren(Object.assign(document.createElement('span'), {className: 'hint', textContent: '這筆紀錄沒有原文。'}));
    $('outText').textContent = meta.translation || '';
    $('srcEngine').textContent = meta.engine === 'mai' ? '（雲端辨識）' : meta.engine === 'local' ? '（本機辨識）' : '';
    $('cost').textContent = `$${(meta.usd || 0).toFixed(4)}`;
    $('outLen').textContent = `${(meta.outputSeconds || 0).toFixed(1)} 秒`;
    showLoaded(`目前顯示：${KIND[meta.kind] || KIND.interpret}・${meta.startedAt}（${name(meta.sourceLang)} → ${name(meta.target)}）`);
    inBars = (bars.input || []).map((v, i) => ({t: i * BAR, v}));
    outBars = (bars.output || []).map(([t, v]) => ({t, v}));
    seconds = meta.inputSeconds || 0;
    $('sent').textContent = fmt(seconds);
    players = {in: new Audio(`${base}/input.wav`), out: meta.kind === 'translate' ? null : new Audio(`${base}/output.wav`)};
    for (const el of Object.values(players)) if (el) el.preload = 'metadata';
    setMode(meta.kind === 'translate' ? 'in' : chosenMode);
    currentId = id;
    finishSession(); markCurrent();
  }
  async function removeSession(id) {
    if (!confirm(`刪除 ${id} 的錄音與文字？刪除後無法復原。`)) return;
    const response = await fetch(`/api/interpret/sessions/${encodeURIComponent(id)}`, {method: 'DELETE'});
    if (!response.ok) { showError('刪除失敗，請再試一次。'); return; }
    if (currentId === id) resetSession();
    loadHistory();
  }

  setMode('both');
  resetSession();
  fetch('/api/interpret/config').then(r => r.ok ? r.json() : null).then(cfg => {
    if (cfg && cfg.retentionDays) $('retention').textContent = `紀錄保存 ${cfg.retentionDays} 天，到期自動刪除。`;
  }).catch(() => {});
  loadHistory().then(() => {
    const wanted = new URLSearchParams(location.search).get('id');   // 在我的紀錄開啟, from the live page
    if (wanted) loadSession(wanted);
  }).catch(() => {});
  requestAnimationFrame(draw);
  window.Interpret = {state: () => ({replaying: replaying && {kind: replaying.kind, at: playheadAt()}, replayMode, scrub,
    inBars: inBars.length, outBars: outBars.length, players: !!players, current: currentId})};
})();
