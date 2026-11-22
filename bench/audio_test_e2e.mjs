// microphone-access "Audio test result is always visible" (audio-test-feedback): the 測試音源 button shows whether
// sound arrives, for the microphone and for tab audio, and says so when nothing arrives for 5 seconds. A fake
// microphone stands in for the real one; tab audio is the fake microphone handed out by getDisplayMedia, and a silent
// source is an AudioContext stream with nothing connected. No meeting is started, so nothing is stored.
// Usage: YUQIAO_SESSION=… node bench/audio_test_e2e.mjs [app url]   (AUDIO_TEST_SHOTS=<folder> also saves screenshots)
import {homedir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

const app = process.argv[2] || 'http://localhost:18082/';
const shots = process.env.AUDIO_TEST_SHOTS || '';
const modulePath = process.env.PLAYWRIGHT_MODULE || join(homedir(), '.claude/skills/gstack/node_modules/playwright/index.js');
const {chromium} = (await import(pathToFileURL(modulePath).href)).default;
const browser = await chromium.launch({args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']});
const t = (name, got, want) => {const ok = JSON.stringify(got) === JSON.stringify(want); console.log(ok ? 'ok  ' : 'FAIL', name, JSON.stringify(got)); if (!ok) process.exitCode = 1};

// silent: the sources give silence; window.__tone() later connects a tone to them (sound after a silent start).
// noFrames: requestAnimationFrame never calls back, as on a page in the background (sharing a tab brings it forward).
async function open({silent = false, width = 1280, noFrames = false} = {}) {
  const context = await browser.newContext({permissions: ['microphone'], viewport: {width, height: 900}});
  await context.addCookies([{name: 'yq_session', value: process.env.YUQIAO_SESSION, url: app}]);
  const page = await context.newPage();
  await page.addInitScript(({silent, noFrames}) => {
    const devices = navigator.mediaDevices, realUser = devices.getUserMedia.bind(devices);
    const outs = [];
    window.__tone = () => outs.forEach(({ctx, out}) => { const tone = ctx.createOscillator(); tone.connect(out); tone.start(); });
    const quiet = () => { const ctx = new AudioContext(), out = ctx.createMediaStreamDestination(); outs.push({ctx, out}); return out.stream; };
    devices.getDisplayMedia = async () => silent ? quiet() : realUser({audio: true});   // tab audio: the fake microphone
    if (silent) devices.getUserMedia = async () => quiet();
    if (noFrames) { window.requestAnimationFrame = () => 0; window.cancelAnimationFrame = () => {}; }
  }, {silent, noFrames});
  await page.goto(app);
  await page.waitForTimeout(1200);
  return {context, page};
}
const status = page => page.evaluate(() => {
  const el = document.getElementById('micStatus');
  return {text: el.textContent, visible: el.offsetWidth > 0 && el.offsetHeight > 0, inButton: !!el.closest('#testMic'), error: el.classList.contains('error')};
});
const source = (page, value) => page.evaluate(value => { const el = document.getElementById('audioSource'); el.value = value; el.dispatchEvent(new Event('change')); }, value);

{
  const {context, page} = await open();
  await page.click('#testMic'); await page.waitForTimeout(2500);
  const s = await status(page);
  t('microphone: status visible inside the 測試音源 button', [s.visible, s.inButton], [true, true]);
  t('microphone: 訊號正常', s.text.startsWith('訊號正常'), true);
  t('microphone: no status under the microphone selector', await page.evaluate(() => !!document.querySelector('.mic-field #micStatus')), false);
  if (shots) await page.locator('#testMic').screenshot({path: join(shots, 'test-mic-1280.png')});
  await page.click('#testMic');
  await context.close();
}
{
  const {context, page} = await open();
  await source(page, 'system');
  const before = await status(page);
  t('tab audio, not tested yet: status visible', [before.visible, before.text], [true, '尚未連接分享音訊']);
  await page.click('#testMic'); await page.waitForTimeout(2500);
  const s = await status(page);
  t('tab audio: status visible inside the button', [s.visible, s.inButton], [true, true]);
  t('tab audio: 訊號正常', s.text.startsWith('訊號正常'), true);
  t('tab audio: the level meter moves', await page.evaluate(() => document.getElementById('micTestLevel').style.transform !== 'scaleX(0.03)'), true);
  if (shots) await page.screenshot({path: join(shots, 'test-tab-1280.png'), clip: await page.locator('.controls').boundingBox()});
  await page.click('#testMic');
  await context.close();
}
for (const [value, want] of [['microphone', '還沒收到聲音：請對麥克風說話，或換一個麥克風來源'], ['system', '還沒收到聲音：請確認分享時勾選了分享音訊，且正在播放'], ['mixed', '還沒收到聲音：請確認分享時勾選了分享音訊，且正在播放']]) {
  const {context, page} = await open({silent: true});
  await source(page, value);
  await page.click('#testMic');
  await page.waitForTimeout(3000);
  t(`silent ${value}: not reported before 5 s`, (await status(page)).text.startsWith('還沒收到聲音'), false);
  await page.waitForTimeout(2500);
  const s = await status(page);
  t(`silent ${value}: 還沒收到聲音 with advice, error style, visible`, [s.text, s.error, s.visible], [want, true, true]);
  await page.click('#testMic');
  await context.close();
}
{
  // Review of audio-test-feedback: the page in the background (no animation frames) still sees the shared tab's sound.
  const {context, page} = await open({noFrames: true});
  await source(page, 'system');
  await page.click('#testMic'); await page.waitForTimeout(5800);
  const s = await status(page);
  t('background page: sound is still noticed, no false 還沒收到聲音', [s.text.startsWith('訊號正常'), s.error], [true, false]);
  await page.click('#testMic');
  await context.close();
}
{
  // Silent at first, then sound: the notice goes back to 訊號正常, written once (not on every frame).
  const {context, page} = await open({silent: true});
  await source(page, 'system');
  await page.click('#testMic'); await page.waitForTimeout(5500);
  t('silent first: 還沒收到聲音', (await status(page)).text.startsWith('還沒收到聲音'), true);
  await page.evaluate(() => { window.__writes = 0; new MutationObserver(list => { window.__writes += list.length; }).observe(document.getElementById('micStatus'), {childList: true, characterData: true, subtree: true}); window.__tone(); });
  await page.waitForTimeout(1500);
  const s = await status(page);
  t('then sound: back to 訊號正常, not in the error style', [s.text.startsWith('訊號正常'), s.error], [true, false]);
  t('the status text was written once, not on every frame', await page.evaluate(() => window.__writes), 1);
  await page.click('#testMic');
  await context.close();
}
if (shots) for (const width of [1000, 390]) {
  const {context, page} = await open({width});
  await source(page, 'system');
  if (width === 390) await page.evaluate(() => document.querySelector('[data-mobile-settings], #mobileSettings, .mobile-settings-button')?.click());
  await page.waitForTimeout(400);
  await page.click('#testMic'); await page.waitForTimeout(2500);
  await page.screenshot({path: join(shots, `test-tab-${width}.png`), clip: await page.locator(width === 390 ? '#testMic' : '.controls').boundingBox()});
  const s = await status(page);
  t(`width ${width}: status visible`, s.visible, true);
  await page.click('#testMic');
  await context.close();
}
await browser.close();
