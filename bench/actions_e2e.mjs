// End-to-end acceptance for the action board (action-tracking, jira-style-board) in the real pages (Playwright,
// gstack's install), against a meeting whose minutes have at least one action item. It confirms one if needed,
// sets its due date to yesterday on the minutes page, then on the board drags it 進行中 → 已完成, drops it on
// 已取消 (reason required), edits it in the detail panel and puts it back to 未開始. It also creates an item on the
// board (board-created-actions), edits its content, finds it in the 看板新增 lane and deletes it. Exits 1 on any
// failed check.
// Usage: YUQIAO_SESSION=<token> node bench/actions_e2e.mjs <meeting id> <screenshot dir>
import {homedir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

const [meeting, out] = process.argv.slice(2);
const app = process.env.YUQIAO_APP || 'http://localhost:18082';
if (!process.env.YUQIAO_SESSION || !meeting || !out) { console.error('Usage: YUQIAO_SESSION=<token> node bench/actions_e2e.mjs <meeting id> <dir>'); process.exit(2); }
const {chromium} = (await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE || join(homedir(), '.claude/skills/gstack/node_modules/playwright/index.js')).href)).default;
const browser = await chromium.launch();
let failed = false, boardItem = null;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail !== '' ? ` ${JSON.stringify(detail)}` : ''}`); failed ||= !ok; };
const pad = n => String(n).padStart(2, '0');
const isoDay = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const yesterday = isoDay(new Date(Date.now() - 86400000));
try {
  const context = await browser.newContext({viewport: {width: 1440, height: 1000}});
  await context.addInitScript(() => localStorage.setItem('interpreter-theme', 'light'));
  await context.addCookies([{name: 'yq_session', value: process.env.YUQIAO_SESSION, url: `${app}/`}]);
  const page = await context.newPage();
  page.on('pageerror', e => check('no page errors', false, e.message));
  const saved = () => page.waitForResponse(r => r.request().method() === 'PATCH');

  // Navigation.
  await page.goto(`${app}/meetings`); await page.waitForSelector('#account a');
  check('top bar links to the board', await page.locator('#account a[href="/actions"]').count() === 1);

  // Minutes page: a confirmed action, due yesterday.
  await page.goto(`${app}/meetings/${meeting}/minutes`); await page.waitForSelector('.item');
  const actions = page.locator('.kind-section:nth-of-type(2)');
  if (!await actions.locator('.item.confirmed').count()) {
    await actions.locator('.item.proposed').first().getByText('確認', {exact: true}).click();
    await actions.locator('.item.confirmed').first().waitFor();
  }
  const itemId = (await actions.locator('.item.confirmed').first().getAttribute('id')).replace('item-', '');
  const item = () => page.locator(`#item-${itemId}`);
  if (await item().locator('select[aria-label="狀態"]').inputValue() !== 'todo')
    await Promise.all([page.waitForResponse(r => r.url().endsWith('/status')), item().locator('select[aria-label="狀態"]').selectOption('todo')]);
  if (await item().locator('input[aria-label="到期日"]').inputValue() !== yesterday)
    await Promise.all([saved(), item().locator('input[aria-label="到期日"]').fill(yesterday)]);
  await page.waitForFunction(id => document.querySelector(`#item-${id} .overdue`)?.textContent === '逾期 1 天', itemId);
  check('minutes page shows 逾期 1 天', true);

  // Board: compact cards.
  await page.goto(`${app}/actions`); await page.waitForSelector('.board-column');
  const card = () => page.locator(`#action-${itemId}`);
  check('card is compact: key, overdue chip and avatar, no status menu',
    await card().locator('.issue-key').textContent() === `#${itemId}` && await card().locator('.avatar-mini').count() === 1
    && await card().locator('select').count() === 0 && await card().locator('.due-chip.overdue').textContent() === '逾期 1 天');
  check('overdue card has the red stripe', await card().evaluate(n => n.classList.contains('is-overdue')));
  check('columns show their counts', /^\d+$/.test(await page.locator('.column-todo .column-count').textContent()));
  // 已完成: the count covers the shown cards plus those behind 另有 N 件較早完成, which expands them.
  const doneCount = Number(await page.locator('.column-done .column-count').textContent());
  const doneShown = await page.locator('.column-done .issue').count();
  const more = page.locator('.column-done .more-done');
  const hidden = await more.count() ? Number((await more.textContent()).match(/\d+/)[0]) : 0;
  check('done column counts shown and earlier items', doneCount === doneShown + hidden, [doneCount, doneShown, hidden]);
  if (hidden) { await more.click(); check('earlier done items expand', await page.locator('.column-done .issue').count() === doneCount); }
  await page.screenshot({path: join(out, 'board.png'), fullPage: true});

  // Drag to 進行中, then to 已完成.
  await card().dragTo(page.locator('.column-doing'));
  await page.waitForSelector(`.column-doing #action-${itemId}`);
  check('dragging to 進行中 changes the status', true);
  await card().dragTo(page.locator('.column-done'));
  await page.waitForSelector(`.column-done #action-${itemId}`);
  check('dragging to 已完成 changes the status and clears overdue', await card().locator('.due-chip.overdue').count() === 0);

  // Drop on 已取消: the panel asks for the reason; nothing changes without one.
  await page.click('.quick[data-key="cancelled"]'); await page.waitForSelector('.column-cancelled');
  await card().dragTo(page.locator('.column-cancelled'));
  await page.waitForSelector('#detail:not([hidden]) .status-reason:not([hidden])');
  check('dropping on 已取消 opens the panel asking for a reason', await page.locator(`.column-done #action-${itemId}`).count() === 1);
  await page.locator('#detail .status-reason button[type=submit]').click();
  check('no reason, no change', await page.locator('#detail .field-error').isVisible() && await page.locator(`.column-done #action-${itemId}`).count() === 1);
  await page.fill('#detail input[aria-label="取消原因"]', '驗收測試取消');
  await page.locator('#detail .status-reason button[type=submit]').click();
  await page.waitForSelector(`.column-cancelled #action-${itemId}`);
  await page.waitForFunction(() => document.querySelector('#detail .status-note')?.textContent.includes('驗收測試取消'));
  check('cancelled with the reason', true);
  await page.locator('#detail').getByText('歷程', {exact: true}).click();
  await page.waitForFunction(() => { const li = document.querySelector('#detail .status-history li'); return li && li.textContent !== '載入中…'; });
  const history = await page.locator('#detail .status-history li').allTextContents();
  check('history lists the changes newest first', history.length >= 3 && history[0].startsWith('已完成 → 已取消'), history.slice(0, 3));

  // Detail panel: owner and due date; the open card is in the address and survives a reload.
  await Promise.all([page.waitForResponse(r => r.url().endsWith('/status')), page.selectOption('#detail select[aria-label="狀態"]', 'todo')]);
  await page.waitForSelector(`.column-todo #action-${itemId}`);
  check('the open card is in the address', new URL(page.url()).searchParams.get('item') === itemId, page.url());
  const current = await page.inputValue('#detail select[aria-label="負責人"]');
  const owners = await page.locator('#detail select[aria-label="負責人"] option').evaluateAll(o => o.map(x => x.value).filter(Boolean));
  const other = owners.find(o => o !== current) || owners[0];
  await Promise.all([saved(), page.selectOption('#detail select[aria-label="負責人"]', other)]);
  await page.waitForFunction(who => document.querySelector('#detail select[aria-label="負責人"]')?.value === who, other);
  const later = isoDay(new Date(Date.now() + 5 * 86400000));
  await Promise.all([saved(), page.fill('#detail input[aria-label="到期日"]', later)]);
  await page.waitForFunction(id => !document.querySelector(`#action-${id}`)?.classList.contains('is-overdue'), itemId);
  check('panel edits owner and due date', true, [other, later]);
  await page.reload(); await page.waitForSelector('#detail:not([hidden])');
  check('shared card address reopens the panel', (await page.textContent('#detailKey')) === `#${itemId}`);
  await page.screenshot({path: join(out, 'board-detail.png')});
  await page.keyboard.press('Escape');
  check('Esc closes the panel and clears the address', await page.isHidden('#detail') && !page.url().includes('item='));
  // Restore the owner and yesterday's due date for the next run.
  await card().click(); await page.waitForSelector('#detail:not([hidden])');
  if (current) await Promise.all([saved(), page.selectOption('#detail select[aria-label="負責人"]', current)]);
  await page.waitForFunction(who => document.querySelector('#detail select[aria-label="負責人"]')?.value === who, current);
  await Promise.all([saved(), page.fill('#detail input[aria-label="到期日"]', yesterday)]);
  await page.keyboard.press('Escape');

  // Quick filters: exclusive within a kind, kept in the address.
  await page.click('.quick[data-key="cancelled"]');
  await page.click('.quick[data-key="due"][data-value="overdue"]'); await page.waitForFunction(() => location.search.includes('due=overdue'));
  await page.click('.quick[data-key="due"][data-value="week"]'); await page.waitForFunction(() => location.search.includes('due=week'));
  check('quick filters of one kind replace each other', await page.getAttribute('.quick[data-value="overdue"]', 'aria-pressed') === 'false'
    && await page.getAttribute('.quick[data-value="week"]', 'aria-pressed') === 'true');
  await page.click('.quick[data-key="due"][data-value="week"]'); await page.waitForFunction(() => !location.search.includes('due='));
  // Avatar filter.
  await page.locator('.avatar-button').first().click(); await page.waitForFunction(() => location.search.includes('owner='));
  await page.waitForTimeout(300);
  const shownOwners = await page.locator('.issue .avatar-mini').evaluateAll(a => [...new Set(a.map(x => x.title))]);
  check('avatar filter shows only that person', shownOwners.length <= 1, shownOwners);
  await page.locator('.avatar-button[aria-pressed="true"]').click(); await page.waitForFunction(() => !location.search.includes('owner='));
  // Swimlanes by owner.
  await page.selectOption('#group', 'owner'); await page.waitForSelector('.lane');
  check('grouping by owner shows swimlanes', await page.locator('.lane-toggle').count() >= 1 && page.url().includes('group=owner'));
  await page.reload(); await page.waitForSelector('.lane');
  check('grouping survives a reload', await page.inputValue('#group') === 'owner');
  await page.locator('.lane-toggle').first().click();
  check('a swimlane collapses', await page.locator('.lane.collapsed').count() === 1);
  await page.locator('.lane-toggle').first().click();
  await page.selectOption('#group', '');
  await page.goto(`${app}/actions?due=overdue`); await page.waitForSelector('.board-column');
  check('overdue filter shows the overdue item', await card().count() === 1);

  // New item on the board (board-created-actions): the button and c open the panel; empty content is not sent.
  await page.goto(`${app}/actions`); await page.waitForSelector('.board-column');
  await page.click('#create'); await page.waitForSelector('#detail:not([hidden]) .detail-create');
  check('＋ 新增待辦 opens the new-item panel', await page.textContent('#detailKey') === '新增待辦');
  await page.keyboard.press('Escape'); await page.waitForSelector('#detail', {state: 'hidden'});
  await page.locator('body').press('c'); await page.waitForSelector('#detail:not([hidden]) .detail-create');
  check('c opens the new-item panel', true);
  let posts = 0;
  page.on('request', r => { if (r.method() === 'POST' && r.url().endsWith('/api/actions')) posts++; });
  await page.click('#detail .detail-create button[type=submit]');
  check('empty content is not sent', posts === 0 && await page.isVisible('#detail .detail-create'));
  const text = `看板新增驗收 ${Date.now() % 100000}`;
  await page.fill('#detail textarea[aria-label="待辦內容"]', text);
  await page.selectOption('#detail select[aria-label="負責人"]', {index: 1});
  const soon = isoDay(new Date(Date.now() + 3 * 86400000));
  await page.fill('#detail input[aria-label="到期日"]', soon);
  const [created] = await Promise.all([page.waitForResponse(r => r.url().endsWith('/api/actions') && r.request().method() === 'POST'),
    page.click('#detail .detail-create button[type=submit]')]);
  boardItem = (await created.json()).id;
  await page.waitForSelector(`.column-todo #action-${boardItem}`);
  check('the new item is in 未開始 with source 看板新增', created.status() === 201 && (await page.textContent(`#action-${boardItem} .issue-source`)).includes('看板新增'));
  await page.waitForFunction(id => document.querySelector('#detailKey')?.textContent === `#${id}`, boardItem);
  check('the panel opens on the new item, with a delete button', await page.locator('#detail .detail-danger button').count() === 1);
  await page.screenshot({path: join(out, 'board-new-item.png')});
  // Edit the content in place.
  await page.click('#detail .detail-title-row button');
  await page.fill('#detail textarea[aria-label="待辦內容"]', `${text}（改）`);
  await page.keyboard.press('Enter');
  await page.waitForFunction(([id, t]) => document.querySelector(`#action-${id} .issue-summary`)?.textContent === t
    && document.querySelector('#detailTitle')?.textContent === t, [boardItem, `${text}（改）`]);
  check('editing the content updates the card and the panel', true);
  // Someone else saves first: the refusal stays visible and the text being typed is kept in the editor.
  await page.click('#detail .detail-title-row button');
  await page.fill('#detail textarea[aria-label="待辦內容"]', `${text}（衝突）`);
  await page.evaluate(async id => {
    const item = (await fetch('/api/actions').then(r => r.json())).items.find(i => i.id === id);
    await fetch(`/api/actions/${id}`, {method: 'PATCH', headers: {'content-type': 'application/json'}, body: JSON.stringify({version: item.version, dueDate: null})});
  }, boardItem);
  await page.locator('#detail textarea[aria-label="待辦內容"]').press('Enter');
  await page.waitForFunction(() => document.querySelector('#detailError')?.hidden === false
    && document.querySelector('#detail textarea[aria-label="待辦內容"]')?.value.endsWith('（衝突）'));
  check('a conflicting edit keeps its message and the typed text', (await page.textContent('#detailError')).includes('其他人'));
  await page.locator('#detail textarea[aria-label="待辦內容"]').press('Escape');
  await page.keyboard.press('Escape');
  // Grouped by source meeting: the 看板新增 lane comes last.
  await page.selectOption('#group', 'meeting'); await page.waitForSelector('.lane');
  const laneTitles = await page.locator('.lane-toggle b').allTextContents();
  check('board items form the 看板新增 lane, last', laneTitles.at(-1) === '看板新增', laneTitles);
  await page.selectOption('#group', '');
  // A meeting item cannot be deleted from the board; the board item can, after a second press.
  await card().click(); await page.waitForSelector('#detail:not([hidden])');
  check('a meeting item has no delete button', await page.locator('#detail .detail-danger').count() === 0);
  await page.click(`#action-${boardItem}`); await page.waitForFunction(id => document.querySelector('#detailKey')?.textContent === `#${id}`, boardItem);
  const remove = page.locator('#detail .detail-danger button');
  await remove.click();
  check('delete asks once more', (await remove.textContent()).includes('確定'));
  await remove.click();
  await page.waitForSelector(`#action-${boardItem}`, {state: 'detached'});
  check('deleting removes the item and closes the panel', await page.isHidden('#detail'));
  boardItem = null;

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
  await page.locator('.issue').first().click(); await page.waitForSelector('#detail:not([hidden])');
  check('panel fits a phone', !(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)));
  await page.screenshot({path: join(out, 'board-400.png')});
} catch (error) {
  check('run', false, `${error.message.split('\n')[0]} (line ${(error.stack.match(/actions_e2e\.mjs:(\d+)/) || [])[1]})`);
} finally {
  // A board item left by a failed check is removed.
  if (boardItem) await fetch(`${app}/api/actions/${boardItem}`, {method: 'DELETE', headers: {cookie: `yq_session=${process.env.YUQIAO_SESSION}`}}).catch(() => {});
  await browser.close();
}
process.exit(failed ? 1 : 0);
