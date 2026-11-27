const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const captureScreenshots = process.argv.includes('--screenshots');
const captureB3Screenshots = captureScreenshots || process.argv.includes('--b3-screenshots');
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

async function connectCdp(url, onEvent = () => {}) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  const pending = new Map();
  let nextId = 0;
  socket.addEventListener('message', ({ data }) => {
    const msg = JSON.parse(data);
    if (!msg.id) return onEvent(msg);
    const waiter = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) waiter.reject(new Error(msg.error.message));
    else waiter.resolve(msg.result);
  });
  socket.addEventListener('close', () => {
    for (const waiter of pending.values()) waiter.reject(new Error('Chrome DevTools socket closed'));
    pending.clear();
  });
  return {
    close: () => socket.close(),
    send(method, params = {}, sessionId) {
      return new Promise((resolve, reject) => {
        if (socket.readyState !== WebSocket.OPEN) return reject(new Error('Chrome DevTools socket is unavailable'));
        const id = ++nextId;
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params, sessionId }));
      });
    },
  };
}

async function evaluateIn(send, expression) {
  const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
  return response.result.value;
}

async function reloadPage(send, evaluate) {
  await evaluate('window.pdiVerifierBeforeReload = true');
  await send('Page.reload', { ignoreCache: true });
  await until(() => evaluate('window.pdiVerifierBeforeReload === undefined'), 'new document after reload');
}

