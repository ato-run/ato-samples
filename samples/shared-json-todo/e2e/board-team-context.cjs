const { chromium } = require('playwright');
const { readFile } = require('node:fs/promises');
const BASE = process.env.COORDINATOR_URL || 'http://127.0.0.1:8802';
const token = 'smoke';
const call = async (method, path, body) => {
  const response = await fetch(BASE + path, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: response.status, body: parsed };
};
(async () => {
  const source = await readFile(process.env.SAMPLE_HANDLER, 'utf8');
  for (const operation of ['todo_board', 'todo_team_board']) {
    const registered = await call('POST', '/v1/protocols/todo.board@1/operations', {
      operation, semantics: 'observation', access: 'read',
      module_source: source, module_export: 'boardDocument', publisher: 'alice/app',
    });
    if (registered.status !== 201) throw new Error('register failed ' + JSON.stringify(registered.body));
  }
  const makeBoard = async (taskId, title) => {
    const created = await call('POST', '/v1/data-resources', {
      protocol: 'todo.board@1',
      document: { tasks: { [taskId]: { id: taskId, title, columnId: 'todo', order: 1000, subtasks: [], createdAt: '2026-11-10T00:00:00.000Z', updatedAt: '2026-11-10T00:00:00.000Z' } }, columns: [{ id: 'todo', title: 'Todo', order: 1000 }], revision: 1 },
    });
    if (created.status !== 201) throw new Error('resource failed ' + JSON.stringify(created.body));
    return created.body.resource_id;
  };
  const personal = await makeBoard('p1', 'Personal task');
  const team = await makeBoard('t1', 'Team task');
  const bind = async (resourceId, port) => {
    const bound = await call('POST', `/v1/data-resources/${resourceId}/bindings`, {
      port, protocol: 'todo.board@1', access: 'operations',
      operations: [port === 'team_tasks' ? 'todo_team_board' : 'todo_board'],
      instance_id: 'board-ui',
    });
    if (bound.status !== 201) throw new Error('bind failed ' + JSON.stringify(bound.body));
  };
  await bind(personal, 'tasks');
  await bind(team, 'team_tasks');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  let text = await page.locator('body').innerText();
  console.log('personal visible:', text.includes('Personal task'), '| team visible:', text.includes('Team task'));
  const selector = page.locator('#boardSelect');
  console.log('selector options:', await selector.locator('option').allInnerTexts());
  await selector.selectOption('team_tasks');
  await page.waitForTimeout(3000);
  text = await page.locator('body').innerText();
  console.log('after switch -> team visible:', text.includes('Team task'), '| personal visible:', text.includes('Personal task'));
  const mergedPromise = (async () => {
    await selector.selectOption('all');
    await page.waitForTimeout(3500);
    const merged = await page.locator('body').innerText();
    return {
      both: merged.includes('Personal task') && merged.includes('Team task'),
      readOnly: await page.evaluate(() => Boolean(window.__atoBoardReadOnly)),
    };
  })();
  const merged = await mergedPromise;
  console.log('all view -> both visible:', merged.both, '| read-only:', merged.readOnly);
  console.log('page errors:', errors.length ? errors.slice(0, 3) : 'none');
  await page.screenshot({ path: '/Users/egamikohsuke/Ekoh/projects/ato-run/.tmp/board-team-context.png', fullPage: false });
  await browser.close();
  if (!text.includes('Team task')) throw new Error('team board did not load');
  console.log('PASS: one Task Board instance switched from the personal to the team Resource');
})().catch((error) => { console.error(error); process.exit(1); });