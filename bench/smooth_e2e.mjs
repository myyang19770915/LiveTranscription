// How steady the live surfaces are while a recorded meeting plays into the real page: the two panes, the floating
// subtitles (the Picture-in-Picture document, here inside an iframe of the same size) and 畫面＋字幕 (the overlay box,
// over a canvas picture). Every animation frame the visible text of each surface is compared with the frame before:
//   moved     px that text already on screen moved, summed (per minute in the report), and how often it moved
//   fast      frames in which it moved more than 12 px (a smooth move takes many small steps)
//   jumps     frames in which it moved 30 px or more: about a line of text at once
//   reversals moves in the opposite direction within 1.5 s of the last one (up, then down again): jitter
//   replaced  times text on screen was replaced by other text in the same place (not at the growing end)
//   erased    characters of shown text that were taken back (a rewrite that is not an append)
// Usage: YUQIAO_SESSION=… node bench/smooth_e2e.mjs TRACK.json [--seconds 120] [--quality] [--target zh] [--language en]
//        [--shots DIR] [--source] [--app http://localhost:18082/]
import {readFileSync, mkdirSync} from 'node:fs';
import {homedir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const args = process.argv.slice(2), flag = name => args.includes(`--${name}`), option = (name, fallback) => args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback;
const trackPath = args[0], seconds = Number(option('seconds', 120)), app = option('app', 'http://localhost:18082/'), shots = option('shots', '');
const here = dirname(fileURLToPath(import.meta.url));
const modulePath = process.env.PLAYWRIGHT_MODULE || join(homedir(), '.claude/skills/gstack/node_modules/playwright/index.js');
const {chromium} = (await import(pathToFileURL(modulePath).href)).default;
const inject = readFileSync(join(here, '../webapp/replay_inject.js'), 'utf8');
const track = JSON.parse(readFileSync(trackPath, 'utf8')).filter(event => event.t <= seconds + 90);

const browser = await chromium.launch();
const context = await browser.newContext({viewport: {width: 1440, height: 900}});
await context.addCookies([{name: 'yq_session', value: process.env.YUQIAO_SESSION, url: app}]);
const page = await context.newPage();
page.on('pageerror', error => console.error('pageerror:', error.message));
// The floating window: an iframe of the window's default size stands in for the Picture-in-Picture window.
await page.addInitScript(() => {
  Object.defineProperty(window, 'documentPictureInPicture', {configurable: true, value: {requestWindow: async ({width, height}) => {
    const frame = document.createElement('iframe');
    frame.id = 'pipFrame'; frame.style.cssText = `position:fixed;left:0;top:0;width:${width}px;height:${height}px;border:0;z-index:999`;
    document.body.append(frame);
    return frame.contentWindow;
  }}});
});
await page.goto(app);
await page.evaluate(async () => { const {teams} = await window.accountReady; if (teams[0]) $('team').value = String(teams[0].id); });
await page.evaluate(config => { window.__replayConfig = config; }, {track, duration: seconds, language: option('language', 'en'), target: option('target', 'zh'), context: '', live: true, quality: flag('quality')});
await page.evaluate(inject);
await page.evaluate(async showSource => {
  localStorage.setItem('subtitles', JSON.stringify({source: showSource, size: 2}));
  Subtitles.setSettings({source: showSource});
  await Subtitles.open();
  // 畫面＋字幕 needs a picture: a canvas stands in for the shared tab.
  const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360; canvas.getContext('2d').fillRect(0, 0, 640, 360);
  Overlay.setTrack(canvas.captureStream(1).getVideoTracks()[0]); Overlay.open();

  const surfaces = {}, at = () => performance.now();
  const S = name => (surfaces[name] ??= {updates: 0, moved: 0, moves: 0, fast: 0, jumps: 0, reversals: 0, replaced: 0, erased: 0, direction: 0, movedAt: -1e9, text: null, tops: new Map()});
  // Text that only grows at its end is an append; anything else took shown characters back.
  function text(name, value) {
    const s = S(name);
    if (s.text !== null && value !== s.text) {
      s.updates++;
      let same = 0; const limit = Math.min(value.length, s.text.length);
      while (same < limit && value[same] === s.text[same]) same++;
      if (same < s.text.length) s.erased += s.text.length - same;
    }
    s.text = value;
  }
  // items: [key, top] of the pieces of text on screen. The same key at another top moved; a key that is gone while
  // pieces above and below it are still there was replaced.
  function places(name, items) {
    const s = S(name), now = new Map(items);
    let shift = 0;
    let mover = '';
    for (const [key, top] of now) if (s.tops.has(key) && Math.abs(top - s.tops.get(key)) > Math.abs(shift)) { shift = top - s.tops.get(key); mover = key; }
    if (Math.abs(shift) > 0.5) {
      s.moved += Math.abs(shift); s.moves++;
      (s.log ??= []).push([Math.round(at()), Math.round(shift), mover]);
      if (Math.abs(shift) > 12) s.fast++;
      if (Math.abs(shift) >= 30) s.jumps++;
      if (s.direction && Math.sign(shift) !== s.direction && at() - s.movedAt < 1500) s.reversals++;
      s.direction = Math.sign(shift); s.movedAt = at();
    }
    const before = [...s.tops.keys()], last = before.findLastIndex(key => now.has(key));
    s.replaced += before.slice(0, Math.max(0, last)).filter((key, i) => i > 0 && !now.has(key)).length;
    s.tops = now;
  }
  // The y of every line of a pane, keyed by the line's text position: lines of text that stay must stay where they are.
  function paneLines(el) {
    const doc = el.ownerDocument, range = doc.createRange(), out = [], box = el.getBoundingClientRect();
    const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      // Text is on screen only inside every frame around it that cuts off what is outside (the speech now, the draft).
      const frames = [box];
      for (let up = node.parentElement; up && up !== el; up = up.parentElement) if (doc.defaultView.getComputedStyle(up).overflowY !== 'visible') frames.push(up.getBoundingClientRect());
      for (let i = 0; i < node.length; i += 20) {   // one probe every 20 characters of each piece of text
        range.setStart(node, i); range.setEnd(node, Math.min(node.length, i + 1));
        const r = range.getBoundingClientRect();
        if (r.height && frames.every(frame => r.bottom > frame.top + 1 && r.top < frame.bottom - 1)) out.push([`${i}:${node.data.slice(i, i + 10)}`, Math.round(r.top - box.top)]);
      }
    }
    return out;
  }
  function frame() {
    const pip = document.getElementById('pipFrame')?.contentDocument, body = pip?.querySelector('.sub-body');
    if (body) {
      places('floating', paneLines(body));
      text('floating draft', pip.querySelector('.sub-draft').textContent);
      text('floating now', pip.querySelector('.sub-now').textContent);
    }
    const box = document.querySelector('.overlay-subs');
    if (box) {
      text('overlay draft', box.querySelector('.ov-draft').textContent);
      text('overlay now', box.querySelector('.ov-now').textContent);
      places('overlay', paneLines(box.querySelector('.ov-body')));
      const s = S('overlay box'), h = box.offsetHeight; if (s.height && s.height !== h) s.updates++; s.height = h;
    }
    for (const id of ['transcript', 'translation']) { const el = document.getElementById(id); places(`pane ${id}`, paneLines(el)); text(`pane ${id}`, el.textContent); }
    requestAnimationFrame(frame);
  }
  window.__smooth = surfaces;
  requestAnimationFrame(frame);
}, flag('source'));
await page.evaluate(() => { startMeeting(); });   // 畫面＋字幕 covers the button
if (shots) mkdirSync(shots, {recursive: true});
const began = Date.now();
for (let i = 0; (Date.now() - began) / 1000 < seconds; i++) {
  await page.waitForTimeout(1000);
  if (shots && i >= 20 && i < 20 + Number(option('frames', 24))) {
    await page.locator('.overlay-subs').screenshot({path: join(shots, `overlay_${String(i).padStart(3, '0')}.png`)});
    await page.locator('#pipFrame').screenshot({path: join(shots, `floating_${String(i).padStart(3, '0')}.png`)});
  }
}
const minutes = seconds / 60, result = await page.evaluate(() => Object.fromEntries(Object.entries(window.__smooth).map(([name, s]) => [name, {updates: s.updates, moved: Math.round(s.moved), moves: s.moves, fast: s.fast, jumps: s.jumps, reversals: s.reversals, replaced: s.replaced, erased: s.erased}])));
console.log(`surface                 updates/min  moved px/min  moves/min   fast/min  jumps/min  reversals/min  replaced/min  erased chars/min`);
for (const [name, s] of Object.entries(result)) {
  const per = value => value === undefined ? '-' : (value / minutes).toFixed(1);
  console.log(`${name.padEnd(24)}${per(s.updates).padStart(10)}${per(s.moved).padStart(14)}${per(s.moves).padStart(11)}${per(s.fast).padStart(11)}${per(s.jumps).padStart(11)}${per(s.reversals).padStart(15)}${per(s.replaced).padStart(14)}${per(s.erased).padStart(18)}`);
}
if (option('log', '')) console.log(JSON.stringify(await page.evaluate(name => window.__smooth[name].log, option('log', ''))));
console.log(JSON.stringify(result));
await browser.close();
