// faster-meeting-end in a real browser (Playwright, gstack's install). The meeting and its stream are answered by the test:
// the stream closes 2 s after the page's end of stream, as when the last sentences are still being settled.
//   - while it closes, 結束會議 reads 結束中… and is disabled; with 精準模式 the status reads 正在完成最後幾句…
//   - once closed the button is back and enabled
// Usage: YUQIAO_SESSION=<session of a user in a team> node bench/meeting_end_e2e.mjs [app url]
import {homedir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

const app = (process.argv[2] || 'http://localhost:18082/').replace(/\/$/, '');
const modulePath = process.env.PLAYWRIGHT_MODULE || join(homedir(), '.claude/skills/gstack/node_modules/playwright/index.js');
const {chromium} = (await import(pathToFileURL(modulePath).href)).default;
const browser = await chromium.launch({args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']});
const t = (name, got, want) => {const ok = JSON.stringify(got) === JSON.stringify(want); console.log(ok ? 'ok  ' : 'FAIL', name, JSON.stringify(got)); if (!ok) process.exitCode = 1};
const json = body => ({status: 200, contentType: 'application/json', body: JSON.stringify(body)});

for (const quality of [false, true]) {
  const context = await browser.newContext({viewport: {width: 1440, height: 900}});
  await context.addCookies([{name: 'yq_session', value: process.env.YUQIAO_SESSION, url: app + '/'}]);
  const page = await context.newPage();
  await page.route(`${app}/api/config`, async route => { const real = await (await route.fetch()).json(); route.fulfill(json({...real, quality})); });
  await page.route(`${app}/api/meetings`, route => route.request().method() === 'POST' ? route.fulfill(json({id: 'm-meeting-end'})) : route.continue());
  await page.route(`${app}/api/meetings/m-meeting-end/**`, route => route.fulfill(json({saved: 1})));
  await page.routeWebSocket('**/ws/transcribe', ws => ws.onMessage(message => {
    if (typeof message !== 'string') return;
    if (message === 'YOUDAO_ONETIME_ASR_STREAM_EOS') {
      setTimeout(() => { if (quality) ws.send(JSON.stringify({quality: {seq: 1, throughMs: 3000, final: true, sentences: []}, audioMs: 3000})); ws.close(); }, 2000);
      return;
    }
    ws.send(JSON.stringify({msg: {text: '大家好。', speech_end: true}, displayText: '大家好。', audioMs: 2000}));
  }));
  await page.goto(app + '/');
  await page.evaluate(() => localStorage.setItem('liveMode', 'meeting'));
  await page.reload(); await page.waitForLoadState('networkidle');
  if (quality) await page.evaluate(() => { const q = document.getElementById('quality'); if (!q.checked) q.click(); });
  await page.click('#start');
  await page.waitForFunction(() => document.getElementById('start').classList.contains('stop'));
  await page.waitForTimeout(800);
  await page.click('#start');
  await page.waitForTimeout(400);
  const during = await page.evaluate(() => ({label: document.querySelector('#start .button-copy b').textContent, disabled: document.getElementById('start').disabled,
    status: document.querySelector('#status span').textContent}));
  const name = quality ? '精準模式' : '一般';
  t(`${name}: while closing the button says 結束中… and is disabled`, [during.label, during.disabled], ['結束中…', true]);
  if (quality) t(`${name}: the status says the last sentences are being finished`, during.status, '正在完成最後幾句…');
  await page.waitForFunction(() => !document.getElementById('start').classList.contains('stop'), null, {timeout: 15000});
  const after = await page.evaluate(() => ({label: document.querySelector('#start .button-copy b').textContent, disabled: document.getElementById('start').disabled}));
  t(`${name}: once closed the button is back`, [after.label, after.disabled], ['開始會議', false]);
  await context.close();
}
await browser.close();
