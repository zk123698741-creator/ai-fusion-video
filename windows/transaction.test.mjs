import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyRelease } from './transaction.mjs';
import { newer, versionTag } from './update.mjs';

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fusion-update-test-'));
  for (const item of ['data/media', 'config', 'releases/old', 'releases/new', '.runtime']) {
    fs.mkdirSync(path.join(directory, item), { recursive: true });
  }
  for (const release of ['old', 'new']) {
    fs.writeFileSync(path.join(directory, 'releases', release, 'version.json'), '{}');
  }
  fs.writeFileSync(path.join(directory, 'current.txt'), 'old');
  fs.writeFileSync(path.join(directory, 'data', 'database'), 'schema=old;project=123');
  fs.writeFileSync(path.join(directory, 'data', 'media', 'clip'), 'media-bytes');
  fs.writeFileSync(path.join(directory, 'config', 'secret'), 'original-secret');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return { directory, at: (...parts) => path.join(directory, ...parts) };
}

test('successful update retains user data and cold backup', async (t) => {
  const { directory, at } = fixture(t);
  let stopped = false;
  const result = await applyRelease(directory, 'new', {
    stop: async () => {
      stopped = true;
    },
    start: async () => {
      assert.equal(stopped, true);
      assert.equal(fs.readFileSync(path.join(resultBackup(), 'data', 'database'), 'utf8'), 'schema=old;project=123');
      fs.writeFileSync(at('data', 'database'), 'schema=new;project=123');
    },
    healthy: async () => true,
  });
  function resultBackup() {
    return at('backups', fs.readdirSync(at('backups'))[0]);
  }
  assert.equal(fs.readFileSync(at('current.txt'), 'utf8'), 'new');
  assert.equal(fs.readFileSync(at('data', 'database'), 'utf8'), 'schema=new;project=123');
  assert.equal(fs.readFileSync(at('data', 'media', 'clip'), 'utf8'), 'media-bytes');
  assert.equal(fs.existsSync(at('.runtime', 'update-journal.json')), false);
  assert.equal(fs.existsSync(path.join(result.backup, 'config', 'secret')), true);
});

test('failed migration restores program, database, media and config together', async (t) => {
  const { directory, at } = fixture(t);
  let starts = 0;
  await assert.rejects(applyRelease(directory, 'new', {
    stop: async () => {},
    start: async () => {
      starts++;
      if (starts === 1) {
        fs.writeFileSync(at('data', 'database'), 'incompatible-schema');
        fs.writeFileSync(at('data', 'media', 'clip'), 'changed-by-new-version');
        fs.writeFileSync(at('config', 'secret'), 'changed-secret');
        throw new Error('migration failed');
      }
    },
    healthy: async () => true,
  }), /previous release and data restored/);
  assert.equal(starts, 2);
  assert.equal(fs.readFileSync(at('current.txt'), 'utf8'), 'old');
  assert.equal(fs.readFileSync(at('data', 'database'), 'utf8'), 'schema=old;project=123');
  assert.equal(fs.readFileSync(at('data', 'media', 'clip'), 'utf8'), 'media-bytes');
  assert.equal(fs.readFileSync(at('config', 'secret'), 'utf8'), 'original-secret');
  assert.equal(fs.existsSync(at('.runtime', 'update-journal.json')), false);
});

test('explicit rollback restores a selected backup and preserves current data', async (t) => {
  const { directory, at } = fixture(t);
  const source = at('restore-source');
  fs.mkdirSync(path.join(source, 'data'), { recursive: true });
  fs.mkdirSync(path.join(source, 'config'), { recursive: true });
  fs.writeFileSync(path.join(source, 'data', 'database'), 'snapshot-project=456');
  fs.writeFileSync(path.join(source, 'config', 'secret'), 'snapshot-secret');
  const result = await applyRelease(directory, 'old', {
    stop: async () => {}, start: async () => {}, healthy: async () => true,
  }, source);
  assert.equal(fs.readFileSync(at('data', 'database'), 'utf8'), 'snapshot-project=456');
  assert.equal(fs.readFileSync(path.join(result.backup, 'data', 'database'), 'utf8'), 'schema=old;project=123');
});

test('unhealthy service triggers data restore; failed rollback retains recovery journal', async (t) => {
  const { directory, at } = fixture(t);
  await assert.rejects(applyRelease(directory, 'new', {
    stop: async () => {}, start: async () => {}, healthy: async () => false,
  }), /Rollback startup failed/);
  assert.equal(fs.existsSync(at('.runtime', 'update-journal.json')), true);
  assert.equal(fs.readFileSync(at('current.txt'), 'utf8'), 'old');
});

test('invalid release rejected before stopping any service', async (t) => {
  const { directory } = fixture(t);
  let stopped = false;
  await assert.rejects(applyRelease(directory, '../outside', {
    stop: async () => {
      stopped = true;
    },
  }), /invalid/);
  assert.equal(stopped, false);
});

test('release comparison handles prefixes, major upgrades and downgrades', () => {
  assert.equal(newer('v1.10.0', '1.9.9'), true);
  assert.equal(newer('v2.0.0', '1.99.99'), true);
  assert.equal(newer('v1.3.1', '1.3.1'), false);
  assert.equal(newer('v1.2.9', '1.3.1'), false);
  assert.throws(() => versionTag('../main'), /Unsupported/);
  assert.throws(() => versionTag('v2.0.0-beta'), /Unsupported/);
});
