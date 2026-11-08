// End-to-end acceptance for live-translation in the real page (Playwright, gstack's install), with a WAV as the
// microphone. Reads and writes nothing on the server: switching to 即時翻譯 hides the meeting fields and changes the
// button, the mode survives a reload, a session runs without creating a meeting, 匯出逐字稿 downloads a translate-*.txt,
// and the floating subtitles (Document Picture-in-Picture, replaced here by a popup window) show the last sentences,
// toggle the source, change size, and reset the button when closed. Exits 1 on any failed check.
// Usage: YUQIAO_SESSION=<token> node bench/translate_e2e.mjs <16k wav> <screenshot dir>
import {homedir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

const [wav, out] = process.argv.slice(2);
const app = process.env.YUQIAO_APP || 'http://localhost:18082';
if (!process.env.YUQIAO_SESSION || !wav || !out) { console.error('Usage: YUQIAO_SESSION=<token> node bench/translate_e2e.mjs <wav> <dir>'); process.exit(2); }
const {chromium} = (await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE || join(homedir(), '.claude/skills/gstack/node_modules/playwright/index.js')).href)).default;
const browser = await chromium.launch({args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`]});
let failed = false;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` ${JSON.stringify(detail)}` : ''}`); failed ||= !ok; };
const meetingCount = page => page.evaluate(async () => { const j = await (await fetch('/api/meetings')).json(); return (j.meetings || j).length; });
try {
  const context = await browser.newContext({viewport: {width: 1440, height: 900}, permissions: ['microphone'], acceptDownloads: true});
  await context.addInitScript(() => localStorage.setItem('interpreter-theme', 'light'));
  // Document Picture-in-Picture is not in headless Chromium: a popup window stands in for it (same document API).
  await context.addInitScript(() => { window.documentPictureInPicture = {requestWindow: async () => window.open('', 'subtitles', 'width=760,height=180')}; });
  await context.addCookies([{name: 'yq_session', value: process.env.YUQIAO_SESSION, url: `${app}/`}]);
  const page = await context.newPage();
  page.on('pageerror', e => check('no page errors', false, e.message));

  // Switching to 即時翻譯 hides the meeting rows; the mode is remembered.
  await page.goto(`${app}/`); await page.evaluate(() => window.accountReady);
  const before = await meetingCount(page);
  await page.click('#modeTranslate');
  const hidden = await page.evaluate(() => ['setupMeeting', 'teamRow', 'topicRow', 'seriesRow', 'seriesPanel'].every(id => !document.getElementById(id).offsetParent));
  check('即時翻譯 hides team, topic, series and the series panel', hidden && (await page.textContent('#start')).includes('開始翻譯')
    && (await page.textContent('#modeNote')).includes('不建立會議紀錄'));
  await page.screenshot({path: join(out, 'translate-mode.png'), clip: {x: 0, y: 0, width: 1440, height: 520}});
  await page.reload(); await page.evaluate(() => window.accountReady);
  check('the mode survives a reload', await page.getAttribute('#modeTranslate', 'aria-pressed') === 'true' && (await page.textContent('#start')).includes('開始翻譯'));

  // A translate-only session: no meeting is created; the transcript can be downloaded.
  await page.selectOption('#language', 'zh'); await page.selectOption('#audioSource', 'microphone');
  await page.click('#start'); await page.waitForFunction(() => document.querySelector('#status span').textContent === '即時翻譯中', null, {timeout: 15000});
  check('the status says 即時翻譯中 and the mode is locked', await page.isDisabled('#modeMeeting') && await page.isDisabled('#modeTranslate'));
  await page.waitForFunction(() => document.getElementById('transcript').textContent.trim().length > 0, null, {timeout: 20000});
  await page.waitForTimeout(6000);
  const transcript = await page.textContent('#transcript');
  check('the transcript appears', transcript.trim().length > 0, transcript.slice(0, 40));
  await page.screenshot({path: join(out, 'translate-live.png')});

  // Floating subtitles (while the session runs): the popup shows the translation.
  const popupPromise = context.waitForEvent('page', {timeout: 5000}).catch(() => null);
  await page.click('#subtitles');
  const popup = await popupPromise;
  check('浮動字幕 opens a window', popup !== null && (await page.getAttribute('#subtitles', 'aria-pressed')) === 'true');
  if (popup) {
    await popup.waitForFunction(() => document.querySelector('.sub-text')?.textContent.trim().length > 0, null, {timeout: 20000}).catch(() => {});
    const shown = await popup.evaluate(() => ({text: document.querySelector('.sub-text').textContent, source: !!document.querySelector('.sub-source')?.offsetParent,
      size: getComputedStyle(document.querySelector('.sub-text')).fontSize}));
    const pageTranslation = await page.textContent('#translation');
    check('the subtitles show translated text from the page', shown.text.trim().length > 0 && pageTranslation.includes(shown.text.trim().slice(-6)), shown);
    check('the source is hidden by default', !shown.source);
    await popup.click('.sub-toggle-source'); await popup.click('.sub-bigger');
    const after = await popup.evaluate(() => ({source: !!document.querySelector('.sub-source')?.offsetParent, size: getComputedStyle(document.querySelector('.sub-text')).fontSize}));
    check('原文 shows the source and A+ grows the text', after.source && parseFloat(after.size) > parseFloat(shown.size), {before: shown.size, after: after.size});
    await popup.screenshot({path: join(out, 'subtitles.png')});
    await page.evaluate(() => Subtitles.update({translation: '大家好。', draft: '今天先'}));   // the spec's second example row
    const example = await popup.evaluate(() => { const t = document.querySelector('.sub-text'), d = document.querySelector('.sub-draft');
      return {text: t.textContent, draft: d.textContent, draftShown: !!d.offsetParent, distinct: getComputedStyle(d).color !== getComputedStyle(t).color || getComputedStyle(d).fontSize !== getComputedStyle(t).fontSize}; });
    check('the draft shows in its own style', example.text === '大家好。' && example.draft === '今天先' && example.draftShown && example.distinct, example);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('subtitles') || '{}'));
    check('both settings are remembered', saved.source === true && saved.size === 3, saved);
    await popup.close(); await page.waitForTimeout(300);
    check('closing the window resets the button', (await page.getAttribute('#subtitles', 'aria-pressed')) === 'false');
  }
  check('the footer note says nothing is stored', (await page.textContent('#storeNote')).includes('不存到伺服器'));

  // Sentence splitting (the spec's example table).
  const cases = await page.evaluate(() => [
    Subtitles.lastSentences('大家好。今天先看進度。合約下週寄出。', 2), Subtitles.lastSentences('大家好。', 2), Subtitles.lastSentences('Hello there. Second one! Third?', 2),
    Subtitles.lastSentences('We met last week. Revenue grew 3.5 percent.', 2)]);
  check('lastSentences keeps the last two sentences and whole decimals', cases[0] === '今天先看進度。合約下週寄出。' && cases[1] === '大家好。' && cases[2] === 'Second one! Third?'
    && cases[3] === 'We met last week. Revenue grew 3.5 percent.', cases);

  // Stop: nothing on the server, download works.
  await page.click('#start');
  await page.waitForFunction(() => document.querySelector('#status span').textContent.startsWith('翻譯已結束'), null, {timeout: 30000});
  check('no meeting was created', await meetingCount(page) === before, {before, after: await meetingCount(page)});
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#download')]);
  check('匯出逐字稿 downloads a translate-*.txt', download.suggestedFilename().startsWith('translate-') && download.suggestedFilename().endsWith('.txt'), download.suggestedFilename());
  await page.click('#modeMeeting');   // switching afterwards does not rename the finished session's export
  const [again] = await Promise.all([page.waitForEvent('download'), page.click('#download')]);
  check('the export keeps the prefix of the session it came from', again.suggestedFilename().startsWith('translate-'), again.suggestedFilename());
  await page.click('#modeTranslate');
  // The subtitle settings survive a reload: the window reopens with the source shown at size 3.
  await page.reload(); await page.evaluate(() => window.accountReady);
  const reopened = context.waitForEvent('page', {timeout: 5000}).catch(() => null); await page.click('#subtitles'); const second = await reopened;
  if (second) { await second.waitForFunction(() => document.body.dataset.size, null, {timeout: 5000}).catch(() => {});
    const kept = await second.evaluate(() => ({size: document.body.dataset.size, source: document.querySelector('.sub-toggle-source').getAttribute('aria-pressed')}));
    check('the settings are applied again after a reload', kept.size === '3' && kept.source === 'true', kept); await second.close(); }
  else check('the settings are applied again after a reload', false, 'no window');

  // Without the API the button is disabled and says why.
  const plain = await browser.newContext({viewport: {width: 1440, height: 900}});
  await plain.addInitScript(() => { delete window.documentPictureInPicture; });
  await plain.addCookies([{name: 'yq_session', value: process.env.YUQIAO_SESSION, url: `${app}/`}]);
  const p2 = await plain.newPage(); await p2.goto(`${app}/`); await p2.evaluate(() => window.accountReady);
  check('without Document PiP the button is disabled with the reason', await p2.isDisabled('#subtitles') && (await p2.getAttribute('#subtitles', 'title')).includes('Chrome'));
  await plain.close();
  await page.click('#modeMeeting');   // leave the page as it was
} catch (error) {
  check('run', false, `${error.message.split('\n')[0]} (line ${(error.stack.match(/translate_e2e\.mjs:(\d+)/) || [])[1]})`);
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
