const { app, BrowserWindow, Menu, dialog, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawn } = require('node:child_process');

const root = path.dirname(process.execPath);
const resultArgument = process.argv.find((value) => value.startsWith('--smoke-result='));
const resultFile = resultArgument?.slice('--smoke-result='.length);
let window;
let startup;
let stopping = false;
let exiting = false;
let smoke;

app.setName('FusionVideo');
app.setAppUserModelId('FusionVideo.Desktop');

function command(action) {
  return new Promise((resolve, reject) => {
    const child = spawn(path.join(root, 'runtime/node/node.exe'), [
      path.join(root, 'windows/control.mjs'), action, '--no-browser',
    ], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (data) => {
      output += data;
    });
    child.stderr.on('data', (data) => {
      output += data;
    });
    child.once('error', reject);
    child.once('close', (code) => {
      fs.appendFileSync(path.join(root, 'logs/desktop.log'), `${new Date().toISOString()} ${action}\n${output}\n`);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(output.trim() || `Local service ${action} failed (${code})`));
      }
    });
  });
}

async function shutdown() {
  if (stopping || exiting) {
    return;
  }
  stopping = true;
  window?.setTitle('融光 · 正在停止本机服务');
  try {
    await startup?.catch(() => {});
    await command('stop');
    if (smoke) {
      const response = await fetch(`${smoke.origin}/__fusion/health`, { signal: AbortSignal.timeout(2000) }).catch(() => null);
      if (response?.ok) {
        throw new Error('The desktop window closed but its local services are still running');
      }
      fs.writeFileSync(resultFile, JSON.stringify({ ...smoke, shutdown: 'passed' }, null, 2));
    }
    exiting = true;
    app.exit(0);
  } catch (error) {
    stopping = false;
    if (resultFile) {
      fs.writeFileSync(resultFile, JSON.stringify({ error: error.message }));
      app.exit(1);
    } else {
      dialog.showErrorBox('本机服务停止失败', `${error.message}\n请查看安装目录的 logs 文件夹。`);
    }
  }
}

async function startDesktop() {
  const { config } = await import(pathToFileURL(path.join(root, 'windows/common.mjs')).href);
  const settings = config();
  app.setPath('userData', path.join(root, 'data/desktop'));
  const origin = `http://127.0.0.1:${settings.port}`;
  window = new BrowserWindow({
    title: '融光 FusionVideo', width: 1280, height: 850, minWidth: 960, minHeight: 680,
    backgroundColor: '#f6f5f2',
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
  window.on('close', (event) => {
    if (!exiting) {
      event.preventDefault();
      void shutdown();
    }
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin !== origin) {
      event.preventDefault();
    }
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: '融光', submenu: [
      { label: '打开日志目录', click: () => shell.openPath(path.join(root, 'logs')) },
      { type: 'separator' },
      { label: '退出并停止本机服务', click: () => void shutdown() },
    ] },
    { label: '编辑', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: '视图', submenu: [{ role: 'reload' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }] },
  ]));
  await window.loadFile(path.join(__dirname, 'desktop-loading.html'));
  startup = command('start');
  await startup;
  if (stopping) {
    return;
  }
  await window.loadURL(origin);
  if (resultFile) {
    // This mode tests the actual packaged window, its rendered document and its close handler.
    let document;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      document = await window.webContents.executeJavaScript('({ title: document.title, text: document.body.innerText, inputs: document.querySelectorAll("input").length })');
      if (document.inputs >= 3 && document.text.includes('系统初始化')) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (!document.text.includes('系统初始化') || document.inputs < 3) {
      throw new Error('The desktop window did not render the initialization form');
    }
    // The authentication layout fades its form in after the document is loaded.
    await window.webContents.executeJavaScript('Promise.all(document.getAnimations().filter(animation => animation.effect.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})))');
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const initResponse = await fetch(`${origin}/api/system/init/status`);
    const init = await initResponse.json();
    if (!initResponse.ok || init.code !== 0 || init.data?.initialized !== false) {
      throw new Error('The fresh desktop application did not reach its initialization API');
    }
    const image = await window.webContents.capturePage();
    fs.writeFileSync(`${resultFile}.png`, image.toPNG());
    smoke = {
      executable: process.execPath, electron: process.versions.electron,
      url: window.webContents.getURL(), title: document.title, inputs: document.inputs,
      renderedInitialization: true, origin, screenshot: `${resultFile}.png`,
      initializationApi: 'passed',
    };
    window.close();
  }
}

if (!app.requestSingleInstanceLock()) {
  app.exit(0);
} else {
  app.on('second-instance', () => {
    if (window) {
      if (window.isMinimized()) {
        window.restore();
      }
      window.show();
      window.focus();
    }
  });
  app.on('before-quit', (event) => {
    if (!exiting) {
      event.preventDefault();
      void shutdown();
    }
  });
  app.whenReady().then(startDesktop).catch(async (error) => {
    if (resultFile) {
      fs.writeFileSync(resultFile, JSON.stringify({ error: error.message }));
      await startup?.catch(() => {});
      await command('stop').catch(() => {});
      app.exit(1);
    } else {
      dialog.showErrorBox('融光启动失败', `${error.message}\n日志目录：${path.join(root, 'logs')}`);
    }
  });
}
