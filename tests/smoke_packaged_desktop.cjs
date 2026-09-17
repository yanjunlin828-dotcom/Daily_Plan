const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const appDirectory = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(ROOT_DIR, 'output', 'forge', 'Daily Plan-win32-x64');
const executable = path.join(appDirectory, 'Daily Plan.exe');
const testRoot = path.join(ROOT_DIR, '.tmp', `packaged-desktop-smoke-${process.pid}-${Date.now()}`);
const dataDirectory = path.join(testRoot, 'data');
const profileDirectory = path.join(testRoot, 'profile');

function isFile(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function runApplication() {
  return new Promise((resolve, reject) => {
    const output = [];
    const child = spawn(executable, [], {
      cwd: appDirectory,
      env: {
        ...process.env,
        DAILY_PLAN_DATA_DIR: dataDirectory,
        DAILY_PLAN_PROFILE_DIR: profileDirectory,
        DAILY_PLAN_SMOKE_TEST: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    child.stdout.on('data', chunk => output.push(chunk));
    child.stderr.on('data', chunk => output.push(chunk));
    child.once('error', reject);
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`打包桌面程序未按预期退出。\n${Buffer.concat(output).toString('utf8')}`));
    }, 60000);
    child.once('close', code => {
      clearTimeout(timeout);
      if (code === 0) resolve(Buffer.concat(output).toString('utf8'));
      else reject(new Error(`打包桌面程序退出代码 ${code}。\n${Buffer.concat(output).toString('utf8')}`));
    });
  });
}

async function main() {
  assert.ok(isFile(executable), `找不到打包桌面程序：${executable}`);
  await runApplication();
  const database = path.join(dataDirectory, 'data.db');
  assert.ok(isFile(database), '打包桌面程序没有在隔离目录创建数据库');
  const header = fs.readFileSync(database).subarray(0, 16).toString('ascii');
  assert.equal(header, 'SQLite format 3\0');
  assert.ok(isFile(path.join(dataDirectory, 'logs', 'backend.log')));
  console.log('PASS: packaged desktop launched its bundled backend, used isolated storage, and exited cleanly');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