async function main() {
  const devBefore = await devFingerprint();
  const control = pg('postgres');
  let created = false;
  let db, app, vite, chrome, page, browser, chromeProfile;
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
    async function api(route, method = 'GET', body, role = 'PLANNER', expectedStatus = 200) {
      const headers = { 'x-demo-role': role };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      const response = await fetch(apiUrl + '/api' + route, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body),
      });
      const payload = await response.json();
      assert.equal(response.status, expectedStatus, JSON.stringify(payload));
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
    const requests = [];
    const requestUrls = new Map();
    const cancelledRequests = [];
    const mutations = [];
    const exceptions = [];
    page = await connectCdp(pages.find((target) => target.type === 'page').webSocketDebuggerUrl, (msg) => {
      if (msg.method === 'Network.requestWillBeSent') {
        const { url, method, postData } = msg.params.request;
        requests.push(url);
        requestUrls.set(msg.params.requestId, url);
        if (method !== 'GET' && new URL(url).pathname.startsWith('/api/')) {
          mutations.push({ url: new URL(url).pathname, method, postData });
        }
      }
      if (msg.method === 'Network.loadingFailed' && msg.params.canceled) {
        const url = requestUrls.get(msg.params.requestId);
        if (url) cancelledRequests.push(url);
      }
      if (msg.method === 'Runtime.exceptionThrown') exceptions.push(msg.params.exceptionDetails.text);
    });
    const cdp = page.send;
    await cdp('Network.enable');
    await cdp('Page.enable');
    await cdp('Runtime.enable');
    const evaluate = (expression) => evaluateIn(cdp, expression);
    const setView = (width, height) => cdp('Emulation.setDeviceMetricsOverride',
      { width, height, deviceScaleFactor: 1, mobile: false });
    const tableRows = (count) => until(() => evaluate(`document.querySelectorAll('.vehicle-table tbody tr').length === ${count}
      && document.querySelector('.vehicle-results')?.getAttribute('aria-busy') === 'false'
      && document.querySelector('.results-count')?.textContent.startsWith('${count} ')`), count + ' table rows');
    const textAt = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent.trim()`);
    const textList = (selector) => evaluate(`[...document.querySelectorAll(${JSON.stringify(selector)})].map(el => el.textContent.trim())`);
    const reload = async (count) => {
      await reloadPage(cdp, evaluate);
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

    async function photo(name, batch = 'b2') {
      if (!(batch === 'b3' ? captureB3Screenshots : captureScreenshots)) return;
      const png = await cdp('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
      writeFileSync(path.join(root, 'docs/design', `task-5${batch}-${name}.png`), Buffer.from(png.data, 'base64'));
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

    async function pressEscape() {
      const event = { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 };
      await cdp('Input.dispatchKeyEvent', { type: 'keyDown', ...event });
      await cdp('Input.dispatchKeyEvent', { type: 'keyUp', ...event });
    }

    async function escapeDialog() {
      await pressEscape();
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

    async function resetFixtures(capacity = 200) {
      // Only plan fixtures are reset; seed vehicle changes are restored individually.
      await db.sequelize.query('DELETE FROM manual_exclusions; DELETE FROM plan_vehicles; DELETE FROM audit_events; DELETE FROM plans;');
      await api('/settings', 'PUT', { dailyCapacity: capacity }, 'ADMIN');
    }

    async function resetPlan(capacity = 200) {
      await resetFixtures(capacity);
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
    assert.equal(await exists('#submit-plan'), false);
    assert.ok(!requests.some(url => new URL(url).pathname === '/api/plan/replacement'));
    await click(recommendation);
    await totals(200, 262, 38);
    await waitPanel();
    assert.match(await textAt(replacement), /קיבולת מלאה/);
    assert.equal(await exists(replacementButton), false);
    assert.deepEqual(await textList('.quota-item .utilization-value'), ['55 / 55', '36 / 36', '44 / 32+12', '22 / 22', '43 / 28+15']);
    assert.deepEqual(await textList('.shipping-item .utilization-value'), ['51 / 65', '52 / 65', '49 / 65', '48 / 65']);
    await selectTab(2, 38);
    const reasons = await textList('tbody .plan-state-column .chip');
    assert.equal(reasons.filter(reason => reason === 'חסם פעיל').length, 29);
    assert.equal(reasons.filter(reason => reason === 'לא שוחרר ממכס').length, 9);
    await selectTab(3, 300);
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
    await until(() => cancelledRequests.some(url => new URL(url).searchParams.get('search') === 'PDI-00'), 'obsolete search aborted');
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
    await matches('#submit-plan-reason', 'רכבים לא זכאים');
    assert.equal(await evaluate("document.querySelector('#submit-plan').disabled"), true);
    const blockedSubmissions = mutationCount('/plan/submit');
    await click('#submit-plan');
    assert.equal(mutationCount('/plan/submit'), blockedSubmissions);
    assert.equal((await api('/plan/submit', 'POST', undefined, 'PLANNER', 409)).error, 'INELIGIBLE_VEHICLES_IN_PLAN');
    await photo('blocked-submission', 'b3');
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
    console.log('Chrome: blocker 500 recovery, all five codes, add/remove, selected warnings without membership edits, and PENDING_SHIPPING/APPROVED protection.');

    const submitPlan = '#submit-plan';
    const submissionReason = '#submit-plan-reason';
    const pendingLabel = 'ממתינה לאישור שילוח';

    async function excludeInBrowser(id, reason, note = '') {
      await focusVehicle(id);
      await rowDialog();
      await choose('הוצאה מהתכנית');
      await input(dialog + ' select', reason);
      if (note) await input(dialog + ' textarea', note);
      await submitDialog();
    }

    async function regenerateInBrowser() {
      await click(recommendation);
      await until(() => exists('.recommendation-dialog[open]'), 'regeneration dialog');
      await click('.recommendation-dialog button.recommendation-primary');
    }

    async function assertMembershipLocked() {
      assert.equal(await exists(submitPlan), false);
      assert.equal(await exists(recommendation), false);
      assert.equal(await exists(replacement), false);
      for (const [route, method, payload] of [
        ['/plan/generate', 'POST', { confirm: true }],
        ['/plan/submit', 'POST'],
        ['/plan/vehicles/PDI-023/exclude', 'POST', { reasonCode: 'OPERATIONAL_DELAY' }],
        ['/plan/vehicles/PDI-195/cancel-exclusion', 'POST'],
        ['/plan/replacement', 'GET'],
        ['/plan/replacement/confirm', 'POST', { vehicleId: 'PDI-200' }],
      ]) {
        const result = await api(route, method, payload, 'PLANNER', 409);
        assert.equal(result.error, 'PLAN_LOCKED', route);
      }
      for (const id of ['PDI-023', 'PDI-195']) {
        await focusVehicle(id);
        await rowDialog();
        assert.deepEqual(await textList(dialog + ' .vehicle-action-options button'), ['הוספת חסם']);
        await escapeDialog();
      }
    }

    await resetFixtures(195);
    await reload(300);
    await matches(status, 'טרם נוצרה תכנית');
    await click(recommendation);
    await totals(195, 262, 38);
    await matches(status, 'טיוטה');
    const at195 = await readPlan();
    assert.deepEqual(Object.fromEntries(Object.entries(at195.brandQuotaUtilization)
      .map(([brand, quota]) => [brand, quota.selected])), { Toyota: 55, Lexus: 36, GAC: 20, Geely: 42, Zeekr: 42 });
    assert.deepEqual(await textList('.quota-item .utilization-value'), ['55 / 55', '36 / 36', '42 / 32+10', '20 / 22', '42 / 28+14']);
    console.log('Chrome: §14 baseline and 195-capacity recommendations match exact quotas and baseline sources.');

    await resetPlan();
    await reload(300);
    await excludeInBrowser('PDI-195', 'OPERATIONAL_DELAY');
    await totals(199, 261, 39);
    const beforeEscape = mutationCount('/plan/generate');
    await click(recommendation);
    await until(() => exists('.recommendation-dialog[open]'), 'regeneration confirmation');
    assert.equal(await evaluate("document.activeElement.matches('.recommendation-dialog .recommendation-secondary')"), true);
    await pressEscape();
    await until(async () => !(await exists('.recommendation-dialog[open]')), 'regeneration Escape');
    assert.equal(mutationCount('/plan/generate'), beforeEscape);
    await regenerateInBrowser();
    await totals(200, 261, 39);
    assert.equal((await readVehicle('PDI-195')).inPlan, false);
    assert.ok((await readVehicle('PDI-195')).exclusion);
    await rowDialog();
    await choose('ביטול הוצאה ידנית');
    await submitDialog();
    await totals(200, 262, 38);
    assert.equal((await readVehicle('PDI-195')).inPlan, false);
    await regenerateInBrowser();
    await until(async () => (await readVehicle('PDI-195')).inPlan, 'cancelled exclusion returns after rerun');
    await totals(200, 262, 38);
    console.log('Chrome: §14 regeneration preserves an exclusion and returns the vehicle after explicit cancellation and regeneration.');

    const one = await resetPlan(1);
    await reload(300);
    await excludeInBrowser(one.selected[0].vehicle_id, 'OPERATIONAL_DELAY');
    await totals(0, 261, 39);
    assert.equal(await evaluate(`document.querySelector('${submitPlan}').disabled`), true);
    await matches(submissionReason, 'תכנית ריקה');
    const emptySubmissions = mutationCount('/plan/submit');
    await click(submitPlan);
    assert.equal(mutationCount('/plan/submit'), emptySubmissions);
    assert.equal((await api('/plan/submit', 'POST', undefined, 'PLANNER', 409)).error, 'EMPTY_PLAN');

    await resetPlan();
    await reload(300);
    await api('/vehicles/PDI-023/blocker', 'POST', { blockerCode: 'RECALL' });
    await click(submitPlan);
    await matches(alerts, 'רכבים לא זכאים');
    await totals(200, 261, 39);
    await matches(submissionReason, 'רכבים לא זכאים');
    assert.equal((await readPlan()).plan.status, 'DRAFT');
    await focusVehicle('PDI-023');
    await removeBlockerInBrowser();
    await totals(200, 262, 38);

    await api('/settings', 'PUT', { shippingCapacities: { 'נמל חיפה': 45 } }, 'ADMIN');
    await reload(300);
    const overflow = '.shipping-item .utilization-value.over-capacity';
    await matches(overflow, '52 / 45');
    assert.equal(await evaluate(`document.querySelector('${submitPlan}').disabled`), false);
    await photo('submission', 'b3');
    const submitsBeforeFailure = mutationCount('/plan/submit');
    failMutation = '/api/plan/submit';
    await click(submitPlan);
    await matches(alerts, 'לא התקבל אישור');
    await totals(200, 262, 38);
    assert.equal((await readPlan()).plan.status, 'DRAFT');
    delayMutation = '/api/plan/submit';
    await evaluate(`(() => {
      const button = document.querySelector('${submitPlan}');
      button.click();
      button.click();
    })()`);
    await until(() => evaluate(`document.querySelector('${submitPlan}').disabled &&
      document.querySelector('${recommendation}').disabled && document.querySelector('#role-select').disabled`), 'submission guard');
    await click(recommendation);
    await matches(status, pendingLabel);
    await totals(200, 262, 38);
    assert.equal(mutationCount('/plan/submit'), submitsBeforeFailure + 2, 'one failed request and one successful retry');
    const submitRequest = mutations.filter(({ url }) => url === '/api/plan/submit').at(-1);
    assert.equal(submitRequest.method, 'POST');
    assert.equal(submitRequest.postData, undefined);
    assert.equal(await db.AuditEvent.count({ where: { event_type: 'STATUS_TRANSITION' } }), 2);
    await photo('pending-shipping', 'b3');
    await assertMembershipLocked();
    assert.equal((await api('/plan/approve', 'POST', undefined, 'SHIPPING', 409)).error, 'SHIPPING_CAPACITY_EXCEEDED');
    assert.equal((await api('/plan/return', 'POST', { comment: '  ' }, 'SHIPPING', 400)).error, 'COMMENT_REQUIRED');
    const returnNote = 'יש לבדוק את חלוקת הרכבים לנמל חיפה';
    await api('/plan/return', 'POST', { comment: returnNote }, 'SHIPPING');
    await reload(300);
    await matches(status, 'הוחזרה לתיקון');
    await matches('.returned-note', returnNote);
    await photo('returned', 'b3');
    const exclusionNote = 'בדיקת התמדה בשני חלונות';
    await excludeInBrowser('PDI-195', 'OTHER', exclusionNote);
    await totals(199, 261, 39);
    await assertSuggestion('PDI-200');

    // Chrome browser contexts have separate storage but read the same persisted plan.
    await evaluate("localStorage.setItem('pdi-verifier-context', 'primary')");
    const version = await (await fetch('http://' + debugAddress + '/json/version')).json();
    browser = await connectCdp(version.webSocketDebuggerUrl);
    const { browserContextId } = await browser.send('Target.createBrowserContext', { disposeOnDetach: true });
    const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank', browserContextId });
    const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
    const otherCdp = (method, params) => browser.send(method, params, sessionId);
    const otherEvaluate = (expression) => evaluateIn(otherCdp, expression);
    await otherCdp('Page.enable');
    await otherCdp('Page.navigate', { url: site });
    await reload(300);
    await focusVehicle('PDI-195');
    await click('.exclusion-detail summary');
    await until(() => otherEvaluate("document.querySelectorAll('.vehicle-table tbody tr').length === 300"), 'second browser context ready');
    assert.equal(await otherEvaluate("localStorage.getItem('pdi-verifier-context')"), null);
    await reloadPage(otherCdp, otherEvaluate);
    await until(() => otherEvaluate("document.querySelectorAll('.vehicle-table tbody tr').length === 300"), 'second browser context reloaded');
    await otherEvaluate(`(() => {
      const search = document.querySelector('input[type=search]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(search, 'PDI-195');
      search.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await until(() => otherEvaluate("document.querySelectorAll('.vehicle-table tbody tr').length === 1 && document.querySelector('tbody th')?.textContent === 'PDI-195'"), 'second context exclusion row');
    await otherEvaluate("document.querySelector('.exclusion-detail summary').click()");
    const snapshot = `(() => {
      const value = (selector) => document.querySelector(selector)?.textContent.trim();
      return [value('.plan-status'), value('.returned-note'), value('.stat-tile-value'),
        value('.exclusion-detail[open]'), value('.shipping-item .utilization-value.over-capacity')];
    })()`;
    const persisted = await evaluate(snapshot);
    assert.deepEqual(await otherEvaluate(snapshot), persisted);
    assert.ok(persisted[1].includes(returnNote) && persisted[3].includes(exclusionNote));
    assert.equal(persisted[2], '199 / 200');
    assert.equal(persisted[4], '52 / 45');

    await assertSuggestion('PDI-200');
    await click(submitPlan);
    await matches(status, pendingLabel);
    await totals(199, 261, 39);
    assert.equal((await readPlan()).capacity.selected, 199);
    assert.equal(await auditCount('MANUAL_ADDITION'), 0);
    await assertMembershipLocked();
    await otherEvaluate("document.querySelector('#submit-plan').click()");
    await until(() => otherEvaluate("document.querySelector('.planner-actions [role=alert]')?.textContent.includes('התכנית נעולה')"),
      'stale submission rejected in the second context');
    await until(() => otherEvaluate(`document.querySelector('.plan-status')?.textContent === '${pendingLabel}' && !document.querySelector('#submit-plan')`),
      'stale context locks after refetch');
    await reloadPage(otherCdp, otherEvaluate);
    await until(() => otherEvaluate(`document.querySelector('.plan-status')?.textContent === '${pendingLabel}'`), 'second context reads resubmitted plan');
    assert.equal(await otherEvaluate("document.querySelector('.stat-tile-value').textContent"), '199 / 200');
    await browser.send('Target.disposeBrowserContext', { browserContextId });
    await api('/settings', 'PUT', { shippingCapacities: { 'נמל חיפה': 65 } }, 'ADMIN');
    await api('/plan/approve', 'POST', undefined, 'SHIPPING');
    await reload(300);
    await matches(status, 'אושרה');
    await assertMembershipLocked();
    console.log('Chrome: empty and blocked rejection, 200 with overflow, 199 resubmission without a replacement, locks in both statuses, and two-context persistence.');

    await input('#role-select', 'SHIPPING');
    await matches('main', 'יתווסף בשלב הבא');
    assert.equal(await exists('.vehicle-table'), false);
    await input('#role-select', 'ADMIN');
    await matches('main', 'יתווסף בשלב הבא');
    assert.equal(await exists(submitPlan), false);
    await input('#role-select', 'PLANNER');
    await tableRows(300);
    await matches(status, 'אושרה');
    assert.deepEqual(await evaluate(`[
      document.documentElement.dir,
      getComputedStyle(document.querySelector('tbody .identifier')).direction,
      getComputedStyle(document.querySelector('.vehicle-scroll thead th')).position
    ]`), ['rtl', 'ltr', 'sticky']);
    await setView(390, 844);
    assert.equal(await evaluate(`(() => {
      const { clientWidth, scrollWidth } = document.documentElement;
      const grid = document.querySelector('.vehicle-scroll');
      window.scrollTo(0, 850);
      return scrollWidth === clientWidth && grid.scrollWidth > grid.clientWidth && window.scrollY > 0;
    })()`), true);
    assert.deepEqual(exceptions, []);
    console.log('Chrome: role switching, isolated cancellation of obsolete requests, RTL/LTR, sticky desktop table and narrow viewport scrolling.');

  } finally {
    page?.close();
    browser?.close();
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
