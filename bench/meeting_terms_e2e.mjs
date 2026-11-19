// meeting-terms in a real browser (Playwright, gstack's install).
//   - setup: choosing a series offers 帶入上次的名詞（N 個）; it merges into 會議情境 after what is typed; a matching topic also
//     asks; 會議情境 takes 1000 characters (the earlier-terms answers are given by the test)
//   - review: one real meeting it creates, titled 驗收 修正名詞 <time>, in the signed-in user's first team; 修正名詞 shows how
//     many places match, corrects them all, records an edit and keeps the fix as the meeting's terms; invalid rows are refused
// Usage: YUQIAO_SESSION=<session of a user in a team> node bench/meeting_terms_e2e.mjs [screenshot dir] [app url]
import {homedir} from 'node:os';
import {join} from 'node:path';
import {mkdirSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

const shots = process.argv[2] || join(process.env.TEMP || '/tmp', 'meeting_terms_shots');
const app = (process.argv[3] || 'http://localhost:18082/').replace(/\/$/, '');
mkdirSync(shots, {recursive: true});
const modulePath = process.env.PLAYWRIGHT_MODULE || join(homedir(), '.claude/skills/gstack/node_modules/playwright/index.js');
const {chromium} = (await import(pathToFileURL(modulePath).href)).default;
const browser = await chromium.launch();
const t = (name, got, want) => {const ok = JSON.stringify(got) === JSON.stringify(want); console.log(ok ? 'ok  ' : 'FAIL', name, JSON.stringify(got)); if (!ok) process.exitCode = 1};
const json = body => ({status: 200, contentType: 'application/json', body: JSON.stringify(body)});

async function session(width) {
  const context = await browser.newContext({viewport: {width, height: 900}});
  await context.addCookies([{name: 'yq_session', value: process.env.YUQIAO_SESSION, url: app + '/'}]);
  return context;
}

// --- Setup: the offer
{
  const context = await session(1440);
  const page = await context.newPage();
  const asked = [];
  await page.route(/\/api\/teams\/\d+\/series$/, route => route.request().method() === 'GET' ? route.fulfill(json([{id: 991, name: '研發週會'}])) : route.continue());
  await page.route(/\/api\/teams\/\d+\/terms/, route => {
    const query = new URL(route.request().url()).searchParams;
    asked.push(query.toString());
    route.fulfill(json(query.get('series_id') === '991' ? {glossary: '阿總=阿祖、KKBOX=KBox', count: 2}
      : query.get('title') === '週會' ? {glossary: 'MES', count: 1} : {glossary: '', count: 0}));
  });
  await page.goto(app + '/');
  await page.evaluate(() => { localStorage.setItem('liveMode', 'meeting'); for (const k of Object.keys(localStorage)) if (k.startsWith('series:')) localStorage.removeItem(k); });
  await page.reload(); await page.waitForLoadState('networkidle');
  const offer = () => page.evaluate(() => { const b = document.getElementById('earlierTerms'); return b.hidden ? null : b.textContent; });
  t('no series, no topic: no offer', await offer(), null);
  t('會議情境 takes 1000 characters', await page.getAttribute('#context', 'maxlength'), '1000');
  await page.fill('#context', 'LINE=耐');
  await page.selectOption('#series', '991');
  await page.waitForFunction(() => !document.getElementById('earlierTerms').hidden);
  t('a series offers its terms', await offer(), '帶入上次的名詞（2 個）');
  t('nothing is filled before the choice', await page.inputValue('#context'), 'LINE=耐');
  await page.screenshot({path: join(shots, 'setup-offer-1440.png')});
  await page.click('#earlierTerms');
  t('choosing it merges after what is typed', await page.inputValue('#context'), 'LINE=耐、阿總=阿祖、KKBOX=KBox');
  t('once merged the offer is gone', await offer(), null);
  await page.fill('#context', '本週研發會議討論新產品上市時程，還有行銷預算與通路安排，請大家先看上週的會議紀錄，名詞照舊');
  await page.waitForFunction(() => !document.getElementById('earlierTerms').hidden);
  await page.click('#earlierTerms');
  t('what is typed stays exactly as typed', await page.inputValue('#context'),
    '本週研發會議討論新產品上市時程，還有行銷預算與通路安排，請大家先看上週的會議紀錄，名詞照舊、阿總=阿祖、KKBOX=KBox');
  await page.fill('#context', '');
  await page.waitForFunction(() => !document.getElementById('earlierTerms').hidden);
  await page.evaluate(() => { document.getElementById('context').disabled = true; });
  await page.waitForFunction(() => document.getElementById('earlierTerms').hidden);
  t('hidden while a meeting runs (會議情境 locked)', await offer(), null);
  await page.evaluate(() => { document.getElementById('context').disabled = false; });
  await page.selectOption('#series', '');
  await page.fill('#topic', '週會');
  await page.waitForFunction(() => !document.getElementById('earlierTerms').hidden, null, {timeout: 3000}).catch(() => {});
  t('without a series, a topic asks by title', [await offer(), asked.some(q => q === 'title=%E9%80%B1%E6%9C%83')], ['帶入上次的名詞（1 個）', true]);
  await context.close();

  const phone = await session(390);
  const small = await phone.newPage();
  await small.route(/\/api\/teams\/\d+\/series$/, route => route.request().method() === 'GET' ? route.fulfill(json([{id: 991, name: '研發週會'}])) : route.continue());
  await small.route(/\/api\/teams\/\d+\/terms/, route => route.fulfill(json({glossary: '阿總=阿祖、KKBOX=KBox', count: 2})));
  await small.goto(app + '/'); await small.waitForLoadState('networkidle');
  await small.evaluate(() => { const s = document.getElementById('series'); s.value = '991'; s.dispatchEvent(new Event('change')); });
  await small.waitForTimeout(500);
  const settings = small.locator('#mobileSettingsButton, .mobile-settings-toggle, [aria-controls="mobileSettings"]').first();
  if (await settings.count()) await settings.click().catch(() => {});
  await small.waitForTimeout(300);
  t('phone: no horizontal scroll', await small.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await small.screenshot({path: join(shots, 'setup-offer-390.png'), fullPage: true});
  await phone.close();
}

// --- Review: 修正名詞 on a real meeting
for (const width of [1280, 400]) {
  const context = await session(width);
  const me = await (await context.request.get(`${app}/api/me`)).json();
  const created = await (await context.request.post(`${app}/api/meetings`, {data: {team_id: me.teams[0].id, language: 'zh', title: `驗收 修正名詞 ${new Date().toISOString().slice(11, 19)}`}})).json();
  const lines = ['阿祖說好，我們下週上線。', '我跟阿祖確認過 KBox 的資料。', '這一章的主題是第一位專家。', '沒有問題。', '阿祖再補充一下。'];
  await context.request.put(`${app}/api/meetings/${created.id}/segments`, {data: {glossary: 'LINE=耐', learned: '', sourceLanguage: 'zh', targetLanguage: 'none',
    segments: lines.map((source, i) => ({seq: i + 1, startMs: i * 3000, endMs: i * 3000 + 2500, source, target: '', detected: ''}))}});
  const page = await context.newPage();
  await page.goto(`${app}/meetings/${created.id}`); await page.waitForSelector('.seg');
  await page.click('#termsButton');
  t(`${width}: the dialog opens with one empty row`, await page.locator('#termsRows .terms-row').count(), 1);
  await page.fill('#termsRows .terms-row:nth-child(1) .wrong', '阿祖');
  t(`${width}: it shows how many places match`, await page.textContent('#termsRows .terms-row:nth-child(1) .found'), '找到 3 處');
  await page.fill('#termsRows .terms-row:nth-child(1) .right', '阿總');
  await page.click('#termsAdd');
  await page.fill('#termsRows .terms-row:nth-child(2) .wrong', '祖');
  await page.fill('#termsRows .terms-row:nth-child(2) .right', '總');
  await page.click('#termsGo');
  t(`${width}: one character is refused before sending`, [await page.isVisible('#termsError'), await page.textContent('#termsError')], [true, '「原本寫成」至少要 2 個字']);
  await page.fill('#termsRows .terms-row:nth-child(2) .wrong', 'KBox');
  await page.fill('#termsRows .terms-row:nth-child(2) .right', 'KKBOX');
  await page.click('#termsAdd');
  await page.fill('#termsRows .terms-row:nth-child(3) .wrong', '第一位專家');
  await page.fill('#termsRows .terms-row:nth-child(3) .right', '地位專家');
  t(`${width}: Latin forms count as whole words`, await page.textContent('#termsRows .terms-row:nth-child(2) .found'), '找到 1 處');
  t(`${width}: no horizontal scroll in the dialog`, await page.evaluate(() => { const d = document.getElementById('termsDialog'); return d.scrollWidth <= d.clientWidth + 1 && document.documentElement.scrollWidth <= innerWidth; }), true);
  await page.screenshot({path: join(shots, `review-terms-${width}.png`)});
  await page.click('#termsGo');
  await page.waitForFunction(() => !document.getElementById('termsDialog').open);
  t(`${width}: segments now say the corrected forms`, await page.$$eval('.seg-source span:last-child', spans => spans.map(s => s.textContent)),
    ['阿總說好，我們下週上線。', '我跟阿總確認過 KKBOX 的資料。', '這一章的主題是地位專家。', '沒有問題。', '阿總再補充一下。']);
  t(`${width}: it says how many segments changed`, await page.textContent('#notice'), '已更正 4 段，修改紀錄裡看得到每一段的變更');
  const history = await (await context.request.get(`${app}/api/meetings/${created.id}/segments/1/history`)).json();
  t(`${width}: the change is an edit in the history`, history.map(h => [h.kind, h.sourceBefore, h.sourceAfter]), [['edit', '阿祖說好，我們下週上線。', '阿總說好，我們下週上線。']]);
  const detail = await (await context.request.get(`${app}/api/meetings/${created.id}`)).json();
  t(`${width}: the fixes are the meeting's terms`, detail.glossary, 'LINE=耐、阿總=阿祖、KKBOX=KBox、地位專家=第一位專家');
  await page.screenshot({path: join(shots, `review-after-${width}.png`)});
  await context.close();
}
await browser.close();
console.log('screenshots in', shots);
