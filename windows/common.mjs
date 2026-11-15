import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const at = (...parts) => path.join(root, ...parts);
export const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export function nativeRoot() {
  // Verified upstream boundaries: MySQL Windows argv parsing and AgentScope nested-JAR URI parsing.
  if (!/^[\x21-\x7e]+$/.test(root)) {
    throw new Error('Extract FusionVideo to an English path without spaces, such as C:\\FusionVideo or D:\\Apps\\FusionVideo.');
  }
  return root;
}
export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}
export function writeJson(file, value) {
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(value, null, 2));
  fs.renameSync(`${file}.tmp`, file);
}
export function config() {
  nativeRoot();
  for (const dir of ['config', 'data', 'logs', '.runtime', 'backups', 'releases']) {
    fs.mkdirSync(at(dir), { recursive: true });
  }
  const file = at('config', 'windows.json');
  if (!fs.existsSync(file)) {
    writeJson(file, {
      port: 18088, mysqlPort: 13306, redisPort: 16379,
      backendPort: 18080, frontendPort: 13000,
      mysqlPassword: randomBytes(24).toString('hex'),
      redisPassword: randomBytes(24).toString('hex'),
      controlToken: randomBytes(32).toString('hex'),
    });
  }
  const value = readJson(file);
  const ports = ['port', 'mysqlPort', 'redisPort', 'backendPort', 'frontendPort'].map((key) => value[key]);
  if (ports.some((port) => !Number.isInteger(port) || port < 1024 || port > 65535) || new Set(ports).size !== ports.length) {
    throw new Error('config/windows.json: ports must be distinct integers between 1024 and 65535');
  }
  for (const key of ['mysqlPassword', 'redisPassword', 'controlToken']) {
    if (!/^[a-f0-9]{48,64}$/.test(value[key])) {
      throw new Error(`config/windows.json: invalid ${key}`);
    }
  }
  return value;
}
export function current() {
  const id = fs.readFileSync(at('current.txt'), 'utf8').trim();
  if (!/^[\w.-]+$/.test(id)) {
    throw new Error('Invalid release identifier');
  }
  return at('releases', id);
}
export function run(executable, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, stdio: 'inherit', ...options });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${path.basename(executable)} exited with ${code}`));
      }
    });
    if (options.input !== undefined) {
      child.stdin.end(options.input);
    }
  });
}
export async function healthy(c = config()) {
  try {
    const response = await fetch(`http://127.0.0.1:${c.port}/__fusion/health`, { signal: AbortSignal.timeout(1500) });
    return response.ok && (await response.json()).ready === true;
  } catch {
    return false;
  }
}
export function lock(name) {
  const file = at('.runtime', `${name}.lock`);
  try {
    const handle = fs.openSync(file, 'wx');
    fs.writeFileSync(handle, String(process.pid));
    fs.closeSync(handle);
  } catch (error) {
    if (error.code !== 'EEXIST') {
      throw error;
    }
    const pid = Number(fs.readFileSync(file, 'utf8'));
    try {
      process.kill(pid, 0);
    } catch (failure) {
      if (failure.code === 'ESRCH') {
        fs.unlinkSync(file);
        return lock(name);
      }
      throw failure;
    }
    throw new Error(`${name} is already running (PID ${pid})`);
  }
  return () => fs.rmSync(file, { force: true });
}
