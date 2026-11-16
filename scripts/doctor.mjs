import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
const commands = [
  ['Node', 'node', ['--version']],
  ['Rust', 'rustc', ['--version']],
  ['Cargo', 'cargo', ['--version']],
];
for (const [name, command, args] of commands) {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true });
  console.log(
    `${result.status === 0 ? 'OK' : 'MISSING'} ${name}: ${result.stdout?.trim() || result.error?.message || result.stderr?.trim()}`,
  );
}
console.log(
  `${existsSync('node_modules/@tauri-apps/cli') ? 'OK' : 'MISSING'} frontend/Tauri dependencies (npm install)`,
);
console.log(
  `${existsSync('Cargo.lock') ? 'OK' : 'MISSING'} Cargo.lock (cargo generate-lockfile requires registry access)`,
);
console.log(
  `${existsSync('package-lock.json') ? 'OK' : 'MISSING'} package-lock.json (npm install requires registry access)`,
);
console.log(
  'Windows: Microsoft C++ Build Tools + Windows SDK and WebView2 are required. See docs/DEVELOPMENT.md.',
);
