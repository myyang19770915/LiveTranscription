// End-to-end acceptance for meeting-catalog in the real pages (Playwright, gstack's install):
// start a meeting with a topic (a WAV as the microphone), find it by keyword, rename it on the review
// page, return to the filtered list, and check the list at 400 px. Exits 1 on the first failed check.
// Usage: YUQIAO_SESSION=<token> node bench/catalog_e2e.mjs <16k wav> <screenshot dir>
import {homedir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

const [wav, out] = process.argv.slice(2);
const app = process.env.YUQIAO_APP || 'http://localhost:18082';
if (!process.env.YUQIAO_SESSION || !wav || !out) { console.error('Usage: YUQIAO_SESSION=<token> node bench/catalog_e2e.mjs <wav> <dir>'); process.exit(2); }
const {chromium} = (await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE || join(homedir(), '.claude/skills/gstack/node_modules/playwright/index.js')).href)).default;
const browser = await chromium.launch({args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`]});
let failed = false;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` ${JSON.stringify(detail)}` : ''}`); failed ||= !ok; };
try {
  const context = await browser.newContext({viewport: {width: 1440, height: 900}, permissions: ['microphone']});
  await context.addInitScript(() => localStorage.setItem('interpreter-theme', 'light'));
  await context.addCookies([{name: 'yq_session', value: process.env.YUQIAO_SESSION, url: `${app}/`}]);
  const page = await context.newPage();
  page.on('pageerror', e => check('no page errors', false, e.message));
  const topic = `驗收週會 ${Date.now() % 100000}`;

  // 1. Meeting topic entered on the meeting page.
  await page.goto(`${app}/`); await page.evaluate(() => window.accountReady);
  await page.selectOption('#language', 'zh'); await page.selectOption('#audioSource', 'microphone');
  await page.fill('#topic', `  ${topic}  `);
  await page.click('#start'); await page.waitForTimeout(8000);
  check('topic field locked during the meeting', await page.isDisabled('#topic'));
  await page.click('#start');
  await page.waitForFunction(() => !stream && !activeTranslation && !translationTimer && !segmentSaveTimer, null, {timeout: 120000, polling: 500});
  const meetingId = await page.evaluate(() => meetingId);
  check('topic cleared for the next meeting', (await page.inputValue('#topic')) === '');

  // 2. Keyword search on the list finds it, grouped under 今天.
  await page.goto(`${app}/meetings`); await page.waitForSelector('.meeting');
  await page.fill('#q', topic);
  await page.waitForFunction(t => [...document.querySelectorAll('.meeting-title')].map(e => e.textContent).join() === t, topic, {timeout: 10000});
  check('keyword finds the meeting (topic trimmed)', true, topic);
  check('grouped under 今天', (await page.$$eval('.group-title', els => els.map(e => e.textContent)))[0].startsWith('今天'));
  check('filters in the address', new URL(page.url()).searchParams.get('q') === topic);
  await page.screenshot({path: join(out, 'catalog-list.png')});

  // 3. Rename on the review page; 4. back returns to the filtered list.
  await page.click(`a[href="/meetings/${meetingId}"]`); await page.waitForSelector('.seg');
  check('review title is the topic', (await page.textContent('#title')) === topic, await page.textContent('#title'));
  await page.click('#renameButton'); await page.fill('#titleInput', `${topic}（改）`); await page.click('#renameForm button[type=submit]');
  await page.waitForFunction(t => document.querySelector('#title').textContent === t, `${topic}（改）`);
  check('renamed on the review page', true);
  await page.screenshot({path: join(out, 'catalog-review.png'), clip: {x: 0, y: 0, width: 1440, height: 340}});
  await page.click('#back'); await page.waitForSelector('.meeting');
  check('back keeps the filters', new URL(page.url()).searchParams.get('q') === topic, page.url());
  check('list shows the new topic', (await page.textContent('.meeting-title')) === `${topic}（改）`);

  // Clearing the topic brings back the start-time name.
  await page.goto(`${app}/meetings/${meetingId}`); await page.waitForSelector('.seg');
  await page.click('#renameButton'); await page.fill('#titleInput', ''); await page.click('#renameForm button[type=submit]');
  await page.waitForFunction(() => / 的會議$/.test(document.querySelector('#title').textContent));
  check('cleared topic shows MM/DD HH:mm 的會議', /^\d\d\/\d\d \d\d:\d\d 的會議$/.test(await page.textContent('#title')));

  // 5. 400 px.
  await page.setViewportSize({width: 400, height: 860});
  await page.goto(`${app}/meetings`); await page.waitForSelector('.meeting');
  check('no horizontal scroll at 400 px', !(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)));
  await page.screenshot({path: join(out, 'catalog-list-400.png')});
} catch (error) {
  check('run', false, error.message.split('\n')[0]);
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
