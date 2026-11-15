import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createHash } from 'node:crypto';
import { at, config, current, healthy, lock, readJson, root, run } from './common.mjs';
import { startApp, stopApp } from './control.mjs';
import { applyRelease } from './transaction.mjs';

export function versionTag(tag) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(tag);
  if (!match) {
    throw new Error(`Unsupported release tag: ${tag}`);
  }
  return match.slice(1).map(Number);
}
export function newer(tag, installed) {
  const left = versionTag(tag);
  const right = versionTag(installed);
  for (let index = 0; index < 3; index++) {
    if (left[index] !== right[index]) {
      return left[index] > right[index];
    }
  }
  return false;
}
export async function latestTag() {
  const response = await fetch('https://github.com/Stonewuu/ai-fusion-video/releases/latest', {
    redirect: 'follow', signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) {
    throw new Error(`GitHub release check failed: HTTP ${response.status}`);
  }
  await response.body?.cancel();
  const tag = decodeURIComponent(new URL(response.url).pathname.split('/').pop());
  versionTag(tag);
  return tag;
}
const services = { stop: stopApp, start: () => startApp(false), healthy };
async function update() {
  if (fs.existsSync(at('.runtime', 'update-journal.json'))) {
    throw new Error('An interrupted update requires recovery. Run Rollback.cmd first.');
  }
  const tag = await latestTag();
  const installed = readJson(path.join(current(), 'version.json')).version;
  console.log(`Installed: ${installed}; latest official release: ${tag}`);
  if (!newer(tag, installed)) {
    console.log('No newer stable release.');
    return;
  }
  const job = at('.runtime', `update-${Date.now()}`);
  fs.mkdirSync(job);
  const archive = path.join(job, 'source.zip');
  const response = await fetch(`https://codeload.github.com/Stonewuu/ai-fusion-video/zip/refs/tags/${encodeURIComponent(tag)}`, {
    signal: AbortSignal.timeout(10 * 60 * 1000),
  });
  if (!response.ok) {
    throw new Error(`Source download failed: HTTP ${response.status}`);
  }
  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(archive));
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(archive)) {
    hash.update(chunk);
  }
  const sourceSha256 = hash.digest('hex');
  fs.writeFileSync(path.join(job, 'source.sha256'), sourceSha256);
  await run('tar.exe', ['-xf', archive, '-C', job]);
  const directories = fs.readdirSync(job, { withFileTypes: true }).filter((item) => item.isDirectory());
  if (directories.length !== 1) {
    throw new Error('Unexpected source archive structure');
  }
  const source = path.join(job, directories[0].name);
  const packageInfo = readJson(path.join(source, 'ai-fusion-video-web', 'package.json'));
  if (versionTag(tag).join('.') !== packageInfo.version) {
    throw new Error('Release tag and source version disagree');
  }
  const id = `${tag.replace(/^v/, '')}-${Date.now()}`;
  const destination = at('releases', id);
  await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', at('windows', 'build.ps1'),
    '-Source', source, '-Destination', destination, '-Runtime', at('runtime')]);
  const metadata = readJson(path.join(destination, 'version.json'));
  fs.writeFileSync(path.join(destination, 'version.json'), JSON.stringify({ ...metadata, tag, sourceSha256 }, null, 2));
  const result = await applyRelease(root, id, services);
  console.log(`Updated to ${tag}. Backup: ${result.backup}`);
}
async function rollback() {
  const journalFile = at('.runtime', 'update-journal.json');
  let backupName;
  if (fs.existsSync(journalFile)) {
    backupName = readJson(journalFile).backup;
  } else {
    const names = fs.readdirSync(at('backups')).filter((name) => fs.existsSync(at('backups', name, 'backup.json'))).sort();
    backupName = names.at(-1);
  }
  if (!backupName || !/^[\w.-]+$/.test(backupName)) {
    throw new Error('No completed backup available');
  }
  const backup = at('backups', backupName);
  const info = readJson(path.join(backup, 'backup.json'));
  const result = await applyRelease(root, info.previous, services, backup);
  console.log(`Restored ${info.previous}. Data restored to ${backupName}. Before-restore backup: ${result.backup}`);
}
if (process.argv[1]?.endsWith('update.mjs')) {
  config();
  const unlock = lock('update');
  try {
    if (process.argv[2] === 'rollback') {
      await rollback();
    } else if (process.argv[2] === 'check') {
      console.log(`Latest official release: ${await latestTag()}`);
    } else {
      await update();
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    unlock();
  }
}
