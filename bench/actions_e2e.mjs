// End-to-end acceptance for action-tracking in the real pages (Playwright, gstack's install), against a meeting
// whose minutes have at least one action item. It confirms one if needed, sets its due date to yesterday, walks it
// through 進行中 → 已完成 → 已取消 (reason required) and back to 未開始. Exits 1 on any failed check.
// Usage: YUQIAO_SESSION=<token> node bench/actions_e2e.mjs <meeting id> <screenshot dir>
import {homedir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

const [meeting, out] = process.argv.slice(2);
const app = process.env.YUQIAO_APP || 'http://localhost:18082';
if (!process.env.YUQIAO_SESSION || !meeting || !out) { console.error('Usage: YUQIAO_SESSION=<token> node bench/actions_e2e.mjs <meeting id> <dir>'); process.exit(2); }
const {chromium} = (await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE || join(homedir(), '.claude/skills/gstack/node_modules/playwright/index.js')).href)).default;
const browser = await chromium.launch();
let failed = false;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail !== '' ? ` ${JSON.stringify(detail)}` : ''}`); failed ||= !ok; };
const pad = n => String(n).padStart(2, '0');
const yesterday = (() => { const d = new Date(Date.now() - 86400000); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; })();
try {
  const context = await browser.newContext({viewport: {width: 1440, height: 1000}});
  await context.addInitScript(() => localStorage.setItem('interpreter-theme', 'light'));
  await context.addCookies([{name: 'yq_session', value: process.env.YUQIAO_SESSION, url: `${app}/`}]);
  const page = await context.newPage();
  page.on('pageerror', e => check('no page errors', false, e.message));

  // Navigation.
  await page.goto(`${app}/meetings`); await page.waitForSelector('#account a');
  check('top bar links to the board', await page.locator('#account a[href="/actions"]').count() === 1);

  // Minutes page: a confirmed action, due yesterday, then 進行中.
  await page.goto(`${app}/meetings/${meeting}/minutes`); await page.waitForSelector('.item');
  const actions = page.locator('.kind-section:nth-of-type(2)');
  if (!await actions.locator('.item.confirmed').count()) {
    await actions.locator('.item.proposed').first().getByText('確認', {exact: true}).click();
    await actions.locator('.item.confirmed').first().waitFor();
  }
  const itemId = (await actions.locator('.item.confirmed').first().getAttribute('id')).replace('item-', '');
  const item = () => page.locator(`#item-${itemId}`);
  if (await item().locator('select[aria-label="狀態"]').inputValue() !== 'todo') {
    await Promise.all([page.waitForResponse(r => r.url().endsWith('/status')), item().locator('select[aria-label="狀態"]').selectOption('todo')]);
  }
  if (await item().locator('input[aria-label="到期日"]').inputValue() !== yesterday)
    await Promise.all([page.waitForResponse(r => r.request().method() === 'PATCH'), item().locator('input[aria-label="到期日"]').fill(yesterday)]);
  await page.waitForFunction(id => document.querySelector(`#item-${id} .overdue`)?.textContent === '逾期 1 天', itemId);
  check('minutes page shows 逾期 1 天', true);
  await item().locator('select[aria-label="狀態"]').selectOption('doing');
  await page.waitForFunction(id => document.querySelector(`#item-${id} .status-select`)?.classList.contains('status-doing'), itemId);
  check('status changed on the minutes page', true);

  // Board: the item is in 進行中, overdue in red; to 已完成 it moves and is no longer overdue.
  await page.goto(`${app}/actions`); await page.waitForSelector('.board-column');
  const card = () => page.locator(`#action-${itemId}`);
  check('board shows it under 進行中', await page.locator(`.column-doing #action-${itemId}`).count() === 1);
  const color = await card().locator('.overdue').evaluate(e => getComputedStyle(e).color);
  check('overdue badge is red', /^rgb\((2[0-9]{2}|1[5-9][0-9]),/.test(color), color);
  await page.screenshot({path: join(out, 'actions-board.png'), fullPage: true});
  await card().locator('select[aria-label="狀態"]').selectOption('done');
  await page.waitForSelector(`.column-done #action-${itemId}`);
  check('done moves the card and clears overdue', await card().locator('.overdue').count() === 0);

  // 已取消 needs a reason.
  await card().locator('select[aria-label="狀態"]').selectOption('cancelled');
  await card().locator('.status-reason button[type=submit]').click();
  check('cancel without a reason is not sent', await card().locator('.field-error').isVisible() && await page.locator(`.column-done #action-${itemId}`).count() === 1);
  await card().locator('input[aria-label="取消原因"]').fill('驗收測試取消');
  await card().locator('.status-reason button[type=submit]').click();
  await page.waitForFunction(id => !document.querySelector(`#action-${id}`), itemId);
  check('cancelled card leaves the default board', true);
  await page.check('#cancelled'); await page.waitForSelector(`.column-cancelled #action-${itemId}`);
  check('顯示已取消 shows it with the reason', (await card().locator('.status-note').textContent()).includes('驗收測試取消'));
  await card().getByText('歷程', {exact: true}).click();
  await page.waitForFunction(id => { const li = document.querySelector(`#action-${id} .status-history li`); return li && li.textContent !== '載入中…'; }, itemId);
  const history = await card().locator('.status-history li').allTextContents();
  check('history lists the changes newest first', history.length >= 3 && history[0].startsWith('已完成 → 已取消'), history.slice(0, 3));
  await card().locator('select[aria-label="狀態"]').selectOption('todo');
  await page.waitForSelector(`.column-todo #action-${itemId}`);

  // Filters live in the address and survive a reload.
  await page.uncheck('#cancelled');
  await page.selectOption('#due', 'overdue'); await page.waitForFunction(() => location.search.includes('due=overdue'));
  await page.selectOption('#owner', 'me'); await page.waitForFunction(() => location.search.includes('owner=me'));
  await page.reload(); await page.waitForSelector('.board-column');
  check('filters survive a reload', await page.inputValue('#due') === 'overdue' && await page.inputValue('#owner') === 'me', page.url());
  await page.goto(`${app}/actions?due=overdue`); await page.waitForSelector('.board-column');
  check('overdue filter shows the overdue item', await card().count() === 1);

  // Card link opens the minutes page at that item.
  await card().locator('.action-source').click(); await page.waitForSelector(`#item-${itemId}.linked`);
  check('card link opens the item on the minutes page', page.url().endsWith(`/meetings/${meeting}/minutes#item-${itemId}`));

  // A bookmarked team the user is not in falls back to all teams.
  await page.goto(`${app}/actions?team=999999`); await page.waitForSelector('.board-column');
  check('unknown team falls back to all teams', !page.url().includes('team=') && (await page.textContent('#notice')).includes('全部團隊'), page.url());

  // 400 px.
  await page.setViewportSize({width: 400, height: 860});
  await page.goto(`${app}/meetings`); await page.waitForSelector('#account a'); await page.waitForSelector('.meeting');
  check('board link visible on a phone', await page.locator('#account a[href="/actions"]').isVisible());
  check('no horizontal scroll on the list at 400 px', !(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)));
  await page.goto(`${app}/actions`); await page.waitForSelector('.board-column');
  check('no horizontal scroll at 400 px', !(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)));
  await page.screenshot({path: join(out, 'actions-400.png')});
} catch (error) {
  check('run', false, `${error.message.split('\n')[0]} (line ${(error.stack.match(/actions_e2e\.mjs:(\d+)/) || [])[1]})`);
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
