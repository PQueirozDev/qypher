import test from 'node:test';
import assert from 'node:assert/strict';
import { crossesAngle, markerPosition, parseCommand, findings } from '../experience/demo.ts';
import { makeAsciiLogo } from '../experience/ascii.ts';

test('scan fires once when its ray crosses a marker, including wraparound', () => {
  assert.equal(crossesAngle(37, 39, 38), true);
  assert.equal(crossesAngle(39, 40, 38), false);
  assert.equal(crossesAngle(397, 399, 38), true);
  assert.equal(crossesAngle(350, 365, 0), true);
  assert.equal(crossesAngle(38, 38, 38), false);
  assert.equal(crossesAngle(38, 39, 38), false);
});

test('only the four predefined commands are accepted', () => {
  for (const command of ['help', 'demo', 'clear', 'about'])
    assert.equal(parseCommand(`  ${command.toUpperCase()} `), command);
  for (const command of [
    'scan example.com',
    'demo; whoami',
    '<img onerror=alert(1)>',
    'fetch("/")',
    'help && demo',
    '',
    'constructor',
  ])
    assert.equal(parseCommand(command), null);
});

test('each finding maps to a distinct point within the existing circular instrument', () => {
  const points = findings.map(({ angle, radius }) => markerPosition(angle, radius, 500));
  points.forEach((point) => {
    assert(Math.hypot(point.x, point.y) < 236);
  });
  assert.equal(new Set(points.map(({ x, y }) => `${x},${y}`)).size, 3);
  assert(points[0].y < 0);
  assert(points[1].y > 0);
  assert(points[2].x < 0);
});

test('the ASCII emblem is a stable original character grid with shield and terminal details', () => {
  const ascii = makeAsciiLogo();
  const rows = ascii.split('\n');
  assert.equal(rows.length, 24);
  assert(rows.every((row) => row.length === 37));
  assert(ascii.includes('@'));
  assert(ascii.includes('#'));
  assert.equal(ascii, makeAsciiLogo());
  assert(!/[<>]/.test(ascii));
});

test('the direct download picks the right installer per platform and ignores updater files', async () => {
  const { detectPlatform, pickInstaller, formatSize } = await import('../experience/download.ts');
  const asset = (name, size = 5172615) => ({
    name,
    size,
    browser_download_url: `https://github.com/PQueirozDev/qypher/releases/download/v0.1.0/${name}`,
  });
  const assets = [
    asset('latest.json', 1297),
    asset('Qypher_0.1.0_x64-setup.exe.sig', 436),
    asset('Qypher_0.1.0_x64-setup.exe'),
    asset('Qypher_0.1.0_universal.dmg'),
    asset('Qypher.app.tar.gz'),
    asset('Qypher_0.1.0_amd64.deb'),
    asset('Qypher_0.1.0_amd64.AppImage'),
    asset('Qypher_0.1.0_amd64.AppImage.sig', 400),
  ];
  assert.equal(pickInstaller(assets, 'windows').name, 'Qypher_0.1.0_x64-setup.exe');
  assert.equal(pickInstaller(assets, 'macos').name, 'Qypher_0.1.0_universal.dmg');
  assert.equal(pickInstaller(assets, 'linux').name, 'Qypher_0.1.0_amd64.AppImage');
  assert.equal(pickInstaller(assets.slice(0, 3), 'linux'), null);
  assert.equal(detectPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64)'), 'windows');
  assert.equal(detectPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)'), 'macos');
  assert.equal(detectPlatform('Mozilla/5.0 (X11; Linux x86_64)'), 'linux');
  assert.equal(detectPlatform('Mozilla/5.0 (Linux; Android 14)'), null);
  assert.equal(detectPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'), null);
  assert.equal(detectPlatform('', 'Windows'), 'windows');
  assert.equal(formatSize(5172615), '4,9 MB');
  assert.equal(formatSize(0), '');
});
