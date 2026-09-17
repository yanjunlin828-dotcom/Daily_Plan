const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const packagedExecutable = process.argv[2] ? path.resolve(process.argv[2]) : null;
const electronExecutable = packagedExecutable || require('electron');
const launchArguments = packagedExecutable ? [] : [ROOT_DIR];
const testRoot = path.join(ROOT_DIR, '.tmp', `single-instance-${process.pid}-${Date.now()}`);
const dataDirectory = path.join(testRoot, 'data');
const profileDirectory = path.join(testRoot, 'profile');
const environment = {
  ...process.env,
  DAILY_PLAN_DATA_DIR: dataDirectory,
  DAILY_PLAN_PROFILE_DIR: profileDirectory,
  DAILY_PLAN_SMOKE_TEST: '1',
  DAILY_PLAN_SMOKE_EXIT_MS: '7000',
};

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function startDesktop() {
  return spawn(electronExecutable, launchArguments, {
    cwd: packagedExecutable ? path.dirname(packagedExecutable) : ROOT_DIR,
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
}

function waitForExit(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    if (child.exitCode !== null) {
      resolve(child.exitCode);
      return;
    }
    const timeout = setTimeout(() => reject(new Error(`进程 ${child.pid} 未在 ${timeoutMs}ms 内退出`)), timeoutMs);
    child.once('error', error => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('close', code => {
      clearTimeout(timeout);
      resolve(code);
    });
  });
}

async function waitForFile(filePath, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(filePath)) return;
    await wait(100);
  }
  throw new Error(`等待文件超时：${filePath}`);
}

async function main() {
  const first = startDesktop();
  const firstOutput = [];
  first.stdout.on('data', chunk => firstOutput.push(chunk));
  first.stderr.on('data', chunk => firstOutput.push(chunk));
  await waitForFile(path.join(dataDirectory, 'data.db'));
  await wait(750);
  assert.equal(first.exitCode, null, `第一个实例提前退出：${Buffer.concat(firstOutput).toString('utf8')}`);

  const second = startDesktop();
  const secondCode = await waitForExit(second, 4000);
  assert.equal(secondCode, 0, '第二个实例应当正常退出');
  assert.equal(first.exitCode, null, '第二次启动不应关闭或替换已有实例');

  const firstCode = await waitForExit(first, 15000);
  assert.equal(firstCode, 0, `第一个实例退出异常：${Buffer.concat(firstOutput).toString('utf8')}`);
  console.log('PASS: a second shortcut launch exited without creating another desktop instance');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
