const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const captureScreenshots = process.argv.includes('--screenshots');
const server = path.join(root, 'server');
const { Client } = require(server + '/node_modules/pg');
const database = 'union_pdi_test_b2_browser_' + process.pid;
assert.match(database, /^union_pdi_test_b2_browser_\d+$/);
process.env.NODE_ENV = 'test';
process.env.POSTGRES_DB_TEST = database;
const config = require(server + '/src/config/config').development;
assert.notEqual(database, config.database);

function pg(db, options) {
  return new Client({ host: config.host, port: config.port, user: config.username,
    password: config.password, database: db, options });
}
async function devFingerprint() {
  const client = pg(config.database, '-c default_transaction_read_only=on');
  await client.connect();
  try {
    const names = ['vehicles', 'plans', 'plan_vehicles', 'manual_exclusions', 'audit_events',
      'settings', 'brand_quotas', 'shipping_capacities'];
    return (await client.query('SELECT ' + names.map((name) =>
      `(SELECT json_build_array(count(*), md5(string_agg(to_jsonb(t)::text, ',' ORDER BY to_jsonb(t)::text))) FROM ${name} t) AS ${name}`,
    ).join(','))).rows[0];
  } finally {
    await client.end();
  }
}
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fn, label) {
  let latest;
  for (let tries = 0; tries < 125; tries++) {
    try { if (await fn()) return; } catch (error) { latest = error; }
    await pause(80);
  }
  throw new Error('Timed out: ' + label, { cause: latest });
}
async function waitForExit(child) {
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill();
    await Promise.race([new Promise((resolve) => child.once('exit', resolve)), pause(2500)]);
  }
}

