// remember-setup-choices: every choice named in the live page's setup sentence is still there after a reload or 清除
// (meeting-setup-layout "The page remembers every sentence choice"). Chromium's fake devices give three microphones.
// Nothing is started: POST /api/meetings is blocked.
// Usage: YUQIAO_SESSION=… node bench/remember_setup_e2e.mjs [app url]
import {homedir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

const app = (process.argv[2] || 'http://localhost:18082/').replace(/\/$/, '');
const t = (name, got, want) => {const ok = JSON.stringify(got) === JSON.stringify(want); console.log(ok ? 'ok  ' : 'FAIL', name, JSON.stringify(got)); if (!ok) process.exitCode = 1};
const modulePath = process.env.PLAYWRIGHT_MODULE || join(homedir(), '.claude/skills/gstack/node_modules/playwright/index.js');
const {chromium} = (await import(pathToFileURL(modulePath).href)).default;
const browser = await chromium.launch({args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']});

async function open() {
  const context = await browser.newContext({permissions: ['microphone'], viewport: {width: 1440, height: 900}});
  await context.addCookies([{name: 'yq_session', value: process.env.YUQIAO_SESSION, url: app}]);
  await context.route('**/api/meetings**', route => route.request().method() === 'POST' ? route.abort() : route.continue());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(app + '/');
  await page.waitForTimeout(1500);
  return {context, page, errors};
}
const reload = async page => { await page.reload(); await page.waitForTimeout(1500); };
// As the sentence menu and the settings area do: set the control and fire its change event.
const choose = (page, id, value) => page.evaluate(([id, value]) => { const el = document.getElementById(id); el.value = value; el.dispatchEvent(new Event('change', {bubbles: true})); }, [id, value]);
const mode = async (page, name) => { await page.click(`.mode-btn[data-mode="${name}"]`); await page.waitForTimeout(200); };
const value = (page, id) => page.evaluate(id => document.getElementById(id).value, id);
const pressed = page => page.evaluate(() => document.querySelector('.mode-btn[aria-pressed="true"]')?.dataset.mode);
const word = (page, field) => page.evaluate(field => document.querySelector(`#setupSentence .sentence-pick[data-field="${field}"]`)?.textContent.trim() ?? null, field);
const sentence = page => page.evaluate(() => document.getElementById('setupSentence').textContent.trim());
const stored = (page, key) => page.evaluate(key => localStorage.getItem(key), key);
const store = (page, key, text) => page.evaluate(([key, text]) => localStorage.setItem(key, text), [key, text]);

{
  const {context, page, errors} = await open();
  const mics = await page.evaluate(() => [...document.getElementById('microphone').options].map(o => ({id: o.value, name: o.textContent})));
  t('three microphones are listed', mics.length, 3);

  // --- the audio source ---
  await choose(page, 'audioSource', 'system');
  const withSystem = await sentence(page);
  await reload(page);
  t('the audio source after a reload, named in the sentence', [await value(page, 'audioSource'), await sentence(page) === withSystem, withSystem.includes('麥克風')], ['system', true, false]);
  await choose(page, 'audioSource', 'microphone');
  await reload(page);
  t('back to the microphone after a reload', await value(page, 'audioSource'), 'microphone');

  // --- the microphone (this browser gives new device ids on every load, so here it comes back by its name) ---
  const micName = page => page.evaluate(() => document.getElementById('microphone').selectedOptions[0]?.textContent);
  const pickMic = (page, name) => page.evaluate(name => { const el = document.getElementById('microphone'); el.value = [...el.options].find(o => o.textContent === name).value; el.dispatchEvent(new Event('change', {bubbles: true})); }, name);
  await pickMic(page, mics[1].name);
  const micWord = await word(page, 'microphone');
  await reload(page);
  t('the microphone after a reload: the same one, its name in the sentence', [await micName(page), await word(page, 'microphone')], [mics[1].name, micWord]);
  await store(page, 'microphoneId', 'gone'); await store(page, 'microphoneLabel', 'No such microphone');
  await reload(page);
  t('the stored microphone is unplugged: the first one, and the stored choice is kept',
    [await micName(page), await stored(page, 'microphoneId'), await stored(page, 'microphoneLabel')], [mics[0].name, 'gone', 'No such microphone']);
  await pickMic(page, mics[2].name);
  await reload(page);
  t('choosing again stores the new microphone', [await micName(page), await stored(page, 'microphoneLabel')], [mics[2].name, mics[2].name]);

  // --- choices made in 即時翻譯 ---
  await mode(page, 'translate');
  await choose(page, 'language', 'en'); await choose(page, 'targetLanguage', 'ja');
  await reload(page);
  t('即時翻譯: mode, spoken language and 翻譯成 after a reload', [await pressed(page), await value(page, 'language'), await value(page, 'targetLanguage')], ['translate', 'en', 'ja']);
  await mode(page, 'meeting'); await mode(page, 'translate');
  t('即時翻譯: 翻譯成 after leaving the mode and coming back', await value(page, 'targetLanguage'), 'ja');

  // --- 翻譯成 by mode, row 1: 不翻譯 in 開會, 日文 in 即時翻譯 ---
  await mode(page, 'meeting');
  await choose(page, 'language', 'zh'); await choose(page, 'targetLanguage', 'none');
  await mode(page, 'translate');
  await choose(page, 'targetLanguage', 'ja');
  await reload(page);
  await mode(page, 'meeting');
  const inMeeting = await value(page, 'targetLanguage');
  await mode(page, 'translate');
  t('翻譯成 by mode: 不翻譯 in 開會, 日文 in 即時翻譯', [inMeeting, await value(page, 'targetLanguage')], ['none', 'ja']);

  // --- 清除 ---
  await mode(page, 'meeting');
  await choose(page, 'audioSource', 'mixed');
  const before = [await pressed(page), await value(page, 'language'), await value(page, 'targetLanguage'), await value(page, 'audioSource'), await micName(page), await value(page, 'team')];
  await page.click('#clear'); await page.waitForTimeout(1800);
  t('清除 keeps every choice', [await pressed(page), await value(page, 'language'), await value(page, 'targetLanguage'), await value(page, 'audioSource'), await micName(page), await value(page, 'team')], before);
  t('no page errors', errors, []);
  await context.close();
}
{
  // --- 翻譯成 by mode, row 2: 英文 in 開會, nothing chosen in 即時翻譯 ---
  const {context, page, errors} = await open();
  await choose(page, 'language', 'zh'); await choose(page, 'targetLanguage', 'en');
  await reload(page);
  const inMeeting = [await pressed(page), await value(page, 'targetLanguage')];
  await mode(page, 'translate');
  t('翻譯成 by mode: 英文 in 開會, nothing chosen in 即時翻譯', [inMeeting, await value(page, 'targetLanguage')], [['meeting', 'en'], 'en']);
  // The page's own adjustments are not choices: 即時口譯 has no 中日雙向, and that must not become the stored language.
  await mode(page, 'meeting');
  await choose(page, 'language', 'zh_ja');
  await mode(page, 'translate'); await mode(page, 'meeting');
  await reload(page);
  t('中日雙向 chosen in 開會 is still there after visiting another mode', await value(page, 'language'), 'zh_ja');
  t('no page errors (second visit)', errors, []);
  await context.close();
}
{
  // Device ids that stay the same (as in an ordinary browser profile): the stored id wins over the name, two microphones
  // of the same name are told apart, and one that is unplugged at first is selected when it returns.
  const context = await browser.newContext({permissions: ['microphone'], viewport: {width: 1440, height: 900}});
  await context.addCookies([{name: 'yq_session', value: process.env.YUQIAO_SESSION, url: app}]);
  await context.route('**/api/meetings**', route => route.request().method() === 'POST' ? route.abort() : route.continue());
  await context.addInitScript(() => {
    const all = [['id-a', 'USB 麥克風'], ['id-b', 'USB 麥克風'], ['id-c', '會議室麥克風']];
    const list = () => all.filter(([id]) => !(window.__unplugged || []).includes(id)).map(([deviceId, label]) => ({deviceId, label, kind: 'audioinput', groupId: 'g'}));
    navigator.mediaDevices.enumerateDevices = async () => list();
    try { window.__unplugged = JSON.parse(sessionStorage.getItem('unplugged') || '[]'); } catch { window.__unplugged = []; }
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(app + '/'); await page.waitForTimeout(1500);
  await choose(page, 'microphone', 'id-b');
  await reload(page);
  t('fixed ids: the stored id is selected, not the first of the same name', await value(page, 'microphone'), 'id-b');
  await choose(page, 'microphone', 'id-c');
  await page.evaluate(() => sessionStorage.setItem('unplugged', '["id-c"]'));
  await reload(page);
  t('fixed ids: unplugged at load, the first one is shown and the stored one is kept', [await value(page, 'microphone'), await stored(page, 'microphoneId')], ['id-a', 'id-c']);
  await page.evaluate(() => { window.__unplugged = []; navigator.mediaDevices.dispatchEvent(new Event('devicechange')); });
  await page.waitForTimeout(500);
  t('fixed ids: plugged in again, it is selected', await value(page, 'microphone'), 'id-c');
  await choose(page, 'microphone', 'id-a');
  await page.evaluate(() => navigator.mediaDevices.dispatchEvent(new Event('devicechange')));
  await page.waitForTimeout(500);
  t('fixed ids: a choice on this visit stays when the device list changes', await value(page, 'microphone'), 'id-a');
  t('no page errors (fixed ids)', errors, []);
  await context.close();
}
{
  // No access to the microphone yet (the list has no ids or names): the first test asks for the remembered microphone,
  // and once the list has names it is the one selected.
  const context = await browser.newContext({permissions: ['microphone'], viewport: {width: 1440, height: 900}});
  await context.addCookies([{name: 'yq_session', value: process.env.YUQIAO_SESSION, url: app}]);
  await context.route('**/api/meetings**', route => route.request().method() === 'POST' ? route.abort() : route.continue());
  await context.addInitScript(() => {
    try { if (!localStorage.getItem('microphoneId')) { localStorage.setItem('microphoneId', 'id-b'); localStorage.setItem('microphoneLabel', '會議室麥克風'); } } catch {}
    const named = [['id-a', 'USB 麥克風'], ['id-b', '會議室麥克風']].map(([deviceId, label]) => ({deviceId, label, kind: 'audioinput', groupId: 'g'}));
    navigator.mediaDevices.enumerateDevices = async () => window.__granted ? named : [{deviceId: '', label: '', kind: 'audioinput', groupId: ''}];
    const open = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = constraints => { window.__asked = constraints.audio; window.__granted = true; return open({audio: true}); };
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(app + '/'); await page.waitForTimeout(1500);
  const before = await value(page, 'microphone');
  await page.click('#setupMore'); await page.click('#testMic'); await page.waitForTimeout(1500);
  t('no access yet: the test asks for the remembered microphone, which is then selected',
    [before, await page.evaluate(() => window.__asked?.deviceId), await value(page, 'microphone'), await stored(page, 'microphoneId')], ['', {ideal: 'id-b'}, 'id-b', 'id-b']);
  await page.click('#testMic'); await page.waitForTimeout(300);
  t('no page errors (no access yet)', errors, []);
  await context.close();
}
{
  // Storage that cannot be used: the page works with its defaults.
  const context = await browser.newContext({permissions: ['microphone'], viewport: {width: 1440, height: 900}});
  await context.addCookies([{name: 'yq_session', value: process.env.YUQIAO_SESSION, url: app}]);
  await context.addInitScript(() => { const refuse = () => { throw new DOMException('blocked', 'SecurityError'); }; Storage.prototype.getItem = refuse; Storage.prototype.setItem = refuse; });
  await context.route('**/api/meetings**', route => route.request().method() === 'POST' ? route.abort() : route.continue());
  const page = await context.newPage();
  await page.goto(app + '/'); await page.waitForTimeout(1500);
  await choose(page, 'audioSource', 'system');
  t('without storage the page still works', [await value(page, 'audioSource'), await page.evaluate(() => !!document.querySelector('#setupSentence .sentence-pick'))], ['system', true]);
  await context.close();
}
await browser.close();
