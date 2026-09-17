const crypto = require('node:crypto');
const fs = require('node:fs');
const https = require('node:https');
const path = require('node:path');

const { createWindowsInstaller } = require('electron-winstaller');
const packageJson = require('../package.json');

const ROOT_DIR = path.resolve(__dirname, '..');
const APP_DIRECTORY = path.join(ROOT_DIR, 'output', 'forge', 'Daily Plan-win32-x64');
const OUTPUT_DIRECTORY = path.join(
  ROOT_DIR,
  'output',
  'forge',
  'make',
  'squirrel.windows',
  'x64',
);
const CACHE_DIRECTORY = path.join(ROOT_DIR, '.tmp', 'installer-tools');
const VENDOR_DIRECTORY = path.join(CACHE_DIRECTORY, 'electron-winstaller-vendor');
const NUGET_VERSION = '7.9.0';
const NUGET_URL = `https://dist.nuget.org/win-x86-commandline/v${NUGET_VERSION}/nuget.exe`;
const NUGET_SHA256 = '992d70cac5b06c38efec91806caba64cdcc07e6d963a0959dbbbaf264d33b800';
const NUGET_PATH = path.join(CACHE_DIRECTORY, `nuget-${NUGET_VERSION}.exe`);

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function assertGeneratedPath(target) {
  const relative = path.relative(ROOT_DIR, path.resolve(target));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`拒绝清理项目外路径：${target}`);
  }
}

function download(url, destination, redirects = 0) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, response => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        if (redirects >= 5) {
          reject(new Error('NuGet 下载重定向次数过多。'));
          return;
        }
        download(new URL(response.headers.location, url).toString(), destination, redirects + 1)
          .then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`NuGet 下载失败：HTTP ${response.statusCode}`));
        return;
      }
      const temporary = `${destination}.download`;
      const output = fs.createWriteStream(temporary, { flags: 'wx' });
      response.pipe(output);
      output.on('finish', () => {
        output.close(() => {
          fs.renameSync(temporary, destination);
          resolve();
        });
      });
      output.on('error', error => {
        response.destroy();
        fs.rmSync(temporary, { force: true });
        reject(error);
      });
    });
    request.on('error', reject);
  });
}

async function ensureNuget() {
  fs.mkdirSync(CACHE_DIRECTORY, { recursive: true });
  if (fs.existsSync(NUGET_PATH) && sha256(NUGET_PATH) !== NUGET_SHA256) {
    fs.rmSync(NUGET_PATH, { force: true });
  }
  if (!fs.existsSync(NUGET_PATH)) {
    console.log(`Downloading NuGet ${NUGET_VERSION} from ${NUGET_URL}`);
    await download(NUGET_URL, NUGET_PATH);
  }
  const actualHash = sha256(NUGET_PATH);
  if (actualHash !== NUGET_SHA256) {
    fs.rmSync(NUGET_PATH, { force: true });
    throw new Error(`NuGet 校验失败：${actualHash}`);
  }
}

async function main() {
  if (process.platform !== 'win32') {
    throw new Error('Daily Plan 的 Squirrel 安装器必须在 Windows 上构建。');
  }
  if (!fs.existsSync(path.join(APP_DIRECTORY, 'Daily Plan.exe'))) {
    throw new Error('缺少已打包桌面程序，请先运行 electron-forge package。');
  }

  await ensureNuget();
  const bundledVendor = path.join(
    ROOT_DIR,
    'node_modules',
    'electron-winstaller',
    'vendor',
  );
  for (const generatedPath of [VENDOR_DIRECTORY, OUTPUT_DIRECTORY]) {
    assertGeneratedPath(generatedPath);
    fs.rmSync(generatedPath, { recursive: true, force: true });
  }
  fs.cpSync(bundledVendor, VENDOR_DIRECTORY, { recursive: true });
  fs.copyFileSync(NUGET_PATH, path.join(VENDOR_DIRECTORY, 'nuget.exe'));
  fs.mkdirSync(OUTPUT_DIRECTORY, { recursive: true });

  await createWindowsInstaller({
    appDirectory: APP_DIRECTORY,
    outputDirectory: OUTPUT_DIRECTORY,
    vendorDirectory: VENDOR_DIRECTORY,
    name: 'DailyPlan',
    authors: 'yanjunlin828-dotcom',
    description: 'Daily Plan 的本地优先每日计划与桌面悬浮球',
    exe: 'Daily Plan.exe',
    noMsi: true,
    setupExe: `DailyPlan-Setup-${packageJson.version}.exe`,
    setupIcon: path.join(ROOT_DIR, 'favicon.ico'),
    title: 'Daily Plan',
  });
  console.log(`Created installer: ${OUTPUT_DIRECTORY}`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
