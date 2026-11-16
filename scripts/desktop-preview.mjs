import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const profile = join(root, 'tmp', 'native-preview');
const flags = process.argv.slice(2);
if (flags.includes('--help')) {
  process.stdout.write(
    'Qypher desktop preview\nBuilds the frontend, then builds the real desktop engine offline with embedded assets. No browser or Vite server is needed by this preview.\nUses tmp/native-preview for preview data. Requires the installed project dependencies and Rust desktop toolchain. No scans start automatically. Close the desktop window to end the session.\nFor frontend hot reload use npm run desktop:dev.\n',
  );
  process.exit(0);
}
if (flags.length) throw new Error('Use npm run desktop:preview without extra arguments.');

function run(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd: root, stdio: 'inherit', shell: false, ...options });
    child.once('error', reject);
    child.once('exit', (code, signal) =>
      code === 0 ? resolve() : reject(new Error(`Process ended (${code ?? signal}).`)),
    );
  });
}
try {
  const npmCli = process.env.npm_execpath;
  if (!npmCli) throw new Error('Start the preview with npm run desktop:preview.');
  process.stdout.write('Building the Qypher interface for the native desktop window…\n');
  await run(process.execPath, [npmCli, 'run', 'build']);
  process.stdout.write('Building the real Qypher desktop engine with embedded assets (offline)…\n');
  await run('cargo', [
    'build',
    '--offline',
    '--locked',
    '-p',
    'qypher-desktop',
    '--bin',
    'qypher-desktop',
    '--features',
    'custom-protocol',
  ]);
  await mkdir(profile, { recursive: true });
  const binary = join(
    root,
    'target',
    'debug',
    `qypher-desktop${process.platform === 'win32' ? '.exe' : ''}`,
  );
  process.stdout.write(`Opening the Qypher desktop app. Preview data: ${profile}\n`);
  await run(binary, [], {
    env: {
      ...process.env,
      QYPHER_PREVIEW_DATA_DIR: profile,
      WEBVIEW2_USER_DATA_FOLDER: join(profile, 'webview2'),
    },
  });
} catch (error) {
  process.stderr.write(`Qypher preview: ${error.message}\n`);
  process.exitCode = 1;
}
