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
  // Headless Chromium has no tab to share: 分頁／系統聲音 gets a canvas picture plus the fake microphone's audio.
  await context.addInitScript(() => { navigator.mediaDevices.getDisplayMedia = async () => { const c = document.createElement('canvas'); c.width = 320; c.height = 180;
    const g = c.getContext('2d'); let n = 0; setInterval(() => { g.fillStyle = n++ % 2 ? '#335577' : '#336688'; g.fillRect(0, 0, 320, 180); }, 200);   // frames only flow while the canvas is drawn to
    const mic = await navigator.mediaDevices.getUserMedia({audio: true});
    return new MediaStream([...c.captureStream(5).getVideoTracks(), ...mic.getAudioTracks()]); }; });
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
  // service-status: the idle status says whether the local services are ready (spec example "Status text").
  await page.waitForFunction(() => document.querySelector('#status span').textContent === '服務就緒', null, {timeout: 10000});
  check('with every service up the status reads 服務就緒 with a steady dot', await page.getAttribute('#status', 'class') === 'status ready');
  const services = down => JSON.stringify({ready: !down.length, services: [['asr', '語音辨識'], ['translate', '翻譯'], ['database', '資料庫']].map(([key, name]) => ({key, name, ok: !down.includes(key)}))});
  const statusAfter = async reply => {
    await page.route('**/api/services', route => reply(route));
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.waitForTimeout(400); await page.unroute('**/api/services');
    return page.evaluate(() => ({text: document.querySelector('#status span').textContent, kind: document.getElementById('status').className, title: document.getElementById('status').title}));
  };
  const one = await statusAfter(route => route.fulfill({contentType: 'application/json', body: services(['asr'])}));
  check('a stopped service turns the status red', one.text === '語音辨識服務未啟動' && one.kind === 'status error' && one.title === '請確認 Docker 服務已啟動', one);
  const two = await statusAfter(route => route.fulfill({contentType: 'application/json', body: services(['asr', 'translate'])}));
  check('several stopped services are listed', two.text === '語音辨識、翻譯服務未啟動' && two.kind === 'status error', two);
  await page.screenshot({path: join(out, 'service-status-down.png'), clip: {x: 0, y: 0, width: 1440, height: 90}});
  const failed = await statusAfter(route => route.fulfill({status: 502, body: ''}));
  check('a failed check reads 無法連線到伺服器', failed.text === '無法連線到伺服器' && failed.kind === 'status error', failed);
  const back = await statusAfter(route => route.continue());
  check('the status recovers to 服務就緒', back.text === '服務就緒' && back.kind === 'status ready', back);
  // setup-form-polish: readable sizes, 中 ⇆ 日 on the swap button, and the local engine is not named by its model.
  await page.selectOption('#language', 'zh_ja');
  const form = await page.evaluate(() => ({tags: [...document.querySelectorAll('#swap .lang-tag')].map(t => t.textContent),
    label: getComputedStyle(document.querySelector('.language-field label')).fontSize, value: getComputedStyle(document.getElementById('language')).fontSize,
    engines: [...document.querySelectorAll('#asrEngine option')].map(o => o.textContent)}));
  check('the setup form is readable and the swap button shows 中 and 日', form.tags.join() === '中,日' && form.label === '12px' && form.value === '15px', form);
  check('the local engine is shown as 本機 without a model name', form.engines[0] === '本機' && !form.engines.some(e => /confucius/i.test(e)), form.engines);

  // A translate-only session: no meeting is created; the transcript can be downloaded.
  await page.selectOption('#language', 'zh'); await page.selectOption('#audioSource', 'microphone');
  await page.click('#start'); await page.waitForFunction(() => document.querySelector('#status span').textContent === '即時翻譯中', null, {timeout: 15000});
  check('the status says 即時翻譯中 and the mode is locked', await page.isDisabled('#modeMeeting') && await page.isDisabled('#modeTranslate'));
  const during = await statusAfter(route => route.fulfill({contentType: 'application/json', body: services(['translate'])}));
  check('a check during live translation does not change the status', during.text === '即時翻譯中' && during.kind === 'status live', during);
  check('with a microphone alone 畫面＋字幕 is disabled with the reason', await page.isDisabled('#overlay') && (await page.getAttribute('#overlay', 'title')).includes('分頁／系統聲音'));
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
    await page.evaluate(() => Subtitles.update({done: '第一句。', pending: '第二句還在講', translation: 'First.', draft: 'Second being'}));
    const pipColours = await popup.evaluate(() => { const c = s => getComputedStyle(document.querySelector(s)).color; return {now: c('.sub-now'), draft: c('.sub-draft'), text: c('.sub-text'), nowText: document.querySelector('.sub-now').textContent}; });
    check('the floating window colours the current speech like its draft', pipColours.now === pipColours.draft && pipColours.now !== pipColours.text && pipColours.nowText === '第二句還在講', pipColours);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('subtitles') || '{}'));
    check('both settings are remembered', saved.source === true && saved.size === 3, saved);
    await popup.close(); await page.waitForTimeout(300);
    check('closing the window resets the button', (await page.getAttribute('#subtitles', 'aria-pressed')) === 'false');
  }
  check('the footer note says nothing is stored', (await page.textContent('#storeNote')).includes('不存到伺服器'));
  check('the engine note says the cloud engine is about a second slower', (await page.textContent('#asrEngineRow .field-note')).includes('約慢 1 秒'));
  // The cloud engine's tentative text (mai-intermediate): shown after the confirmed transcript, part of the current speech, never exported.
  const tentativeEvent = text => JSON.stringify({status: 'success', msg: {text: '', reset: false, speech_end: false, language: ''}, tentative: text});
  await page.evaluate(e => onMessage({data: e}), tentativeEvent('正在講的暫定字'));
  const shownTentative = await page.evaluate(() => ({span: document.querySelector('#transcript .tentative')?.textContent, pending: subtitleParts().pending, transcript}));
  check('tentative text shows in its own style and in the current speech, not in the transcript', shownTentative.span === '正在講的暫定字' && shownTentative.pending.endsWith('正在講的暫定字') && !shownTentative.transcript.includes('正在講的暫定字'), shownTentative);
  check('the export leaves the tentative text out', !(await page.evaluate(async () => (await transcriptFile().text()).includes('正在講的暫定字'))));
  await page.evaluate(e => onMessage({data: e}), tentativeEvent(''));
  check('an empty tentative removes it', await page.evaluate(() => !document.querySelector('#transcript .tentative')));

  // 即時翻譯 segments run-on Chinese at a settled comma from 40 characters; meetings wait for 100 (the spec's example).
  const runOn = '他說我們今天要討論的是這個新的工作流，因為很多同事都還不熟悉，所以我先介紹一下整體的架構，然後再請大家提問，我們有三個部分要說明';
  const plans = await page.evaluate(t => [TranslationSegmentation.plan(t, 0, [], 0, false, 'live'), TranslationSegmentation.plan(t, 0, [], 0, false)], runOn);
  check('the live profile finalizes a 16–60 character clause at a comma; the meeting profile keeps collecting', plans[0].final && plans[0].end >= 16 && plans[0].end <= 60 && /[，,]$/.test(runOn.slice(0, plans[0].end)) && !plans[1].final, plans);
  const because = '因為很多同事都還不熟悉，所以我先介紹一下整體的架構，然後再請大家提問，我們有三個部分要說明';   // the spec's second row
  const becausePlan = await page.evaluate(t => TranslationSegmentation.plan(t, 0, [], 0, false, 'live'), because);
  check('a 因為… clause is never cut right after its comma', becausePlan.final && becausePlan.end !== 12 && becausePlan.end >= 16 && becausePlan.end <= 60, becausePlan);
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
  // subtitleParts(): the last two finalized segments and the previous segment's source (the spec's three-segment row).
  const parts = await page.evaluate(() => { const e = translationEpoch; segmentRecords.clear();
    [['大家好。', 'Hi.'], ['今天先看進度。', 'Progress first.'], ['合約下週寄出。', 'Contract next week.']].forEach(([source, target], i) => segmentRecords.set(`${e}:${i * 10}`, {id: `${e}:${i * 10}`, start: i * 10, end: i * 10 + 10, source, target, state: 'finalized'}));
    return subtitleParts(); });
  check('subtitleParts gives the last two segments and the previous source', parts.translation === 'Progress first. Contract next week.' && parts.done === '合約下週寄出。', parts);
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

  // 畫面＋字幕 with a shared picture: saved settings (the spec's example rows), the overlay, its opacity, dragging, Esc,
  // and the share ending in the browser. Settings are read when the page loads, so each row needs a reload.
  await page.evaluate(() => localStorage.setItem('overlay', JSON.stringify({opacity: 30, x: 50, y: 12, source: false})));
  await page.reload(); await page.evaluate(() => window.accountReady);
  await page.selectOption('#audioSource', 'system');
  await page.click('#start'); await page.waitForFunction(() => document.querySelector('#status span').textContent === '即時翻譯中', null, {timeout: 15000});
  check('with 分頁／系統聲音 the button is enabled', await page.isEnabled('#overlay'));
  await page.click('#overlay');
  const opened = await page.evaluate(() => ({shown: !document.getElementById('screenView').hidden, video: !!document.querySelector('#screenView video').srcObject, pressed: document.getElementById('overlay').getAttribute('aria-pressed')}));
  check('the overlay opens with the shared picture', opened.shown && opened.video && opened.pressed === 'true', opened);
  const frames = await page.waitForFunction(() => document.querySelector('#screenView video').videoWidth > 0, null, {timeout: 10000}).then(() => true).catch(() => false);
  check('the picture is playing (frames decoded)', frames);
  const boxState = () => page.evaluate(() => { const v = document.getElementById('screenView').getBoundingClientRect(), r = document.querySelector('#screenView .overlay-subs').getBoundingClientRect();
    const st = getComputedStyle(document.querySelector('#screenView .overlay-subs'));
    return {bg: st.backgroundColor, alpha: st.getPropertyValue('--ov-alpha').trim(), cx: (r.left + r.width / 2 - v.left) / v.width * 100, cy: (r.top + r.height / 2 - v.top) / v.height * 100, top: r.top, color: getComputedStyle(document.querySelector('#screenView .ov-text')).color}; });
  const seeded = await boxState();
  check('saved settings apply: rgba(0,0,0,.3) at 50% across, 12% down', seeded.bg === 'rgba(0, 0, 0, 0.3)' && Math.abs(seeded.cx - 50) < 1 && Math.abs(seeded.cy - 12) < 2, seeded);
  check('a saved source:false keeps 原文 hidden after the reload', (await page.getAttribute('#screenView .ov-toggle-source', 'aria-pressed')) === 'false' && await page.evaluate(() => document.querySelector('#screenView .ov-source').hidden));
  await page.click('#screenView .ov-toggle-source');   // on for the checks below
  // Long content stays subtitle-sized: each part at most two of its lines, the current speech and the draft (newest) visible, the box under half the window.
  await page.evaluate(() => Overlay.update({done: '這是一段很長的中文原文，用來確認原文那一行不會把字幕框撐高。', pending: '現在正在講的這一句也很長，長到會換行，最新的字必須看得到才對。', translation: Array.from({length: 8}, (_, i) => `Sentence number ${i + 1} of a long English translation that wraps across the whole subtitle box width.`).join(' '), draft: 'and the draft keeps going with even more words that must remain visible at the bottom'}));
  const sized = await page.evaluate(() => { const b = document.querySelector('#screenView .overlay-subs'), body = b.querySelector('.ov-body'), d = b.querySelector('.ov-draft');
    const line = parseFloat(getComputedStyle(b).fontSize) * 1.35, br = body.getBoundingClientRect(), dr = d.getBoundingClientRect(), t = b.querySelector('.ov-text').getBoundingClientRect(), src = b.querySelector('.ov-source').getBoundingClientRect(), nr = b.querySelector('.ov-now').getBoundingClientRect();
    const inside = (r, o) => r.bottom <= o.bottom + 1 && r.bottom > o.top;
    return {bodyLines: br.height / line, textLines: t.height / line, boxRatio: b.getBoundingClientRect().height / innerHeight, draftVisible: inside(dr, br), nowVisible: inside(nr, src) && inside(src, br)}; });
  check('long content: translation at most two lines, body under five, the current speech and the draft visible, the box under half the window', sized.textLines <= 2.05 && sized.bodyLines <= 5.2 && sized.boxRatio <= 0.5 && sized.draftVisible && sized.nowVisible, sized);
  await page.evaluate(() => Overlay.update({done: '上一段原文', pending: '', translation: 'Seg A. Seg B.', draft: ''}));
  const segs = await page.evaluate(() => ({done: document.querySelector('#screenView .ov-done').textContent, text: document.querySelector('#screenView .ov-text').textContent}));
  check('the overlay shows the previous segment source and the last two segments as given', segs.done === '上一段原文' && segs.text === 'Seg A. Seg B.', segs);
  await page.evaluate(() => Overlay.update({done: '第一句。', pending: '第二句還在講', translation: 'First.', draft: 'Second being'}));
  const colours = await page.evaluate(() => { const c = s => getComputedStyle(document.querySelector('#screenView ' + s)).color; return {now: c('.ov-now'), draft: c('.ov-draft'), text: c('.ov-text'), done: c('.ov-done'), nowText: document.querySelector('#screenView .ov-now').textContent}; });
  check('the speech being translated and its draft share a colour, distinct from finalized text', colours.now === colours.draft && colours.now !== colours.text && colours.done === colours.text && colours.nowText === '第二句還在講', colours);
  await page.evaluate(() => Overlay.update({done: '', pending: '', translation: '', draft: ''}));
  await page.waitForFunction(() => (document.querySelector('#screenView .ov-text').textContent + document.querySelector('#screenView .ov-draft').textContent).trim().length > 0, null, {timeout: 60000}).catch(() => {});
  const ov = await page.evaluate(() => ({text: (document.querySelector('#screenView .ov-text').textContent || document.querySelector('#screenView .ov-draft').textContent).trim(), page: document.getElementById('translation').textContent}));
  check('the overlay shows the page translation', ov.text.length > 0 && ov.page.includes(ov.text.slice(-6)), ov.text.slice(-30));
  await page.evaluate(() => { const s = document.querySelector('#screenView .ov-opacity input'); s.value = '45'; s.dispatchEvent(new Event('input', {bubbles: true})); });
  const slid = await boxState();
  check('the slider changes only the background alpha', slid.alpha === '0.45' && slid.bg === 'rgba(0, 0, 0, 0.45)' && slid.color === 'rgb(255, 255, 255)', slid);
  await page.click('#screenView .ov-toggle-source');   // off here, and the floating window's own setting is untouched
  check("turning 原文 off is this view's own setting", (await page.evaluate(() => JSON.parse(localStorage.getItem('overlay')).source)) === false && (await page.evaluate(() => Subtitles.getSettings().source)) === true);
  await page.evaluate(() => { localStorage.setItem('subtitles', JSON.stringify({source: true, size: 1})); });   // A− at the smallest size stays there
  await page.evaluate(() => Subtitles.setSettings({size: 1})); await page.click('#screenView .ov-smaller');
  check('A− at the smallest size keeps size 1', (await page.evaluate(() => Subtitles.getSettings().size)) === 1 && (await page.getAttribute('#screenView .overlay-subs', 'data-size')) === '1');
  const box = await page.evaluate(() => { const r = document.querySelector('#screenView .overlay-subs').getBoundingClientRect(); return {x: r.left + r.width / 2, y: r.top + 8, top: r.top}; });
  await page.mouse.move(box.x, box.y + 60); await page.mouse.down(); await page.mouse.move(box.x - 200, 600, {steps: 8}); await page.mouse.up();
  const moved = await page.evaluate(() => ({top: document.querySelector('#screenView .overlay-subs').getBoundingClientRect().top, saved: JSON.parse(localStorage.getItem('overlay') || '{}')}));
  check('dragging moves the box and remembers the position', moved.top > box.top + 100 && moved.saved.y > 40 && moved.saved.x < 50 && moved.saved.opacity === 45, moved);
  await page.keyboard.press('Escape');
  check('Esc closes the overlay', await page.evaluate(() => document.getElementById('screenView').hidden && !document.querySelector('#screenView video').srcObject) && (await page.getAttribute('#overlay', 'aria-pressed')) === 'false');
  await page.click('#overlay');
  const reopenedBox = await boxState();
  check('reopening applies the saved position and opacity', Math.abs(reopenedBox.top - moved.top) < 4 && reopenedBox.alpha === '0.45', reopenedBox);
  await page.screenshot({path: join(out, 'overlay.png')});
  // The share ends in the browser (Chrome's sharing bar): the session stops, the view closes, the button is disabled.
  await page.evaluate(() => document.querySelector('#screenView video').srcObject.getVideoTracks()[0].dispatchEvent(new Event('ended')));
  await page.waitForFunction(() => document.querySelector('#status span').textContent.includes('已停止'), null, {timeout: 30000});
  check('the share ending closes the overlay and disables the button', await page.evaluate(() => document.getElementById('screenView').hidden) && await page.isDisabled('#overlay'));
  // An invalid saved value falls back to the defaults.
  await page.evaluate(() => localStorage.setItem('overlay', '"garbage"'));
  await page.reload(); await page.evaluate(() => window.accountReady);
  await page.selectOption('#audioSource', 'system');   // the source is not remembered across reloads
  await page.click('#start'); await page.waitForFunction(() => document.querySelector('#status span').textContent === '即時翻譯中', null, {timeout: 15000});
  await page.click('#overlay');
  const fallback = await boxState();
  check('an invalid saved value gives rgba(0,0,0,.55) at 50% across, 88% down, 原文 shown by default', fallback.bg === 'rgba(0, 0, 0, 0.55)' && Math.abs(fallback.cx - 50) < 1 && Math.abs(fallback.cy - 88) < 2 && (await page.getAttribute('#screenView .ov-toggle-source', 'aria-pressed')) === 'true', fallback);
  await page.evaluate(() => document.getElementById('start').click());   // the overlay covers the page: stop from behind it
  await page.waitForFunction(() => /^(翻譯已結束|系統待機)/.test(document.querySelector('#status span').textContent), null, {timeout: 30000});   // 系統待機 when nothing was said yet
  check('ending the session closes the overlay and disables the button', await page.evaluate(() => document.getElementById('screenView').hidden) && await page.isDisabled('#overlay'));
  await page.selectOption('#audioSource', 'microphone');

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
