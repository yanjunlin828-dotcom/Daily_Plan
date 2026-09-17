const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const { version } = require('../package.json');

function sha256(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function hasHeader(filePath, expected) {
  const descriptor = fs.openSync(filePath, 'r');
  try {
    const actual = Buffer.alloc(expected.length);
    fs.readSync(descriptor, actual, 0, actual.length, 0);
    return actual.equals(expected);
  } finally {
    fs.closeSync(descriptor);
  }
}

function verifyInstallerDirectory(directory) {
  const names = fs.readdirSync(directory);
  const setupName = `DailyPlan-Setup-${version}.exe`;
  const setupPath = path.join(directory, setupName);
  const packages = names.filter(name => /-full\.nupkg$/i.test(name));
  const releasesPath = path.join(directory, 'RELEASES');

  assert.ok(fs.statSync(setupPath).isFile(), `缺少安装程序：${setupName}`);
  assert.equal(packages.length, 1, `应当只有一个 full.nupkg，实际为：${packages.join(', ')}`);
  assert.ok(fs.statSync(releasesPath).isFile(), '缺少 Squirrel RELEASES 索引');
  assert.ok(hasHeader(setupPath, Buffer.from('MZ')), 'Setup.exe 不是有效的 Windows PE 文件');

  const packagePath = path.join(directory, packages[0]);
  assert.ok(hasHeader(packagePath, Buffer.from('PK')), 'nupkg 不是有效的 ZIP/NuGet 文件');
  const releaseIndex = fs.readFileSync(releasesPath, 'utf8');
  assert.ok(releaseIndex.includes(packages[0]), 'RELEASES 没有引用生成的 nupkg');

  const artifactPaths = [setupPath, packagePath, releasesPath];
  const manifest = {
    product: 'Daily Plan',
    version,
    platform: 'win32',
    arch: 'x64',
    unsigned: true,
    artifacts: artifactPaths.map(filePath => ({
      name: path.basename(filePath),
      bytes: fs.statSync(filePath).size,
      sha256: sha256(filePath),
    })),
  };
  const manifestPath = path.join(directory, 'release-manifest.json');
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return { directory, manifestPath, ...manifest };
}

if (require.main === module) {
  const directory = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.join(ROOT_DIR, 'output', 'forge', 'make', 'squirrel.windows', 'x64');
  console.log(JSON.stringify(verifyInstallerDirectory(directory), null, 2));
}

module.exports = { verifyInstallerDirectory };
