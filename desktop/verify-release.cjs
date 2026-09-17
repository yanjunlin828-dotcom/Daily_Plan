const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const asar = require('@electron/asar');

const ROOT_DIR = path.resolve(__dirname, '..');
const SOURCE_ICON = path.join(ROOT_DIR, 'favicon.ico');

const REQUIRED_ASAR_ENTRIES = [
  'package.json',
  'desktop/main.cjs',
  'desktop/backend-manager.cjs',
  'desktop/preload.cjs',
  'floating/orb.html',
  'floating/panel.html',
  'shared/api.js',
  'node_modules/electron-squirrel-startup/index.js',
];
const FORBIDDEN_PATH = /(^|\/)(?:data\.db(?:-wal|-shm)?|backend\.log|\.env(?:\.[^/]*)?|__pycache__)(?:\/|$)/i;

function isFile(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function listFiles(directory) {
  const result = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...listFiles(fullPath));
    else result.push(fullPath);
  }
  return result;
}

function verifyPackagedApp(appDirectory) {
  const resourcesDirectory = path.join(appDirectory, 'resources');
  const asarPath = path.join(resourcesDirectory, 'app.asar');
  const backendExecutable = path.join(
    resourcesDirectory,
    'daily-plan-backend',
    'daily-plan-backend.exe',
  );
  const shortcutIcon = path.join(resourcesDirectory, 'favicon.ico');
  const desktopExecutable = path.join(appDirectory, 'Daily Plan.exe');

  assert.ok(isFile(desktopExecutable), `缺少桌面程序：${desktopExecutable}`);
  assert.ok(isFile(asarPath), `缺少 app.asar：${asarPath}`);
  assert.ok(isFile(backendExecutable), `缺少内置后端：${backendExecutable}`);
  assert.ok(isFile(shortcutIcon), `缺少独立快捷方式图标：${shortcutIcon}`);
  assert.deepEqual(
    fs.readFileSync(shortcutIcon),
    fs.readFileSync(SOURCE_ICON),
    '发布包中的快捷方式图标与源码 favicon.ico 不一致',
  );

  const entries = asar.listPackage(asarPath, { isPack: false })
    .map(entry => entry.replace(/^[/\\]/, '').replaceAll('\\', '/'));
  const entrySet = new Set(entries);
  for (const required of REQUIRED_ASAR_ENTRIES) {
    assert.ok(entrySet.has(required), `app.asar 缺少运行文件：${required}`);
  }

  const forbiddenAsarEntries = entries.filter(entry => FORBIDDEN_PATH.test(entry));
  assert.deepEqual(forbiddenAsarEntries, [], `app.asar 包含禁止文件：${forbiddenAsarEntries.join(', ')}`);

  const looseFiles = listFiles(resourcesDirectory)
    .map(file => path.relative(resourcesDirectory, file).replaceAll('\\', '/'));
  const forbiddenLooseFiles = looseFiles.filter(file => FORBIDDEN_PATH.test(file));
  assert.deepEqual(forbiddenLooseFiles, [], `资源目录包含禁止文件：${forbiddenLooseFiles.join(', ')}`);

  const result = {
    appDirectory,
    desktopExecutable,
    backendExecutable,
    shortcutIcon,
    asarEntries: entries.length,
    desktopBytes: fs.statSync(desktopExecutable).size,
    backendBytes: fs.statSync(backendExecutable).size,
    shortcutIconBytes: fs.statSync(shortcutIcon).size,
  };
  return result;
}

if (require.main === module) {
  const target = process.argv[2];
  if (!target) {
    console.error('Usage: node desktop/verify-release.cjs <packaged-app-directory>');
    process.exitCode = 2;
  } else {
    const result = verifyPackagedApp(path.resolve(target));
    console.log(JSON.stringify(result, null, 2));
  }
}

module.exports = { verifyPackagedApp };
