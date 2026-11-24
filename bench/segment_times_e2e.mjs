// segment-audio-times on the review page (Playwright, gstack's install): a timed segment plays from 0.3 s before its
// start, any other from 3 s before; while the speaker timeline plays, the marked segment follows the same lead
// (transcript-review "Segment playback"). The page is a real meeting's, with its segments and turns replaced by the
// spec's numbers in the answers; its recording is the real one. Nothing is changed in the meeting.
// Usage: YUQIAO_SESSION=… node bench/segment_times_e2e.mjs <id of a meeting with a recording of 45 s or more> [app url]
import {homedir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

const meeting = process.argv[2];
const app = (process.argv[3] || 'http://localhost:18082/').replace(/\/$/, '');
if (!process.env.YUQIAO_SESSION || !meeting) { console.error('Usage: YUQIAO_SESSION=… node bench/segment_times_e2e.mjs <meeting id> [app url]'); process.exit(2); }
const t = (name, got, want) => {const ok = JSON.stringify(got) === JSON.stringify(want); console.log(ok ? 'ok  ' : 'FAIL', name, JSON.stringify(got)); if (!ok) process.exitCode = 1};
const modulePath = process.env.PLAYWRIGHT_MODULE || join(homedir(), '.claude/skills/gstack/node_modules/playwright/index.js');
const {chromium} = (await import(pathToFileURL(modulePath).href)).default;
const browser = await chromium.launch({args: ['--autoplay-policy=no-user-gesture-required']});
const context = await browser.newContext({viewport: {width: 1440, height: 900}});
await context.addCookies([{name: 'yq_session', value: process.env.YUQIAO_SESSION, url: app}]);

const SEGMENTS = [[1, 12811, 17578, true, '第一段'], [2, 21330, 27040, true, '第二段'], [3, 40000, 44000, false, '第三段']];
const TURNS = [[12900, 17500, 1, '第一段'], [19000, 20500, 1, '別的話'], [21330, 27040, 1, '第二段'], [40960, 43640, 1, '第三段']];
const ranges = [];
await context.route(`**/api/meetings/${meeting}`, async route => {
  if (route.request().method() !== 'GET') return route.continue();
  const response = await route.fetch(), body = await response.json();
  const like = body.segments[0];
  body.segments = SEGMENTS.map(([seq, startMs, endMs, timed, source]) => ({...like, seq, startMs, endMs, timed, source, asrText: source, target: source, liveTarget: source, speaker: 1, state: 'unreviewed'}));
  await route.fulfill({response, json: body});
});
await context.route(`**/api/meetings/${meeting}/speakers`, async route => {
  if (route.request().method() !== 'GET') return route.continue();
  const response = await route.fetch(), body = await response.json();
  await route.fulfill({response, json: {...body, status: 'done', turns: TURNS}});
});
await context.route(`**/api/meetings/${meeting}/audio**`, route => { const url = new URL(route.request().url()); ranges.push(`${url.searchParams.get('start')}-${url.searchParams.get('end')}`); return route.continue(); });
// The page must never write to the real meeting from here.
await context.route(`**/api/meetings/${meeting}/**`, route => route.request().method() === 'GET' ? route.fallback() : route.abort());

const page = await context.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
await page.goto(`${app}/meetings/${meeting}`);
await page.waitForSelector('#seg-2 .seg-time');
await page.waitForSelector('.spk-turn[data-turn="2"]');

await page.click('#seg-2 .seg-time'); await page.waitForTimeout(600);
t('a timed segment 21330-27040 plays 21030-27340', ranges.at(-1), '21030-27340');
await page.click('#seg-3 .seg-time'); await page.waitForTimeout(600);
t('a segment that is not timed, 40000-44000, plays 37000-44500', ranges.at(-1), '37000-44500');

const speaking = () => page.evaluate(() => document.querySelector('.seg.speaking')?.id ?? null);
await page.click('.spk-turn[data-turn="1"]'); await page.waitForTimeout(700);
t('timeline at 19.0-19.9 s: the timed segment starting at 21.33 s is not marked yet', await speaking(), null);
await page.click('.spk-turn[data-turn="2"]'); await page.waitForTimeout(700);
t('timeline at 21.5 s: the segment 21330-27040 is marked', await speaking(), 'seg-2');
await page.click('.spk-turn[data-turn="0"]'); await page.waitForTimeout(700);
t('timeline at 13 s: the segment 12811-17578 is marked', await speaking(), 'seg-1');
t('no page errors', errors, []);
await browser.close();
