import fs from 'node:fs';
import path from 'node:path';

export function writePointer(directory, id) {
  if (!/^[\w.-]+$/.test(id)) {
    throw new Error('Invalid release identifier');
  }
  fs.writeFileSync(path.join(directory, 'current.txt.tmp'), id);
  fs.renameSync(path.join(directory, 'current.txt.tmp'), path.join(directory, 'current.txt'));
}
export async function applyRelease(directory, target, services, restoreFrom) {
  if (!/^[\w.-]+$/.test(target) || !fs.existsSync(path.join(directory, 'releases', target, 'version.json'))) {
    throw new Error('Target release is missing or invalid');
  }
  const at = (...parts) => path.join(directory, ...parts);
  const previous = fs.readFileSync(at('current.txt'), 'utf8').trim();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-') + `-${process.pid}`;
  const backup = at('backups', stamp);
  await services.stop();
  fs.mkdirSync(backup, { recursive: true });
  // Cold backup includes database files, media, agent workspaces and Windows secrets.
  for (const name of ['data', 'config']) {
    if (fs.existsSync(at(name))) {
      fs.cpSync(at(name), path.join(backup, name), { recursive: true });
    }
  }
  fs.writeFileSync(path.join(backup, 'backup.json'), JSON.stringify({ previous, target, stamp }, null, 2));
  const journal = at('.runtime', 'update-journal.json');
  fs.writeFileSync(journal, JSON.stringify({ backup: stamp, previous, target }));
  function restore(source, failedName) {
    for (const name of ['data', 'config']) {
      if (fs.existsSync(at(name))) {
        fs.renameSync(at(name), path.join(backup, `${failedName}-${name}`));
      }
      if (fs.existsSync(path.join(source, name))) {
        fs.cpSync(path.join(source, name), at(name), { recursive: true });
      }
    }
  }
  try {
    if (restoreFrom) {
      restore(restoreFrom, 'before-restore');
    }
    writePointer(directory, target);
    await services.start();
    if (!await services.healthy()) {
      throw new Error('New release failed its health check');
    }
    fs.unlinkSync(journal);
    return { backup, previous, target };
  } catch (error) {
    await services.stop();
    restore(backup, 'failed');
    writePointer(directory, previous);
    await services.start();
    if (!await services.healthy()) {
      throw new AggregateError([error], `Rollback startup failed. Recovery backup: ${backup}`);
    }
    fs.unlinkSync(journal);
    throw new Error(`Update failed; previous release and data restored. ${error.message}`);
  }
}
