import { cp, readFile, writeFile, mkdir, mkdtemp, rm, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const project = dirname(here);
const output = join(dirname(project), 'handoff');
const python = process.argv[2];
if (!python || process.arch !== 'arm64' || process.platform !== 'darwin') {
  throw Error('Use an Apple silicon Mac and pass the absolute path to the Python 3.12 build runtime.');
}
const stage = await mkdtemp(join(tmpdir(), 'independent-canvas-release-'));
try {
  const folder = join(stage, '独立画布');
  const app = join(folder, '独立画布.app');
  const resources = join(app, 'Contents', 'Resources');
  const application = join(resources, 'app');
  await mkdir(folder);
  await cp(join(here, 'node_modules/electron/dist/Electron.app'), app, {
    recursive: true, verbatimSymlinks: true
  });
  await mkdir(application, { recursive: true });
  for (const name of ['server.mjs', 'storage.mjs', 'image-inputs.mjs', 'web_fetch.mjs', 'extract_document.py']) {
    await cp(join(project, name), join(application, name));
  }
  for (const name of ['public', 'backend', 'third-party', 'vendor']) {
    await cp(join(project, name), join(application, name), {
      recursive: true,
      filter: path => !path.endsWith('.test.mjs') && !path.includes('__pycache__')
    });
  }
  for (const name of ['main.cjs', 'preload.cjs']) await cp(join(here, name), join(application, name));
  await writeFile(join(application, 'package.json'), JSON.stringify({
    name: 'independent-canvas', version: '1.0.0', type: 'module', main: 'main.cjs'
  }));
  await writeFile(join(application, 'desktop-config.json'), '{"portable":true}');
  // Keep the distributed app's name and sample distinct from the reference product.
  const html = join(application, 'public/index.html');
  await writeFile(html, (await readFile(html, 'utf8'))
    .replace('Slashspace · 独立工作台', '独立画布')
    .replace('/⌣</span> slashspace <span class="pill">LOCAL</span>', '▧</span> 独立画布')
    .replace('Canvas-first AI workspace', 'AI 工作台')
    .replace('<span class="replica-label">本地还原版</span>', ''));
  const ui = join(application, 'public/app.js');
  await writeFile(ui, (await readFile(ui, 'utf8')).replace('产品探索 · REA 还原试玩', '示例 · 午餐产品探索'));
  const plist = join(app, 'Contents/Info.plist');
  for (const [key, value] of Object.entries({
    CFBundleDisplayName: '独立画布',
    CFBundleName: '独立画布',
    CFBundleIdentifier: 'cloud.greatwonder.independent-canvas.share',
    NSMicrophoneUsageDescription: '用于录音并转写为文字。'
  })) {
    execFileSync('/usr/bin/plutil', ['-replace', key, '-string', value, plist]);
  }
  execFileSync(python, [join(here, 'share-runtime.py'), join(resources, 'python')]);
  const bundledPython = join(resources, 'python/bin/python3.12');
  execFileSync(bundledPython, ['-I', '-B', '-c', 'import ssl, pypdf, pypdfium2, PIL.Image, openpyxl, pptx']);
  await cp(join(here, '分享版使用说明.txt'), join(folder, '使用说明.txt'));
  execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', app]);
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
  const zipName = '独立画布-Apple芯片Mac.zip';
  await mkdir(output, { recursive: true });
  // Stage the archive in the destination filesystem, then replace it atomically.
  const archiveStage = await mkdtemp(join(output, '.share-'));
  try {
    const zip = join(archiveStage, zipName);
    execFileSync('/usr/bin/ditto', ['-c', '-k', '--keepParent', folder, zip]);
    await rename(zip, join(output, zipName));
  } finally {
    await rm(archiveStage, { recursive: true, force: true });
  }
  console.log(join(output, zipName));
} finally {
  await rm(stage, { recursive: true, force: true });
}
