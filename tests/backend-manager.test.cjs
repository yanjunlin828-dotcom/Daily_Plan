const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');

const {
  BackendManager,
  isExpectedHealth,
  resolveBackendCommand,
} = require('../desktop/backend-manager.cjs');

const ROOT = path.resolve(__dirname, '..');

function withTimeout(promise, milliseconds, message) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(message)), milliseconds);
    promise.then(
      value => {
        clearTimeout(timeout);
        resolve(value);
      },
      error => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

test('health validation includes app and API versions', () => {
  assert.equal(isExpectedHealth({ ok: true, appId: 'daily-plan', appVersion: '0.1.0', apiVersion: 2 }, '0.1.0'), true);
  assert.equal(isExpectedHealth({ ok: true, appId: 'other', appVersion: '0.1.0', apiVersion: 2 }, '0.1.0'), false);
  assert.equal(isExpectedHealth({ ok: true, appId: 'daily-plan', appVersion: '0.2.0', apiVersion: 2 }, '0.1.0'), false);
  assert.equal(isExpectedHealth({ ok: true, appId: 'daily-plan', apiVersion: 2 }, '0.1.0'), false);
  assert.equal(isExpectedHealth({ ok: true, appId: 'daily-plan', apiVersion: 2 }, '0.1.0', true), true);
});

test('development resolves the bundled backend when it exists', () => {
  const resolved = resolveBackendCommand({ rootDir: ROOT, resourcesPath: ROOT, isPackaged: false });
  assert.equal(resolved.kind, 'bundled');
  assert.equal(path.basename(resolved.command), 'daily-plan-backend.exe');
});

test('matching existing backend is reused and not owned', async () => {
  const server = http.createServer((_request, response) => {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ ok: true, appId: 'daily-plan', appVersion: '0.1.0', apiVersion: 2 }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const manager = new BackendManager({
    rootDir: ROOT,
    resourcesPath: ROOT,
    isPackaged: false,
    userDataDir: path.join(ROOT, '.tmp', `backend-manager-reuse-${process.pid}`),
    appVersion: '0.1.0',
    existingPort: port,
  });
  try {
    assert.equal(await manager.start(), port);
    assert.equal(manager.owned, false);
    await manager.stop();
    assert.equal(server.listening, true);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('manager starts bundled backend on a dynamic port and stops it', async () => {
  const userDataDir = path.join(ROOT, '.tmp', `backend-manager-owned-${process.pid}-${Date.now()}`);
  const manager = new BackendManager({
    rootDir: ROOT,
    resourcesPath: ROOT,
    isPackaged: false,
    userDataDir,
    appVersion: '0.1.0',
  });
  const port = await manager.start();
  assert.ok(port >= 1 && port <= 65535);
  assert.equal(manager.owned, true);
  assert.equal(manager.ready, true);
  assert.equal(fs.existsSync(path.join(userDataDir, 'data.db')), true);
  await manager.stop();
  assert.equal(manager.owned, false);
  assert.equal(manager.child, null);
});

test('unexpected backend exit is reported and the same manager can recover', async () => {
  const userDataDir = path.join(ROOT, '.tmp', `backend-manager-restart-${process.pid}-${Date.now()}`);
  let reportExit;
  const unexpectedExit = new Promise(resolve => { reportExit = resolve; });
  const manager = new BackendManager({
    rootDir: ROOT,
    resourcesPath: ROOT,
    isPackaged: false,
    userDataDir,
    appVersion: '0.1.0',
    onUnexpectedExit: reportExit,
  });

  try {
    const originalPort = await manager.start();
    manager.child.kill();
    const exit = await withTimeout(unexpectedExit, 10000, 'backend exit callback was not called');
    assert.equal(exit.port, originalPort);
    assert.equal(manager.ready, false);
    const restartedPort = await manager.start(originalPort);
    assert.ok(restartedPort >= 1 && restartedPort <= 65535);
    assert.equal(manager.ready, true);
    assert.equal(manager.owned, true);
  } finally {
    await manager.stop();
  }
});
