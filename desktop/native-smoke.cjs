const assert = require('node:assert/strict');
const path = require('node:path');
const { app, BrowserWindow, ipcMain, screen } = require('electron');

const profileDirectory = path.resolve(__dirname, `../.tmp/native-smoke-profile-${process.pid}`);
const dataDirectory = path.resolve(__dirname, `../.tmp/native-smoke-data-${process.pid}`);
app.setPath('userData', profileDirectory);
process.env.DAILY_PLAN_DATA_DIR = dataDirectory;
process.env.DAILY_PLAN_PROFILE_DIR = profileDirectory;
delete process.env.DAILY_PLAN_EXISTING_BACKEND_PORT;

require('./main.cjs');

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function waitForWindow(title, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const window = BrowserWindow.getAllWindows().find(candidate => candidate.getTitle() === title);
    if (window) return window;
    await wait(100);
  }
  throw new Error(`Timed out waiting for Electron window: ${title}`);
}

async function waitForRenderer(window, expression, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      return await window.webContents.executeJavaScript(expression);
    } catch (error) {
      lastError = error;
      await wait(100);
    }
  }
  throw lastError || new Error('Timed out waiting for renderer');
}

app.whenReady().then(async () => {
  const [orb, panel] = await Promise.all([
    waitForWindow('Daily Plan Orb'),
    waitForWindow('Daily Plan Quick Panel'),
  ]);
  const backendConnection = await waitForRenderer(panel, `DailyPlanApi.getData().then(data => ({
    port: Number(new URLSearchParams(location.search).get('apiPort')),
    hasRevisions: Boolean(data.revisions),
  }))`);
  const orbPort = Number(new URL(orb.webContents.getURL()).searchParams.get('apiPort'));
  assert.ok(backendConnection.port >= 1 && backendConnection.port <= 65535);
  assert.equal(orbPort, backendConnection.port);
  assert.equal(backendConnection.hasRevisions, true);
  assert.equal(await panel.webContents.executeJavaScript("Boolean(document.querySelector('#quit-button'))"), true);
  const send = (name, window, payload) => ipcMain.emit(name, { sender: window.webContents }, payload);

  send('panel:set-pinned', panel, true);
  for (let index = 0; index < 3; index += 1) {
    send('panel:toggle', orb);
    await wait(100);
    assert.equal(panel.isVisible(), true);
    send('panel:toggle', orb);
    await wait(220);
    assert.equal(panel.isVisible(), false);
  }

  send('panel:toggle', orb);
  send('panel:toggle', orb);
  send('panel:toggle', orb);
  await wait(250);
  assert.equal(panel.isVisible(), true);
  send('panel:close', panel);
  await wait(220);

  const area = screen.getPrimaryDisplay().workArea;
  orb.setPosition(area.x + 3, area.y + 100);
  let point = { x: area.x + 30, y: area.y + 135 };
  const originalCursorPosition = screen.getCursorScreenPoint;
  screen.getCursorScreenPoint = () => point;
  try {
    send('orb:drag-start', orb);
    point = { x: area.x + 40, y: area.y + 145 };
    await wait(70);
    send('orb:drag-end', orb);
    assert.equal(orb.getBounds().x, area.x);
    point = { x: area.x + 200, y: area.y + 200 };
    await wait(1450);
    assert.equal(await orb.webContents.executeJavaScript('document.body.dataset.collapsed'), 'true');
    point = { x: area.x + 10, y: orb.getBounds().y + 36 };
    await wait(350);
    assert.equal(await orb.webContents.executeJavaScript('document.body.dataset.collapsed'), 'false');
  } finally {
    screen.getCursorScreenPoint = originalCursorPosition;
  }

  console.log('PASS: isolated backend, repeated panel transitions, edge snap, collapse, reveal, and panel quit');
  await panel.webContents.executeJavaScript("document.querySelector('#quit-button').click()");
}).catch(error => {
  console.error(error);
  app.exit(1);
});
