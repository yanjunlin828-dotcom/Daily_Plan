const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');

const HEALTH_PATH = '/api/health';
const START_TIMEOUT_MS = 30000;

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function findAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, () => {
      const address = server.address();
      server.close(error => error ? reject(error) : resolve(address.port));
    });
  });
}

function readHealth(port, timeoutMs = 1000) {
  return new Promise((resolve, reject) => {
    const request = http.get({
      host: '127.0.0.1',
      port,
      path: HEALTH_PATH,
      agent: false,
      timeout: timeoutMs,
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch (error) {
          reject(error);
        }
      });
    });
    request.once('timeout', () => request.destroy(new Error('Health request timed out')));
    request.once('error', reject);
  });
}

function isExpectedHealth(value, appVersion, allowMissingVersion = false) {
  return Boolean(value
    && value.ok === true
    && value.appId === 'daily-plan'
    && value.apiVersion === 2
    && (value.appVersion === appVersion || (allowMissingVersion && !value.appVersion)));
}

function resolveBackendCommand({ rootDir, resourcesPath, isPackaged }) {
  const executableName = process.platform === 'win32' ? 'daily-plan-backend.exe' : 'daily-plan-backend';
  const candidates = isPackaged
    ? [
        path.join(resourcesPath, 'daily-plan-backend', executableName),
        path.join(resourcesPath, 'backend', executableName),
        path.join(resourcesPath, 'backend', 'daily-plan-backend', executableName),
      ]
    : [path.join(rootDir, 'output', 'backend-dist', 'daily-plan-backend', executableName)];
  const executable = candidates.find(candidate => fs.existsSync(candidate));
  if (executable) return { command: executable, prefixArgs: [], kind: 'bundled' };
  if (isPackaged) {
    throw new Error(`找不到内置后端程序：${candidates.join(' 或 ')}`);
  }
  return {
    command: process.env.DAILY_PLAN_PYTHON || 'python',
    prefixArgs: ['-m', 'backend.server'],
    kind: 'python',
  };
}

class BackendManager {
  constructor(options) {
    this.rootDir = options.rootDir;
    this.resourcesPath = options.resourcesPath;
    this.isPackaged = options.isPackaged;
    this.userDataDir = options.userDataDir;
    this.appVersion = options.appVersion;
    this.existingPort = options.existingPort || null;
    this.legacyDatabase = options.legacyDatabase || null;
    this.onUnexpectedExit = options.onUnexpectedExit || (() => {});
    this.child = null;
    this.port = null;
    this.owned = false;
    this.ready = false;
    this.stopping = false;
  }

  get apiOrigin() {
    if (!this.port) throw new Error('Backend is not ready');
    return `http://127.0.0.1:${this.port}`;
  }

  async healthMatches(port, allowMissingVersion = false) {
    try {
      return isExpectedHealth(await readHealth(port), this.appVersion, allowMissingVersion);
    } catch {
      return false;
    }
  }

  async start(preferredPort = null) {
    if (this.ready && this.port && await this.healthMatches(this.port)) return this.port;
    if (this.child && this.child.exitCode === null) await this.stop();
    this.stopping = false;

    if (!preferredPort && this.existingPort && await this.healthMatches(this.existingPort, true)) {
      this.port = this.existingPort;
      this.owned = false;
      this.ready = true;
      return this.port;
    }

    const command = resolveBackendCommand(this);
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const port = attempt === 0 && preferredPort ? preferredPort : await findAvailablePort();
      try {
        this.stopping = false;
        await this.spawnAndWait(command, port);
        return port;
      } catch (error) {
        lastError = error;
        await this.stop();
      }
    }
    throw lastError || new Error('本地后端启动失败');
  }

  async spawnAndWait(command, port) {
    const logsDir = path.join(this.userDataDir, 'logs');
    fs.mkdirSync(logsDir, { recursive: true });
    fs.mkdirSync(this.userDataDir, { recursive: true });
    const logPath = path.join(logsDir, 'backend.log');
    const logDescriptor = fs.openSync(logPath, 'a');
    const args = [
      ...command.prefixArgs,
      '--data-dir', this.userDataDir,
      '--port', String(port),
      '--log-level', 'warning',
    ];
    const targetDatabase = path.join(this.userDataDir, 'data.db');
    if (this.legacyDatabase && fs.existsSync(this.legacyDatabase) && !fs.existsSync(targetDatabase)) {
      args.push('--migrate-from', this.legacyDatabase);
    }

    let child;
    try {
      child = spawn(command.command, args, {
        cwd: this.isPackaged ? this.resourcesPath : this.rootDir,
        env: {
          ...process.env,
          DAILY_PLAN_DATA_DIR: this.userDataDir,
          DAILY_PLAN_DB_PATH: targetDatabase,
        },
        windowsHide: true,
        stdio: ['ignore', logDescriptor, logDescriptor],
      });
    } finally {
      fs.closeSync(logDescriptor);
    }

    this.child = child;
    this.port = port;
    this.owned = true;
    this.ready = false;
    let spawnError = null;
    child.once('error', error => { spawnError = error; });
    child.once('exit', (code, signal) => {
      if (this.child !== child) return;
      const wasReady = this.ready;
      this.child = null;
      this.ready = false;
      this.owned = false;
      if (wasReady && !this.stopping) this.onUnexpectedExit({ code, signal, port });
    });

    const deadline = Date.now() + START_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null) throw new Error(`本地后端提前退出，代码 ${child.exitCode}。日志：${logPath}`);
      if (await this.healthMatches(port)) {
        this.ready = true;
        return;
      }
      await delay(200);
    }
    throw new Error(`本地后端未在 30 秒内就绪。日志：${logPath}`);
  }

  async stop() {
    this.stopping = true;
    this.ready = false;
    const child = this.child;
    this.child = null;
    this.port = null;
    if (!child || child.exitCode !== null) {
      this.owned = false;
      return;
    }
    await new Promise(resolve => {
      const timeout = setTimeout(() => {
        try { child.kill(); } catch {}
        resolve();
      }, 5000);
      child.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
      try {
        child.kill();
      } catch {
        clearTimeout(timeout);
        resolve();
      }
    });
    this.owned = false;
  }
}

module.exports = {
  BackendManager,
  findAvailablePort,
  isExpectedHealth,
  readHealth,
  resolveBackendCommand,
};
