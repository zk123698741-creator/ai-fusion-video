import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { at, config, current, delay, lock, run, nativeRoot } from './common.mjs';

const c = config();
const release = current();
const nativeBase = await nativeRoot();
const nativeAt = (...parts) => path.join(nativeBase, ...parts);
const unlock = lock('instance');
const children = [];
let stopping = false;
let ready = false;
let server;
process.once('exit', unlock);

function launch(name, executable, args, env = {}) {
  const log = fs.openSync(at('logs', `${name}.log`), 'a');
  const child = spawn(executable, args, {
    cwd: at('data'), windowsHide: true, env: { ...process.env, ...env }, stdio: ['ignore', log, log],
  });
  fs.closeSync(log);
  children.push(child);
  child.on('error', (error) => {
    console.error(name, error);
    void shutdown(1);
  });
  child.on('exit', (code) => {
    if (!stopping) {
      console.error(`${name} exited unexpectedly: ${code}`);
      void shutdown(1);
    }
  });
  return child;
}
async function waitFor(check, label, timeout = 180000) {
  const end = Date.now() + timeout;
  while (Date.now() < end && !stopping) {
    try {
      if (await check()) {
        return;
      }
    } catch {
      // Connection refusal is expected while the owned child initializes.
    }
    await delay(500);
  }
  throw new Error(`${label} did not become ready; inspect logs/${label}.log`);
}
function tcpReady(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    socket.setTimeout(1000);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
  });
}
async function stopChild(child) {
  if (child.exitCode !== null || !child.pid) {
    return;
  }
  // Only live child handles from this supervisor are terminated, never stale PIDs from disk.
  await run('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }).catch(() => {});
}
async function shutdown(code = 0) {
  if (stopping) {
    return;
  }
  stopping = true;
  ready = false;
  server?.close();
  server?.closeAllConnections();
  for (const child of children.slice(2).reverse()) {
    await stopChild(child);
  }
  if (children.length > 1) {
    await run(at('runtime', 'redis', 'redis-cli.exe'), ['-p', String(c.redisPort), 'shutdown'], {
      stdio: 'ignore', env: { ...process.env, REDISCLI_AUTH: c.redisPassword },
    }).catch(() => {});
  }
  if (children.length > 0 && fs.existsSync(at('config', 'mysql-client.ini'))) {
    await run(nativeAt('runtime', 'mysql', 'bin', 'mysqladmin.exe'), [
      `--defaults-extra-file=${nativeAt('config', 'mysql-client.ini')}`, 'shutdown',
    ], { stdio: 'ignore' }).catch(() => {});
  }
  for (const child of children.slice().reverse()) {
    await stopChild(child);
  }
  process.exit(code);
}

function proxy(request, response) {
  if (request.url === '/__fusion/health') {
    response.writeHead(ready ? 200 : 503, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ ready }));
    return;
  }
  if (request.url === '/__fusion/shutdown') {
    if (request.method !== 'POST' || request.headers.authorization !== `Bearer ${c.controlToken}`) {
      response.writeHead(403).end();
      return;
    }
    response.end('Stopping');
    setTimeout(() => void shutdown(), 100);
    return;
  }
  if (!ready) {
    response.writeHead(503).end('Fusion is starting. Please refresh shortly.');
    return;
  }
  const port = /^\/(api|media)(\/|\?|$)/.test(request.url) ? c.backendPort : c.frontendPort;
  const upstream = http.request({
    hostname: '127.0.0.1', port, path: request.url, method: request.method,
    headers: { ...request.headers, 'x-forwarded-for': '127.0.0.1', 'x-forwarded-proto': 'http', 'x-forwarded-host': request.headers.host },
  }, (incoming) => {
    response.writeHead(incoming.statusCode, incoming.headers);
    incoming.pipe(response);
  });
  upstream.setTimeout(25 * 60 * 1000, () => upstream.destroy());
  upstream.on('error', () => {
    if (!response.headersSent) {
      response.writeHead(502);
    }
    response.end('Service connection failed. See logs.');
  });
  response.on('close', () => upstream.destroy());
  request.pipe(upstream);
}