async function main() {
  const devBefore = await devFingerprint();
  const control = pg('postgres');
  let created = false;
  let db, app, vite, chrome, socket, chromeProfile;
  await control.connect();
  try {
    await control.query('CREATE DATABASE "' + database + '"');
    created = true;
    execFileSync(server + '/node_modules/.bin/sequelize-cli', ['db:migrate', '--env', 'test'], { cwd: server, stdio: 'pipe' });
    db = require(server + '/src/models');
    assert.equal(db.sequelize.config.database, database);
    db.sequelize.options.logging = false;
    await require(server + '/src/scripts/seed').run();

    app = require(server + '/src/app')();
    app.log.level = 'silent';
    let failMutation;
    let delayMutation;
    let failReplacementRead = false;
    app.addHook('onRequest', async (request, reply) => {
      if (failReplacementRead && request.method === 'GET' && request.url === '/api/plan/replacement') {
        return reply.code(500).send({ error: 'INTERNAL_ERROR' });
      }
      if (request.method !== 'GET' && request.url === failMutation) {
        failMutation = undefined;
        return reply.code(500).send({ error: 'INTERNAL_ERROR' });
      }
      if (request.method !== 'GET' && request.url === delayMutation) {
        delayMutation = undefined;
        await pause(600);
      }
      if (request.url.includes('search=PDI-00&')) await pause(650);
    });
    const apiUrl = await app.listen({ port: 0, host: '127.0.0.1' });
    const ping = await (await fetch(apiUrl + '/ping')).json();
    assert.equal(ping.status, 'ok');
    async function api(route, method = 'GET', body, role = 'PLANNER') {
      const headers = { 'x-demo-role': role };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      const response = await fetch(apiUrl + '/api' + route, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body),
      });
      const payload = await response.json();
      assert.equal(response.status, 200, JSON.stringify(payload));
      return payload;
    }

    process.env.VITE_API_BASE_URL = '/api';
    const { createServer } = await import(root + '/client/node_modules/vite/dist/node/index.js');
    vite = await createServer({
      root: root + '/client',
      server: { host: '127.0.0.1', port: 0, strictPort: true, proxy: { '/api': apiUrl } },
    });
    await vite.listen();
    const site = 'http://127.0.0.1:' + vite.httpServer.address().port;
    assert.ok((await fetch(site)).ok);
    const proxiedPlan = await (await fetch(site + '/api/plan', { headers: { 'x-demo-role': 'PLANNER' } })).json();
    assert.deepEqual(proxiedPlan, { plan: null });
    console.log('Verified newly launched Vite and Fastify on isolated DB');

    let debugAddress;
    let chromeOutput = '';
    chromeProfile = mkdtempSync('/tmp/union-pdi-chrome-');
    chrome = spawn(process.env.PDI_CHROME_BIN || 'google-chrome', [
      '--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--remote-debugging-port=0', '--user-data-dir=' + chromeProfile, 'about:blank',
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    chrome.on('error', (error) => { chromeOutput += error.message; });
    chrome.stderr.on('data', (data) => {
      chromeOutput += data;
      const match = chromeOutput.match(/DevTools listening on ws:\/\/(127\.0\.0\.1:\d+)/);
      if (match) debugAddress = match[1];
    });
    try {
      await until(() => debugAddress, 'Chrome debugger');
    } catch (error) {
      console.error(chromeOutput.slice(-1500));
      throw error;
    }
    const pages = await (await fetch('http://' + debugAddress + '/json/list')).json();
    socket = new WebSocket(pages.find((page) => page.type === 'page').webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });
    let nextId = 0;
    const pending = new Map();
    const requests = [];
    const mutations = [];
    const exceptions = [];
    socket.addEventListener('message', ({ data }) => {
      const msg = JSON.parse(data);
      if (msg.method === 'Network.requestWillBeSent') {
        const { url, method, postData } = msg.params.request;
        requests.push(url);
        if (method !== 'GET' && new URL(url).pathname.startsWith('/api/')) {
          mutations.push({ url: new URL(url).pathname, method, postData });
        }
      }
      if (msg.method === 'Runtime.exceptionThrown') exceptions.push(msg.params.exceptionDetails.text);
      if (!msg.id) return;
      const waiter = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) waiter.reject(new Error(msg.error.message));
      else waiter.resolve(msg.result);
    });
    function cdp(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = ++nextId;
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    }
    await cdp('Network.enable');
    await cdp('Page.enable');
    await cdp('Runtime.enable');
    async function evaluate(expression) {
      const response = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
      return response.result.value;
    }
    const setView = (width, height) => cdp('Emulation.setDeviceMetricsOverride',
      { width, height, deviceScaleFactor: 1, mobile: false });
    const tableRows = (count) => until(() => evaluate(`document.querySelectorAll('.vehicle-table tbody tr').length === ${count}
      && document.querySelector('.vehicle-results')?.getAttribute('aria-busy') === 'false'
      && document.querySelector('.results-count')?.textContent.startsWith('${count} ')`), count + ' table rows');
    const textAt = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent.trim()`);
    const textList = (selector) => evaluate(`[...document.querySelectorAll(${JSON.stringify(selector)})].map(el => el.textContent.trim())`);
    const reload = async (count) => {
      await cdp('Page.reload', { ignoreCache: true });
      await tableRows(count);
      await until(() => evaluate("document.querySelectorAll('.quota-item').length === 5 && document.querySelectorAll('.shipping-item').length === 4 && document.querySelectorAll('.tab-count').length === 4"), 'loaded summaries');
    };
    async function selectTab(index, count) {
      const previousRequests = requests.length;
      await evaluate(`document.querySelectorAll('.tab')[${index}].click()`);
      const tab = ['in_plan', 'eligible_not_in_plan', 'ineligible', 'all'][index];
      await until(() => requests.slice(previousRequests).some((url) =>
        new URL(url).pathname === '/api/vehicles' && new URL(url).searchParams.get('tab') === tab
      ), 'API request for tab ' + tab);
      await tableRows(count);
      assert.equal(await evaluate(`document.querySelectorAll('.tab')[${index}].getAttribute('aria-pressed')`), 'true');
    }
    async function search(query) {
      await evaluate(`(() => {
        const el = document.querySelector('input[type=search]');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(query)});
        el.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
    }
    const rowAction = '.vehicle-row-action';
    const dialog = '.vehicle-action-dialog';
    const alerts = '.planner-actions [role=alert]';
    const recommendation = '.planner-actions > button';
    const replacement = '.replacement-panel';
    const replacementButton = replacement + ' button';
    const status = '.plan-status';
    const click = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    const exists = (selector) => evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
    const openDialog = () => exists(dialog + '[open]');
    const matches = (selector, text) => until(async () => (await textAt(selector))?.includes(text), text);
    const waitPanel = () => until(() => exists(replacement + '[aria-busy="false"]'), 'settled replacement');
    const readPlan = () => api('/plan');
    const readVehicle = async (id) => (await api('/vehicles?search=' + id)).vehicles[0];
    const mutationCount = (route) => mutations.filter(({ url }) => url === '/api' + route).length;
    const auditCount = (eventType) => db.AuditEvent.count({ where: { event_type: eventType } });

    async function choose(label) {
      await evaluate(`Array.from(document.querySelectorAll('${dialog} .vehicle-action-options button'))
        .find(button => button.textContent.trim() === ${JSON.stringify(label)}).click()`);
    }

    async function input(selector, value) {
      await evaluate(`(() => {
        const field = document.querySelector(${JSON.stringify(selector)});
        const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), 'value').set;
        setter.call(field, ${JSON.stringify(value)});
        field.dispatchEvent(new Event(field.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
      })()`);
    }

    async function photo(name) {
      if (!captureScreenshots) return;
      const png = await cdp('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
      writeFileSync(path.join(root, 'docs/design', 'task-5b2-' + name + '.png'), Buffer.from(png.data, 'base64'));
    }

    async function focusVehicle(id) {
      await search(id);
      await tableRows(1);
      assert.equal(await textAt('tbody th'), id);
    }

    async function rowDialog() {
      await evaluate(`document.querySelector('${rowAction}').focus()`);
      await click(rowAction);
      await until(openDialog, 'native vehicle dialog');
      assert.equal(await evaluate(`document.activeElement.closest('${dialog}') !== null`), true);
    }

    async function escapeDialog() {
      const event = { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 };
      await cdp('Input.dispatchKeyEvent', { type: 'keyDown', ...event });
      await cdp('Input.dispatchKeyEvent', { type: 'keyUp', ...event });
      await until(async () => !(await openDialog()), 'Escape close');
      assert.equal(await evaluate(`document.activeElement.matches('${rowAction}')`), true);
    }

    async function submitDialog() {
      await click(dialog + ' button[type=submit]');
      await until(async () => !(await openDialog()), 'submitted vehicle dialog closed');
    }

    async function totals(selected, eligible, ineligible) {
      await until(async () => {
        const values = await textList('.stat-tile-value');
        return values[2] === String(selected) && values[3] === String(eligible) && values[4] === String(ineligible) &&
          !(await exists('.planner-actions span[role=status]')) && !(await exists('.vehicle-results[aria-busy=true]'));
      }, `membership/eligibility totals ${selected}/${eligible}/${ineligible}`);
    }

    async function resetPlan(capacity = 200) {
      // Only plan fixtures are reset; seed vehicle changes are restored individually.
      await db.sequelize.query('DELETE FROM manual_exclusions; DELETE FROM plan_vehicles; DELETE FROM audit_events; DELETE FROM plans;');
      await api('/settings', 'PUT', { dailyCapacity: capacity }, 'ADMIN');
      return api('/plan/generate', 'POST');
    }

    async function assertSuggestion(id) {
      await waitPanel();
      assert.equal(await textAt('.replacement-candidate .identifier'), id);
    }

    await setView(1920, 1080);
    await cdp('Page.navigate', { url: site });
    await tableRows(300);
    await matches(status, 'טרם נוצרה תכנית');
    assert.equal(await exists(replacement), false);
    assert.ok(!requests.some(url => new URL(url).pathname === '/api/plan/replacement'));
    await click(recommendation);
    await totals(200, 262, 38);
    await waitPanel();
    assert.match(await textAt(replacement), /קיבולת מלאה/);
    assert.equal(await exists(replacementButton), false);
    assert.equal(await evaluate(`(() => {
      const grid = document.querySelector('.vehicle-scroll');
      const header = grid.querySelector('thead th');
      const panel = document.querySelector('${replacement}');
      const headTop = header.getBoundingClientRect().top;
      const panelTop = panel.getBoundingClientRect().top;
      grid.scrollTop = 750;
      const staysInPlace = grid.scrollTop > 0 && window.scrollY === 0 &&
        header.getBoundingClientRect().top === headTop && panel.getBoundingClientRect().top === panelTop;
      grid.scrollTop = 0;
      return staysInPlace;
    })()`), true);

    // An older search is delayed while the browser changes the table query twice.
    await search('PDI-00');
    await until(() => requests.some(url => new URL(url).searchParams.get('search') === 'PDI-00'), 'slow search started');
    await search('PDI-281');
    await focusVehicle('PDI-195');
    await pause(700);
    assert.equal(await textAt('tbody th'), 'PDI-195');
    await rowDialog();
    await escapeDialog();
    await rowDialog();
    await choose('הוצאה מהתכנית');
    await click(dialog + ' button[type=submit]');
    await matches(dialog + ' [role=alert]', 'יש לבחור');
    assert.deepEqual(await evaluate(`[...document.querySelectorAll('${dialog} select option')].slice(1).map(el => el.value)`),
      ['PRIORITIZED_OTHER', 'SECURITY_FORCES', 'OPERATIONAL_DELAY', 'ACCESSORY_ISSUE', 'AUTHORITY_INSTRUCTION', 'OTHER']);
    await input(dialog + ' select', 'OTHER');
    await input(dialog + ' textarea', '  ');
    await click(dialog + ' button[type=submit]');
    await matches(dialog + ' [role=alert]', 'יש להזין הערה');
    assert.equal(mutationCount('/plan/vehicles/PDI-195/exclude'), 0);
    await input(dialog + ' textarea', 'בדיקת הוצאה ידנית');
    await photo('exclusion-dialog');
    await click(dialog + ' .recommendation-dialog-actions button[type=button]');
    assert.equal(mutationCount('/plan/vehicles/PDI-195/exclude'), 0);
    await rowDialog();
    await choose('הוצאה מהתכנית');
    await input(dialog + ' select', 'OTHER');
    await input(dialog + ' textarea', 'בדיקת הוצאה ידנית');
    delayMutation = '/api/plan/vehicles/PDI-195/exclude';
    await evaluate(`(() => {
      const submit = document.querySelector('${dialog} button[type=submit]');
      submit.click();
      submit.click();
    })()`);
    await until(() => evaluate(`document.querySelector('${recommendation}').disabled &&
      document.querySelector('${rowAction}').disabled && document.querySelector('#role-select').disabled`), 'shared write guard');
    await click(recommendation);
    await totals(199, 261, 39);
    await assertSuggestion('PDI-200');
    assert.equal(mutationCount('/plan/vehicles/PDI-195/exclude'), 1);
    const exclusionPost = mutations.find(({ url }) => url === '/api/plan/vehicles/PDI-195/exclude');
    assert.equal(exclusionPost.method, 'POST');
    assert.deepEqual(JSON.parse(exclusionPost.postData), { reasonCode: 'OTHER', note: 'בדיקת הוצאה ידנית' });
    assert.equal(mutationCount('/plan/generate'), 1);
    assert.equal(await auditCount('MANUAL_ADDITION'), 0);
    assert.equal(await evaluate("document.querySelector('input[type=search]').value"), 'PDI-195');
    await photo('replacement-panel');
    const readOffset = requests.length;
    await reload(300);
    await assertSuggestion('PDI-200');
    assert.ok(requests.slice(readOffset).some(url => new URL(url).pathname === '/api/plan/replacement'));
    assert.equal(await auditCount('MANUAL_ADDITION'), 0);
    await selectTab(2, 39);
    await focusVehicle('PDI-195');
    await click('.exclusion-detail summary');
    const detail = await textAt('.exclusion-detail');
    assert.match(detail, /סיבה אחרת.*בדיקת הוצאה ידנית.*מיכל לוי.*PLANNER/s);
    assert.ok(await exists('.exclusion-detail time[datetime]'));
    await photo('persisted-exclusion');
    await evaluate(`(() => {
      const button = document.querySelector('${replacementButton}');
      button.click();
      button.click();
    })()`);
    await totals(200, 261, 39);
    await waitPanel();
    assert.equal(mutationCount('/plan/replacement/confirm'), 1);
    assert.deepEqual(JSON.parse(mutations.find(({ url }) => url === '/api/plan/replacement/confirm').postData),
      { vehicleId: 'PDI-200' });
    assert.equal(await auditCount('MANUAL_ADDITION'), 1);
    assert.equal((await readPlan()).selected.find(row => row.vehicle_id === 'PDI-200').source, 'MANUAL');
    assert.match(await textAt(replacement), /קיבולת מלאה/);
    console.log('Chrome: rapid filters, Escape and cancel, six reasons and whitespace validation, one exclusion, recovery after reload, one explicit PDI-195 → PDI-200 addition.');

    await resetPlan();
    await reload(300);
    await focusVehicle('PDI-281');
    await rowDialog();
    await choose('הוצאה מהתכנית');
    await input(dialog + ' select', 'OPERATIONAL_DELAY');
    await submitDialog();
    await totals(199, 261, 39);
    await assertSuggestion('PDI-107');
    await click(replacementButton);
    await totals(200, 261, 39);
    assert.equal((await readPlan()).selected.find(row => row.vehicle_id === 'PDI-107').source, 'MANUAL');
    assert.equal(await auditCount('MANUAL_ADDITION'), 1);
    console.log('Chrome: independent PDI-281 → PDI-107 exclusion and replacement restored exactly 200 members.');

    await resetPlan();
    await api('/plan/vehicles/PDI-195/exclude', 'POST', { reasonCode: 'OPERATIONAL_DELAY' });
    await reload(300);
    await assertSuggestion('PDI-200');
    assert.equal((await readVehicle('PDI-200')).active_blocker, 'NONE');
    await api('/vehicles/PDI-200/blocker', 'POST', { blockerCode: 'DAMAGE' });
    const confirmCount = mutationCount('/plan/replacement/confirm');
    await click(replacementButton);
    await matches(alerts, 'החלופה השתנתה');
    await waitPanel();
    const newCandidate = await textAt('.replacement-candidate .identifier');
    assert.ok(newCandidate && newCandidate !== 'PDI-200');
    assert.equal(mutationCount('/plan/replacement/confirm'), confirmCount + 1);
    assert.deepEqual(JSON.parse(mutations.filter(({ url }) => url === '/api/plan/replacement/confirm').at(-1).postData),
      { vehicleId: 'PDI-200' });
    assert.equal(await auditCount('MANUAL_ADDITION'), 0);
    await api('/plan/replacement/confirm', 'POST', { vehicleId: newCandidate });
    await click(replacementButton);
    await totals(200, 260, 40);
    await matches(alerts, 'החלופה השתנתה');
    await waitPanel();
    assert.match(await textAt(replacement), /קיבולת מלאה/);
    assert.equal(await exists(replacementButton), false);
    assert.equal(await auditCount('MANUAL_ADDITION'), 1);
    await api('/vehicles/PDI-200/blocker', 'DELETE');

    await resetPlan();
    await api('/plan/vehicles/PDI-195/exclude', 'POST', { reasonCode: 'OPERATIONAL_DELAY' });
    await api('/plan/submit', 'POST');
    await api('/plan/return', 'POST', { comment: 'בדיקת שחזור חלופה' }, 'SHIPPING');
    failReplacementRead = true;
    await reload(300);
    await matches(status, 'הוחזרה לתיקון');
    await matches(replacement + ' [role=alert]', 'טעינת החלופה נכשלה');
    failReplacementRead = false;
    await click(replacementButton);
    await assertSuggestion('PDI-200');
    await focusVehicle('PDI-200');
    await rowDialog();
    await choose('הוספת חסם');
    await input(dialog + ' select', 'DAMAGE');
    await submitDialog();
    await totals(199, 260, 40);
    await waitPanel();
    const candidateAfterBlocker = await textAt('.replacement-candidate .identifier');
    assert.ok(candidateAfterBlocker && candidateAfterBlocker !== 'PDI-200');
    await rowDialog();
    await choose('הסרת חסם');
    await submitDialog();
    await totals(199, 261, 39);
    await assertSuggestion('PDI-200');
    await focusVehicle('PDI-195');
    await rowDialog();
    await choose('ביטול הוצאה ידנית');
    await submitDialog();
    await totals(199, 262, 38);
    const reinstated = await readVehicle('PDI-195');
    assert.equal(reinstated.inPlan, false);
    assert.equal(reinstated.exclusion, null);
    assert.equal(await auditCount('EXCLUSION_CANCELLED'), 1);
    assert.equal(await auditCount('MANUAL_ADDITION'), 0);

    const expanded = await resetPlan(300);
    assert.ok(expanded.selected.length < 300);
    await api('/plan/vehicles/PDI-195/exclude', 'POST', { reasonCode: 'OPERATIONAL_DELAY' });
    await reload(300);
    await waitPanel();
    assert.match(await textAt(replacement), /אין כרגע חלופה מתאימה/);
    assert.equal(await exists(replacementButton), false);
    assert.deepEqual(await api('/plan/replacement'), { suggestedReplacement: null });
    console.log('Chrome: stale and concurrently full suggestions, RETURNED recovery and read retry, blocker-driven candidate changes, cancel without re-add, no available candidate.');

    await resetPlan();
    await reload(300);
    await focusVehicle('PDI-023');
    await rowDialog();
    await choose('הוספת חסם');
    assert.deepEqual(await evaluate(`[...document.querySelectorAll('${dialog} select option')].slice(1).map(el => el.value)`),
      ['RECALL', 'WORK_STOP', 'MISSING_ACCESSORY', 'DAMAGE', 'ZERO_KM_STOP']);
    await input(dialog + ' select', 'RECALL');
    await photo('blocker-controls');
    failMutation = '/api/vehicles/PDI-023/blocker';
    await submitDialog();
    await matches(alerts, 'לא התקבל אישור');
    await totals(200, 262, 38);
    assert.equal((await readVehicle('PDI-023')).active_blocker, 'NONE');
    await rowDialog();
    await choose('הוספת חסם');
    await input(dialog + ' select', 'RECALL');
    await submitDialog();
    await totals(200, 261, 39);
    await matches('.member-warning', 'חסם פעיל');
    assert.equal((await readPlan()).plan.status, 'DRAFT');
    assert.ok((await readPlan()).blockerWarnings.some(row => row.vehicle_id === 'PDI-023'));
    const removeBlockerInBrowser = async () => {
      await rowDialog();
      await choose('הסרת חסם');
      await submitDialog();
    };
    await removeBlockerInBrowser();
    await totals(200, 262, 38);
    assert.equal(await exists('.member-warning'), false);

    await api('/plan/vehicles/PDI-195/exclude', 'POST', { reasonCode: 'OPERATIONAL_DELAY' });
    await reload(300);
    await assertSuggestion('PDI-200');
    await api('/plan/submit', 'POST');
    await click(replacementButton);
    await matches(alerts, 'התכנית נעולה');
    await matches(status, 'ממתינה לאישור שילוח');
    assert.equal(await exists(replacement), false);
    assert.equal((await readPlan()).capacity.selected, 199);
    assert.equal(await auditCount('MANUAL_ADDITION'), 0);

    for (const [planStatus, label] of [['PENDING_SHIPPING', 'ממתינה לאישור שילוח'], ['APPROVED', 'אושרה']]) {
      if (planStatus === 'APPROVED') await api('/plan/approve', 'POST', undefined, 'SHIPPING');
      const start = requests.length;
      await reload(300);
      await matches(status, label);
      assert.equal(await exists(replacement), false);
      assert.ok(!requests.slice(start).some(url => new URL(url).pathname === '/api/plan/replacement'));
      await focusVehicle('PDI-195');
      await rowDialog();
      assert.deepEqual(await textList(dialog + ' .vehicle-action-options button'), ['הוספת חסם']);
      await escapeDialog();
      await focusVehicle('PDI-023');
      await rowDialog();
      assert.deepEqual(await textList(dialog + ' .vehicle-action-options button'), ['הוספת חסם']);
      await matches(dialog, 'שינוי חסם ישפיע על החיווי בלבד');
      await choose('הוספת חסם');
      await input(dialog + ' select', 'WORK_STOP');
      await submitDialog();
      await totals(199, 260, 40);
      await matches('.member-warning', 'חסם פעיל');
      const locked = await readPlan();
      assert.equal(locked.plan.status, planStatus);
      assert.equal(locked.capacity.selected, 199);
      assert.ok(locked.blockerWarnings.some(row => row.vehicle_id === 'PDI-023'));
      if (planStatus === 'APPROVED') {
        await search('');
        await tableRows(300);
        await photo('blocker-warning');
        await focusVehicle('PDI-023');
      }
      await removeBlockerInBrowser();
      await totals(199, 261, 39);
      assert.equal(await exists('.member-warning'), false);
      assert.equal((await readPlan()).plan.status, planStatus);
    }
    assert.deepEqual(exceptions, []);
    console.log('Chrome: blocker 500 recovery, all five codes, add/remove, selected warnings without membership edits, and PENDING_SHIPPING/APPROVED protection.');

  } finally {
    socket?.close();
    await waitForExit(chrome);
    if (chromeProfile) rmSync(chromeProfile, { recursive: true, force: true });
    if (vite) await vite.close();
    try {
      if (app) await app.close();
    } finally {
      if (db) await db.sequelize.close();
      if (created) await control.query('DROP DATABASE "' + database + '"');
      const testDbs = await control.query("SELECT datname FROM pg_database WHERE datname ~ '^union_pdi_test_.*[0-9]$'");
      await control.end();
      assert.deepEqual(testDbs.rows, [], 'temporary test databases remain');
      assert.deepEqual(await devFingerprint(), devBefore);
      console.log('Disposable browser DB removed and all eight development-table fingerprints unchanged.');
    }
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
