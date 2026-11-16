import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
const migration = readFileSync(
  new URL('../../crates/scanner-storage/migrations/001_initial.sql', import.meta.url),
  'utf8',
);
test('SQLite migration is transactional and enforces referential integrity', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('PRAGMA foreign_keys=ON; BEGIN IMMEDIATE;');
    db.exec(migration);
    db.exec('COMMIT;');
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 1);
    assert.throws(
      () => db.prepare('INSERT INTO scans VALUES (?,?,?,?)').run('orphan', 'missing', 'now', '{}'),
      /FOREIGN KEY/,
    );
    db.prepare('INSERT INTO projects VALUES (?,?,?,?)').run(
      'project',
      '<untrusted>',
      'http://127.0.0.1/',
      'now',
    );
    db.prepare('INSERT INTO scans VALUES (?,?,?,?)').run(
      'scan',
      'project',
      'now',
      JSON.stringify({ id: 'scan', schemaVersion: 1 }),
    );
    assert.equal(
      JSON.parse(db.prepare('SELECT data FROM scans WHERE id=?').get('scan').data).schemaVersion,
      1,
    );
    db.prepare('DELETE FROM projects WHERE id=?').run('project');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM scans').get().n, 0);
  } finally {
    db.close();
  }
});

test('source migration preserves HTTP history and stores source snapshots independently', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('PRAGMA foreign_keys=ON;');
    db.exec(migration);
    db.prepare('INSERT INTO projects VALUES (?,?,?,?)').run(
      'http-project',
      'HTTP',
      'https://example.invalid/',
      'now',
    );
    db.prepare('INSERT INTO scans VALUES (?,?,?,?)').run('http-run', 'http-project', 'now', '{}');
    db.exec('BEGIN IMMEDIATE;');
    db.exec(
      readFileSync(
        new URL('../../crates/scanner-storage/migrations/002_source_scans.sql', import.meta.url),
        'utf8',
      ),
    );
    db.exec('COMMIT;');
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 2);
    db.prepare('INSERT INTO source_scans VALUES (?,?,?)').run(
      'source-run',
      'now',
      JSON.stringify({ status: 'cancelled', stats: { truncated: true } }),
    );
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM scans').get().n, 1);
    assert.equal(
      JSON.parse(db.prepare('SELECT data FROM source_scans WHERE id=?').get('source-run').data)
        .status,
      'cancelled',
    );
    db.prepare('DELETE FROM source_scans WHERE id=?').run('source-run');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM scans').get().n, 1);
  } finally {
    db.close();
  }
});