try {
  // Reserve all ports before starting any database to avoid attaching to an unrelated service.
  for (const port of [c.port, c.mysqlPort, c.redisPort, c.backendPort, c.frontendPort]) {
    await new Promise((resolve, reject) => {
      const probe = net.createServer();
      probe.once('error', reject);
      probe.listen(port, '127.0.0.1', () => probe.close(resolve));
    });
  }
  server = http.createServer(proxy);
  server.requestTimeout = 0;
  server.on('error', (error) => {
    console.error(error);
    void shutdown(1);
  });
  server.listen(c.port, '127.0.0.1');
  const mysqlData = nativeAt('data', 'mysql');
  const fresh = !fs.existsSync(mysqlData);
  const mysqlArgs = [
    '--no-defaults', `--basedir=${nativeAt('runtime', 'mysql')}`, `--datadir=${mysqlData}`,
    `--port=${c.mysqlPort}`, '--bind-address=127.0.0.1', '--mysqlx=0',
    '--character-set-server=utf8mb4', '--collation-server=utf8mb4_unicode_ci', '--default-time-zone=+08:00',
  ];
  if (fresh) {
    await run(nativeAt('runtime', 'mysql', 'bin', 'mysqld.exe'), [...mysqlArgs, '--initialize-insecure', '--console']);
  }
  launch('mysql', nativeAt('runtime', 'mysql', 'bin', 'mysqld.exe'), [...mysqlArgs, '--console']);
  await waitFor(() => tcpReady(c.mysqlPort), 'mysql');
  const clientArgs = ['--no-defaults', '--host=127.0.0.1', `--port=${c.mysqlPort}`, '--user=root', '--protocol=tcp'];
  const clientFile = at('config', 'mysql-client.ini');
  if (fresh) {
    await run(nativeAt('runtime', 'mysql', 'bin', 'mysql.exe'), clientArgs, {
      stdio: ['pipe', 'inherit', 'inherit'],
      input: `ALTER USER 'root'@'localhost' IDENTIFIED BY '${c.mysqlPassword}'; CREATE DATABASE ai_fusion_video CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;\n`,
    });
  }
  fs.writeFileSync(clientFile, `[client]\nhost=127.0.0.1\nport=${c.mysqlPort}\nuser=root\npassword=${c.mysqlPassword}\nprotocol=tcp\n`);
  fs.mkdirSync(at('data', 'redis'), { recursive: true });
  const redisFile = at('config', 'redis.conf');
  const redisDirectory = nativeAt('data', 'redis').replaceAll('\\', '/');
  fs.writeFileSync(redisFile, `bind 127.0.0.1\nprotected-mode yes\nport ${c.redisPort}\nrequirepass ${c.redisPassword}\ndir "${redisDirectory}"\nsave ""\nappendonly yes\n`);
  // Redis resolves the config argument as a POSIX path, relative to its data working directory.
  launch('redis', at('runtime', 'redis', 'redis-server.exe'), ['../config/redis.conf']);
  await waitFor(() => tcpReady(c.redisPort), 'redis');
  // Explicit socket directory avoids redirected TEMP paths inherited from MSIX launchers.
  fs.mkdirSync(at('.runtime', 'socket-temp'), { recursive: true });
  launch('backend', nativeAt('runtime', 'java', 'bin', 'java.exe'), [
    '-Xms256m', '-Xmx1536m', `-Djdk.net.unixdomain.tmpdir=${nativeAt('.runtime', 'socket-temp')}`,
    '-jar', nativeAt('releases', path.basename(release), 'backend.jar'),
  ], {
    SPRING_PROFILES_ACTIVE: 'docker', SERVER_ADDRESS: '127.0.0.1', SERVER_PORT: String(c.backendPort),
    MYSQL_HOST: '127.0.0.1', MYSQL_PORT: String(c.mysqlPort), MYSQL_DATABASE: 'ai_fusion_video',
    MYSQL_USERNAME: 'root', MYSQL_PASSWORD: c.mysqlPassword,
    REDIS_HOST: '127.0.0.1', REDIS_PORT: String(c.redisPort), REDIS_PASSWORD: c.redisPassword,
    VIDEO_COMPOSE_FFMPEG_PATH: at('runtime', 'ffmpeg', 'bin', 'ffmpeg.exe'),
    VIDEO_COMPOSE_FFPROBE_PATH: at('runtime', 'ffmpeg', 'bin', 'ffprobe.exe'),
    CORS_ALLOWED_ORIGIN_PATTERNS: `http://127.0.0.1:${c.port},http://localhost:${c.port}`,
  });
  await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${c.backendPort}/api/system/init/status`, { signal: AbortSignal.timeout(2000) });
    const body = await response.json();
    return response.ok && body.code === 0 && typeof body.data?.initialized === 'boolean';
  }, 'backend');
  launch('frontend', at('runtime', 'node', 'node.exe'), [`${release}/web/server.js`], {
    NODE_ENV: 'production', HOSTNAME: '127.0.0.1', PORT: String(c.frontendPort), NEXT_TELEMETRY_DISABLED: '1',
  });
  await waitFor(async () => (await fetch(`http://127.0.0.1:${c.frontendPort}/`, { signal: AbortSignal.timeout(2000), redirect: 'manual' })).status < 400, 'frontend');
  ready = true;
  console.log(`Ready: http://127.0.0.1:${c.port}`);
} catch (error) {
  console.error(error);
  await shutdown(1);
}
