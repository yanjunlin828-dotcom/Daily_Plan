const fs = require('node:fs');
const path = require('node:path');

const { version } = require('./package.json');
const { verifyPackagedApp } = require('./desktop/verify-release.cjs');

const ROOT_DIR = __dirname;
const ICON_PATH = path.join(ROOT_DIR, 'favicon.ico');
const BACKEND_DIRECTORY = path.join(ROOT_DIR, 'output', 'backend-dist', 'daily-plan-backend');
const BACKEND_EXECUTABLE = path.join(BACKEND_DIRECTORY, 'daily-plan-backend.exe');

function newestModifiedTime(target) {
  const stats = fs.statSync(target);
  if (!stats.isDirectory()) return stats.mtimeMs;
  return fs.readdirSync(target, { withFileTypes: true }).reduce((latest, entry) => {
    const child = path.join(target, entry.name);
    return Math.max(latest, newestModifiedTime(child));
  }, stats.mtimeMs);
}

function assertReleaseInputs() {
  if (!fs.existsSync(BACKEND_EXECUTABLE)) {
    throw new Error('缺少独立后端，请先运行 npm run backend:build。');
  }
  if (!fs.existsSync(ICON_PATH)) {
    throw new Error('缺少 Windows 图标 favicon.ico。');
  }

  const backendModifiedAt = fs.statSync(BACKEND_EXECUTABLE).mtimeMs;
  const backendInputs = [
    path.join(ROOT_DIR, 'backend', 'main.py'),
    path.join(ROOT_DIR, 'backend', 'server.py'),
    path.join(ROOT_DIR, 'backend', 'storage.py'),
    path.join(ROOT_DIR, 'backend', 'daily-plan-backend.spec'),
    path.join(ROOT_DIR, 'index.html'),
    path.join(ROOT_DIR, 'app.js'),
    path.join(ROOT_DIR, 'style.css'),
    path.join(ROOT_DIR, 'style'),
  ];
  const newestInput = Math.max(...backendInputs.map(newestModifiedTime));
  if (newestInput > backendModifiedAt) {
    throw new Error('独立后端早于源码，请先运行 npm run backend:build，避免发布旧代码。');
  }

  const forbidden = fs.readdirSync(BACKEND_DIRECTORY, { recursive: true })
    .map(name => String(name).replaceAll('\\', '/'))
    .filter(name => /(^|\/)(data\.db(?:-wal|-shm)?|backend\.log)$/i.test(name));
  if (forbidden.length) {
    throw new Error(`后端发布目录包含用户数据：${forbidden.join(', ')}`);
  }
}

module.exports = {
  outDir: path.join(ROOT_DIR, 'output', 'forge'),
  packagerConfig: {
    asar: true,
    executableName: 'Daily Plan',
    icon: ICON_PATH,
    // Keep the original artwork available outside app.asar as a stable
    // shortcut icon fallback. Windows can then use the exact source ICO
    // instead of depending only on icon extraction from the executable.
    extraResource: [BACKEND_DIRECTORY, ICON_PATH],
    ignore: [
      /[\\/](?:\.tmp|\.pytest_cache|\.playwright-cli|__pycache__|output|out|tests|gifs|backend)(?:[\\/]|$)/i,
      /[\\/]desktop[\\/](?:launch\.py|build-backend\.ps1|install-shortcuts\.ps1|smoke\.cjs|native-smoke\.cjs|verify-release\.cjs)$/i,
      /[\\/](?:forge\.config\.cjs|package-lock\.json|README\.md|CLAUDE\.md|DESKTOP_[^\\/]+\.md|TIME_FEATURE_PLAN\.md|屏幕录制[^\\/]*\.gif)$/i,
      /[\\/](?:[^\\/]+\.db(?:-wal|-shm)?|[^\\/]+\.log|\.env(?:\.[^\\/]*)?)$/i,
      /\.pyc$/i,
    ],
    win32metadata: {
      CompanyName: 'yanjunlin828-dotcom',
      FileDescription: 'Daily Plan 桌面悬浮球与每日计划',
      InternalName: 'DailyPlan',
      OriginalFilename: 'Daily Plan.exe',
      ProductName: 'Daily Plan',
      'requested-execution-level': 'asInvoker',
    },
  },
  hooks: {
    prePackage: async () => assertReleaseInputs(),
    postPackage: async (_config, result) => {
      for (const outputPath of result.outputPaths) verifyPackagedApp(outputPath);
    },
  },
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'DailyPlan',
        authors: 'yanjunlin828-dotcom',
        description: 'Daily Plan 的本地优先每日计划与桌面悬浮球',
        exe: 'Daily Plan.exe',
        noMsi: true,
        setupExe: `DailyPlan-Setup-${version}.exe`,
        setupIcon: ICON_PATH,
        title: 'Daily Plan',
      },
    },
  ],
};
