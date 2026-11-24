// ui-sentence-menus: a setting word of the live page's sentence opens its own menu below the word (no unfolding of the
// setup), microphone names lose the USB code, and the shared header gives the brand room (meeting-setup-layout,
// visual-tokens). Nothing is started: POST /api/meetings is blocked.
// Usage: YUQIAO_SESSION=… node bench/ui_sentence_menus_e2e.mjs [app url]   (UI_SM_SHOTS=<folder> also saves screenshots)
import {homedir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

const app = (process.argv[2] || 'http://localhost:18082/').replace(/\/$/, '');
const shots = process.env.UI_SM_SHOTS || '';
const t = (name, got, want) => {const ok = JSON.stringify(got) === JSON.stringify(want); console.log(ok ? 'ok  ' : 'FAIL', name, JSON.stringify(got)); if (!ok) process.exitCode = 1};
const modulePath = process.env.PLAYWRIGHT_MODULE || join(homedir(), '.claude/skills/gstack/node_modules/playwright/index.js');
const {chromium} = (await import(pathToFileURL(modulePath).href)).default;
const browser = await chromium.launch({args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']});

async function open(path, {width = 1440, height = 900, theme = 'dark', storage = {}} = {}) {
  const context = await browser.newContext({permissions: ['microphone'], viewport: {width, height}});
  await context.addCookies([{name: 'yq_session', value: process.env.YUQIAO_SESSION, url: app}]);
  await context.addInitScript(([theme, storage]) => { try { localStorage.setItem('interpreter-theme', theme); for (const [k, v] of Object.entries(storage)) localStorage.setItem(k, v); } catch {} }, [theme, storage]);
  await context.route('**/api/meetings**', route => route.request().method() === 'POST' ? route.abort() : route.continue());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(app + path);
  await page.waitForTimeout(1500);
  return {context, page, errors};
}
const menu = page => page.evaluate(() => {
  const m = document.getElementById('sentenceMenu');
  if (!m || !m.checkVisibility()) return null;
  const opts = [...m.querySelectorAll('[role=option]')];
  return {options: opts.map(o => o.textContent.trim()), selected: opts.filter(o => o.getAttribute('aria-selected') === 'true').map(o => o.textContent.trim()),
    groups: [...m.querySelectorAll('.sentence-menu-group')].map(g => g.textContent.trim()), focused: document.activeElement?.closest('#sentenceMenu') ? document.activeElement.textContent.trim() : null,
    top: Math.round(m.getBoundingClientRect().top), right: Math.round(m.getBoundingClientRect().right)};
});
const word = (page, field) => page.locator(`#setupSentence button.sentence-pick[data-field="${field}"]`);

for (const theme of ['dark', 'light']) {
  const {context, page, errors} = await open('/', {theme});
  // Two teams in the menu, whatever the account has: a second option is added to the page's own menu (nothing is saved).
  await page.evaluate(() => { const el = document.getElementById('team'); if (el.options.length < 2) el.append(new Option('測試團隊乙', 'zz-test')); el.hidden = false; el.dispatchEvent(new Event('change')); });
  const teamWord = word(page, 'team');
  t(`${theme}: the team word announces a listbox`, await teamWord.getAttribute('aria-haspopup').catch(() => null), 'listbox');
  const wordBottom = await teamWord.evaluate(b => Math.round(b.getBoundingClientRect().bottom)).catch(() => 0);
  await teamWord.click().catch(() => {}); await page.waitForTimeout(200);
  const m = await menu(page);
  const teams = await page.evaluate(() => [...document.getElementById('team').options].map(o => o.textContent.trim()));
  const current = await page.evaluate(() => document.getElementById('team').selectedOptions[0].textContent.trim());
  t(`${theme}: the team menu opens below the word with every team, current one selected and focused`,
    m && [m.options, m.selected, m.focused, m.top >= wordBottom && m.top <= wordBottom + 16, m.right <= 1440], [teams, [current], current, true, true]);
  t(`${theme}: the setup stays folded`, await page.evaluate(() => document.getElementById('setupMore').getAttribute('aria-expanded')), 'false');
  if (shots) await page.screenshot({path: join(shots, `menu-team-1440-${theme}.png`)});
  if (theme === 'dark') {
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter'); await page.waitForTimeout(200);
    const after = await page.evaluate(() => ({value: document.getElementById('team').selectedIndex, open: document.getElementById('sentenceMenu')?.checkVisibility() ?? false,
      focus: document.activeElement?.dataset?.field ?? null, sentence: document.getElementById('setupSentence').textContent}));
    t('keyboard: ↓ Enter chooses the second team, closes, focus back on the team word', [after.value, after.open, after.focus, after.sentence.includes(teams[1])], [1, false, 'team', true]);
    await word(page, 'team').click(); await page.waitForTimeout(150); await page.keyboard.press('Escape'); await page.waitForTimeout(150);
    t('Escape closes without a change, focus on the word', await page.evaluate(() => [(document.getElementById('sentenceMenu')?.checkVisibility() ?? false), document.getElementById('team').selectedIndex, document.activeElement?.dataset?.field]), [false, 1, 'team']);
    await word(page, 'team').click(); await page.waitForTimeout(150); await page.keyboard.press('Tab'); await page.waitForTimeout(150);
    t('Tab closes and moves on from the word, inside the page', await page.evaluate(() => [document.getElementById('sentenceMenu').checkVisibility(), !!document.activeElement && document.activeElement !== document.body && !document.activeElement.closest('#sentenceMenu')]), [false, true]);
    await word(page, 'team').click(); await page.waitForTimeout(150); await page.mouse.click(700, 700); await page.waitForTimeout(150);
    t('a click outside closes', await page.evaluate(() => (document.getElementById('sentenceMenu')?.checkVisibility() ?? false)), false);
    // The spoken language menu has the groups of its control.
    await page.evaluate(() => { const l = document.getElementById('language'); l.value = 'zh_ja'; l.dispatchEvent(new Event('change')); });
    await word(page, 'language').click(); await page.waitForTimeout(150);
    const lang = await menu(page);
    t('the spoken language menu: groups and 中日雙向自動 selected', lang && [lang.groups, lang.selected], [['語言與對話模式', '其他語言 · 效果可能因語言而異'], ['中日雙向自動']]);
    await page.keyboard.press('Escape');
    // A disabled control: its word is plain text.
    // A disabled control: while the audio test runs, the microphone word is plain text.
    await page.click('#setupMore'); await page.click('#testMic'); await page.waitForTimeout(1200);
    t('during the audio test the microphone word is plain text', await page.locator('#setupSentence button.sentence-pick[data-field="microphone"]').count(), 0);
    await page.click('#testMic'); await page.waitForTimeout(400);
    t('after the test the microphone word is a button again', await page.locator('#setupSentence button.sentence-pick[data-field="microphone"]').count(), 1);
    await page.click('#setupMore');
    // 即時口譯: 同步播放譯音 has two options.
    if (await page.evaluate(() => !!window.InterpretMode?.usable())) {
      await page.evaluate(() => setLiveMode('interpret'));
      await word(page, 'interpretPlay').click(); await page.waitForTimeout(150);
      const play = await menu(page);
      t('同步播放譯音 menu: two options', play?.options, ['同步播放譯音', '不播放譯音']);
      await page.locator('#sentenceMenu [role=option]', {hasText: '不播放譯音'}).click(); await page.waitForTimeout(150);
      t('choosing 不播放譯音 unchecks the switch and the sentence says so', await page.evaluate(() => [document.getElementById('interpretPlay').checked, document.getElementById('setupSentence').textContent.includes('不播放譯音')]), [false, true]);
    } else console.log('skip 同步播放譯音 menu (即時口譯 unavailable to this account)');
    t('no page error', errors, []);
  }
  await context.close();
}

// Microphone names are readable.
{
  const {context, page} = await open('/');
  const rows = [['Default - 麥克風 (IPEVO V4K PRO) (1778:d002)', '麥克風 (IPEVO V4K PRO)（系統預設）', '麥克風 (IPEVO V4K PRO)'],
    ['Communications - 麥克風 (IPEVO V4K PRO) (1778:d002)', '麥克風 (IPEVO V4K PRO)（通訊）', '麥克風 (IPEVO V4K PRO)'],
    ['麥克風 (Realtek(R) Audio)', '麥克風 (Realtek(R) Audio)', '麥克風 (Realtek(R) Audio)']];
  for (const [label, inMenu, inSentence] of rows) {
    const got = await page.evaluate(([label]) => {
      if (typeof micName !== 'function') return null;
      const el = document.getElementById('microphone'), o = new Option(micName(label), 'mic-x' + Math.random());
      el.append(o); el.value = o.value; el.dispatchEvent(new Event('change'));
      return [o.textContent, document.getElementById('setupSentence').textContent];
    }, [label]);
    t(`microphone: ${label}`, got && [got[0], got[1].includes(`從${inSentence}收音`) || got[1].includes(`從 ${inSentence}收音`)], [inMenu, true]);
  }
  await context.close();
}

// The header gives the brand room.
{
  const {context, page} = await open('/meetings');
  t('1440 header: 48px mark, 20px name, 16px links 40px high', await page.evaluate(() => [Math.round(document.querySelector('.topbar .brand-mark').getBoundingClientRect().width), getComputedStyle(document.querySelector('.topbar .brand b')).fontSize,
    [...document.querySelectorAll('#account > a')].filter(a => a.checkVisibility()).every(a => getComputedStyle(a).fontSize === '16px' && Math.round(a.getBoundingClientRect().height) === 40),
    Math.round(document.getElementById('themeToggle').getBoundingClientRect().height)]), [48, '20px', true, 40]);
  if (shots) await page.screenshot({path: join(shots, 'header-meetings-1440.png'), clip: {x: 0, y: 0, width: 1440, height: 160}});
  await context.close();
}
for (const width of [901, 960, 1101]) {
  const {context, page} = await open('/', {width});
  t(`${width}: no horizontal scroll`, await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await context.close();
}
{
  const {context, page} = await open('/', {width: 390, height: 844});
  t('390: the brand mark keeps its phone size', await page.evaluate(() => Math.round(document.querySelector('.topbar .brand-mark').getBoundingClientRect().width)), 38);   // as before this change
  await context.close();
}
await browser.close();
