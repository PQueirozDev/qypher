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
