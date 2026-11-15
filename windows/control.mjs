import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { at, config, delay, healthy } from './common.mjs';

export async function startApp(openBrowser = false) {
  const c = config();
  if (!await healthy(c)) {
    const log = fs.openSync(at('logs', 'launcher.log'), 'a');
    const child = spawn(process.execPath, [at('windows', 'supervisor.mjs')], {
      cwd: at(), detached: true, windowsHide: true, stdio: ['ignore', log, log],
    });
    fs.closeSync(log);
    child.unref();
    const end = Date.now() + 240000;
    while (!await healthy(c)) {
      if (child.exitCode !== null) {
        throw new Error('Startup failed. See logs/launcher.log and logs/backend.log');
      }
      if (Date.now() > end) {
        throw new Error('Startup timed out. See logs/launcher.log');
      }
      await delay(1000);
    }
  }
  const url = `http://127.0.0.1:${c.port}`;
  console.log(`Fusion ready: ${url}`);
  if (openBrowser) {
    spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], { windowsHide: true, stdio: 'ignore' }).unref();
  }
}
export async function stopApp() {
  const c = config();
  try {
    const response = await fetch(`http://127.0.0.1:${c.port}/__fusion/shutdown`, {
      method: 'POST', headers: { authorization: `Bearer ${c.controlToken}` }, signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) {
      throw new Error(`Shutdown refused: ${response.status}`);
    }
  } catch (error) {
    const instanceLock = at('.runtime', 'instance.lock');
    if (fs.existsSync(instanceLock)) {
      const pid = Number(fs.readFileSync(instanceLock, 'utf8'));
      try {
        process.kill(pid, 0);
      } catch (failure) {
        if (failure.code === 'ESRCH') {
          fs.unlinkSync(instanceLock);
          console.log('Removed stopped instance lock.');
          return;
        }
        throw failure;
      }
      throw error;
    }
    console.log('Fusion is stopped.');
    return;
  }
  const end = Date.now() + 60000;
  while (fs.existsSync(at('.runtime', 'instance.lock'))) {
    if (Date.now() > end) {
      throw new Error('Shutdown timed out; inspect logs before updating.');
    }
    await delay(500);
  }
  console.log('Fusion stopped.');
}
if (process.argv[1]?.endsWith('control.mjs')) {
  try {
    const command = process.argv[2];
    if (command === 'start') {
      config();
      if (fs.existsSync(at('.runtime', 'update-journal.json'))) {
        throw new Error('Interrupted update detected. Run Rollback.cmd to restore the saved data.');
      }
      if (fs.existsSync(at('.runtime', 'update.lock'))) {
        throw new Error('Update is running. Wait for it to finish.');
      }
      await startApp(!process.argv.includes('--no-browser'));
    } else if (command === 'stop') {
      await stopApp();
    } else if (command === 'status') {
      console.log(await healthy() ? 'RUNNING' : 'STOPPED');
    } else {
      throw new Error('Usage: control.mjs start|stop|status');
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
