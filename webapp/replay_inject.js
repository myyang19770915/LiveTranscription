/* Injected by replay_browser.py into the live page. Plays a recorded ASR event track
   (from replay_asr.py --speed 1) into the real onMessage handler at its original timing,
   so segmentation, translation scheduling and rendering run unmodified without audio.
   At the end of the audio it presses stop; events recorded after EOS are delivered after
   the UI sends EOS, as the gateway would. Every translation render is logged.
   Expects window.__replayConfig = {track: [{t, raw}], duration, language, target, context}. */
(() => {
  const cfg = window.__replayConfig, log = [], requests = [];
  const t0 = () => performance.now() - window.__replay.startedAt;
  window.__replay = {log, requests, done: false, startedAt: performance.now()};
  $('language').value = cfg.language; updateTranslationDirection();
  if (cfg.target && cfg.language !== 'zh_ja') { $('targetLanguage').value = cfg.target; updateTranslationDirection(); }
  if (cfg.context) $('context').value = cfg.context;
  if (cfg.cloudRefine) { $('cloudRefineRow').hidden = false; $('cloudRefine').checked = true; }

  class TrackSocket {
    constructor(track) { this.track = track; this.i = 0; this.readyState = 1; this.closeListeners = []; }
    addEventListener(type, fn) { if (type === 'close') this.closeListeners.push(fn); }
    removeEventListener(type, fn) { if (type === 'close') this.closeListeners = this.closeListeners.filter(f => f !== fn); }
    deliver(until, onDone) {
      const base = performance.now(), offset = this.track[this.i]?.t ?? 0;
      const step = () => {
        const now = (performance.now() - base) / 1000 + (until === Infinity ? offset : 0);
        // A closed WebSocket delivers nothing more; the UI's stop timeout must lose the tail here too.
        if (this.readyState === 3) return onDone();
        while (this.i < this.track.length && this.track[this.i].t <= until && this.track[this.i].t <= now) this.onmessage?.({data: this.track[this.i++].raw});
        if (this.i < this.track.length && this.track[this.i].t <= until) setTimeout(step, 20); else onDone();
      };
      step();
    }
    send(data) {
      if (data !== EOS || this.readyState !== 1) return;
      this.deliver(Infinity, () => setTimeout(() => this.close(), 100));
    }
    close() {
      if (this.readyState === 3) return;
      this.readyState = 3; this.closeListeners.forEach(fn => fn()); this.onclose?.();
    }
  }

  window.startMeeting = async () => {
    // --save-meeting: store the replay as a real meeting (segments only, no recording) for the review page.
    if (cfg.saveMeeting) { meetingId = await createMeeting(Number($('team').value)); resetMeetingState(); }
    socket = new TrackSocket(cfg.track); socket.onmessage = onMessage;
    stream = {replay: true}; captureStreams = [];
    startedAt = Date.now(); timerHandle = setInterval(updateTimer, 1000);
    $('start').innerHTML = stopButtonContent; $('start').classList.add('stop'); setControls(true); setStatus('即時轉錄中', 'live');
    window.__replay.startedAt = performance.now();
    socket.deliver(cfg.duration, () => { window.__replay.audioEnded = Math.round(t0()); stopMeeting(); });
  };
  const originalRender = window.renderTranslation;
  window.renderTranslation = function () {
    originalRender.apply(this, arguments);
    const last = log.at(-1), row = {t: Math.round(t0()), offset: translationOffset, transcriptLen: transcript.length, translated, draft: draftText};
    if (!last || last.translated !== row.translated || last.draft !== row.draft) log.push(row);
  };
  const originalStream = window.streamTranslation;
  window.streamTranslation = async function (body, signal) {
    const started = Math.round(t0()), entry = {t: started, kind: body.draft ? 'draft' : 'final', source: body.text};
    requests.push(entry);
    try { const result = await originalStream(body, signal); entry.ms = Math.round(t0()) - started; entry.text = result.text; return result; }
    catch (error) { entry.ms = Math.round(t0()) - started; entry.error = error.name; throw error; }
  };
  const originalStop = window.stopMeeting;
  window.stopMeeting = async function () {
    await originalStop.apply(this, arguments);
    // Term learning and retroactive corrections finish after the last final; the report needs their result.
    const busy = () => activeTranslation || translationTimer || transcript.length > translationOffset || termRequest || correcting || correctionQueue.length;
    const settle = () => busy() ? setTimeout(settle, 500) : (window.__replay.done = true);
    setTimeout(settle, 500);
  };
})();
