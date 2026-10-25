/* eslint global-require: off */

/**
 * This module executes inside of electron's main process. You can start
 * electron renderer process from here and communicate with the other processes
 * through IPC.
 *
 * When running `yarn build` or `yarn build-main`, this file is compiled to
 * `./app/main.prod.js` using webpack. This gives us some performance wins.
 */
import { app, BrowserWindow, ipcMain, shell } from 'electron';
import log from 'electron-log';
import MenuBuilder from './menu';

import {spawn, exec, execFile, fork} from "child_process";
import fs from "fs";

import fivemLocationParser from "./utils/parsers/fivemLocationParser";
import closeFivem, {listFivemProcessIds} from "./utils/fivem-process/closeFivem";
import {inspectInstall, measureCache, clearCache} from "./utils/fivem-install/fivemInstall";
import GithubUpdater from "./utils/updater/githubUpdater";

const UPDATE_CHECK_INTERVAL = 60 * 1000;
const FIVEM_CLOSE_TIMEOUT = 15000;

let mainWindow = null;

const sendStatusToWindow = (status, message, extra = {}) => {
  if (mainWindow) {
    mainWindow.webContents.send('status', {status, message, ...extra});
  }
};

let updater = null;
let updateInstallStarted = false;

let processStateCache = {at: 0, running: false};
let cacheClearInProgress = false;

const fivemPathArg = (value) =>
  typeof value === 'string' && value.length <= 1024 ? value : '';

// Przed instalacją aktualizacji zamykamy FiveM, żeby gracz nie został
// na serwerze ze starą wersją launchera.
const installUpdate = async () => {
  if (updateInstallStarted || !updater || !updater.isReady()) {
    return;
  }

  const installerPath = updater.installerPath();

  if (!installerPath || !fs.existsSync(installerPath)) {
    log.warn('Update installer is missing:', installerPath);
    return;
  }

  updateInstallStarted = true;
  sendStatusToWindow('update_verifying', 'Sprawdzanie sumy kontrolnej aktualizacji…');

  // Sumę sprawdzamy przed zamknięciem FiveM, żeby przy uszkodzonym pliku
  // nie wyrzucać gracza z serwera bez powodu.
  let verification;

  try {
    verification = await updater.verifyInstaller();
  } catch (error) {
    log.warn('Could not verify update installer:', error.message);
    verification = {ok: false, reason: 'checksum'};
  }

  if (!verification.ok) {
    updateInstallStarted = false;
    sendStatusToWindow(
      'update_available',
      'Plik aktualizacji był uszkodzony. Pobieram go ponownie…'
    );
    updater.check(true);
    return;
  }

  sendStatusToWindow('update_installing', 'Zamykanie FiveM i instalowanie aktualizacji…');

  try {
    await Promise.race([
      closeFivem(),
      new Promise(resolve => setTimeout(resolve, FIVEM_CLOSE_TIMEOUT))
    ]);
  } catch (error) {
    log.warn('Could not close FiveM:', error);
  }

  try {
    await new Promise((resolve, reject) => {
      // Te same argumenty, których używa electron-updater: cichy montaż
      // i ponowne uruchomienie launchera po instalacji.
      const installer = spawn(installerPath, ['--updated', '/S', '--force-run'], {
        detached: true,
        stdio: 'ignore'
      });

      installer.once('error', reject);
      installer.once('spawn', () => {
        installer.unref();
        resolve();
      });
    });

    // app.exit() kończy proces natychmiast. Dzięki temu instalator nie
    // uruchomi nowej wersji obok wciąż zamykającego się starego okna.
    app.exit(0);
  } catch (error) {
    log.warn('Could not run update installer:', error);
    updateInstallStarted = false;
    sendStatusToWindow(
      'update_downloaded',
      'Nie udało się uruchomić instalatora. Spróbuj ponownie.'
    );
  }
};

if (process.env.NODE_ENV === 'production') {
  const sourceMapSupport = require('source-map-support');
  sourceMapSupport.install();
}

if (
  process.env.NODE_ENV === 'development' ||
  process.env.DEBUG_PROD === 'true'
) {
  require('electron-debug')();
}

const installExtensions = async () => {
  const installer = require('electron-devtools-installer');
  const forceDownload = !!process.env.UPGRADE_EXTENSIONS;
  const extensions = ['REACT_DEVELOPER_TOOLS', 'REDUX_DEVTOOLS'];

  return Promise.all(
    extensions.map(name => installer.default(installer[name], forceDownload))
  ).catch(console.log);
};

/**
 * Add event listeners...
 */
const instanceLock = app.requestSingleInstanceLock();
if (!instanceLock) {
  // app.quit() przed gotowością nie zawsze zatrzymuje utworzenie okna,
  // przez co powstawał drugi launcher obok uruchomionego.
  app.exit(0)
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore()
      }
      mainWindow.focus()
    }
  })
}

app.on('window-all-closed', () => {
  // Respect the OSX convention of having the application in memory even
  // after all windows have been closed
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('ready', async () => {
  if (!instanceLock) {
    return;
  }

  if (
    process.env.NODE_ENV === 'development' ||
    process.env.DEBUG_PROD === 'true'
  ) {
    await installExtensions();
  }

  mainWindow = new BrowserWindow({
    show: false,
    width: 1200,
    height: 680,
    backgroundColor: "#070b14", // zsynchronizuj z $brand-surface w app/styles/colors.scss
    webPreferences: {
      nodeIntegration: true,
      enableRemoteModule: true,
      // Bez throttlingu Chromium po Alt+Tab potrafi zostawić zamrożoną,
      // nieprzezroczystą klatkę tła zamiast odświeżyć animację.
      backgroundThrottling: false
    },
    frame: false,
    resizable: false // @TODO: Until window max/unmax is fixed
  });

  mainWindow.loadURL(`file://${__dirname}/app.html`);

  // @TODO: Use 'ready-to-show' event
  //        https://github.com/electron/electron/blob/master/docs/api/browser-window.md#using-ready-to-show-event
  mainWindow.webContents.on('did-finish-load', () => {
    if (!mainWindow) {
      throw new Error('"mainWindow" is not defined');
    }
    if (process.env.START_MINIMIZED) {
      mainWindow.minimize();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow.removeAllListeners();
    mainWindow = null;
  });

  const menuBuilder = new MenuBuilder(mainWindow);
  menuBuilder.buildMenu();

  log.transports.file.level = 'info';
  updater = new GithubUpdater({onStatus: sendStatusToWindow});
  updater.check(true);
  setInterval(() => updater.check(), UPDATE_CHECK_INTERVAL);

  // Informacje o wersjach dla ustawień. Renderer nie widzi obiektu updatera,
  // więc pobiera gotowy stan przez IPC.
  ipcMain.handle('updater:state', () =>
    updater ? updater.state() : null
  );

  // Szybkie sprawdzenie obecności plików, bez liczenia rozmiaru cache.
  ipcMain.handle('fivem:inspect', (event, exePath) =>
    inspectInstall(fivemPathArg(exePath))
  );

  // Rozmiar cache jest liczony asynchronicznie i z limitem czasu,
  // więc nie blokuje wątku głównego ani animacji okna.
  ipcMain.handle('fivem:cache-size', (event, payload = {}) =>
    measureCache(fivemPathArg(payload.exePath), {force: !!payload.force})
  );

  // Sprawdzanie procesów FiveM jest kosztowne (tasklist), więc wynik
  // jest trzymany przez kilka sekund.
  ipcMain.handle('fivem:process-state', async () => {
    if (Date.now() - processStateCache.at < 5000) {
      return processStateCache.running;
    }

    try {
      const ids = await listFivemProcessIds();
      processStateCache = {at: Date.now(), running: ids.length > 0};
    } catch (error) {
      log.warn('Could not list FiveM processes:', error.message);
      processStateCache = {at: Date.now(), running: false};
    }

    return processStateCache.running;
  });

  ipcMain.handle('fivem:clear-cache', async (event, exePath) => {
    if (cacheClearInProgress) {
      return {
        ok: false,
        error: 'busy',
        freedBytes: 0,
        removedEntries: 0,
        targets: [],
        errors: []
      };
    }

    cacheClearInProgress = true;

    try {
      let closed = false;

      try {
        // Pliki cache są zablokowane przez działający klient, więc najpierw go zamykamy.
        closed = await closeFivem();
      } catch (error) {
        log.warn('Could not close FiveM before clearing cache:', error.message);
      }

      const result = await clearCache(fivemPathArg(exePath), {
        onProgress: (progress) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('fivem-cache-progress', progress);
          }
        }
      });

      processStateCache = {at: Date.now(), running: false};

      return {...result, closed};
    } finally {
      cacheClearInProgress = false;
    }
  });

  ipcMain.handle('fivem:open-folder', (event, exePath) => {
    const info = inspectInstall(fivemPathArg(exePath));
    const target = info.folderExists ? info.dataDir : info.installDir;

    if (!target || !fs.existsSync(target)) {
      return false;
    }

    return shell.openItem(target);
  });

  ipcMain.on('mainprocess_action', (event, data) => {
    if (data.action === "app_restart") {
      installUpdate();
    }
    if (data.action === "fivem_process") {
      if (/(FiveM.exe)$/.test(data.payload.command)) {
        const fivemURL = fivemLocationParser(data.payload.command);
        fs.access(fivemURL, fs.F_OK, (err) => {
          if (err) {
            sendStatusToWindow('fivem_invalid', 'Nieprawidłowa lokalizacja FiveM.');
            return
          }

          // const fivemProcess = spawn(
          //   `"${data.payload.command}"`,
          //   data.payload.arguments,
          //   {shell: true}
          // );

          const fivemProcess = spawn(
            "cmd.exe",
            [`${data.payload.command} +connect ${data.payload.path}`],
            {shell: true}
            // {}
          );

          // const fivemProcess = spawn(
          //   // "cmd.exe",
          //   data.payload.command,
          //   // [`${data.payload.command} +connect ${data.payload.path}`],
          //   [],
          //   {
          //     // detached: true,
          //     // stdio: [ 'ignore', 'ignore', 'ignore' ]
          //   }
          // );

        })
      } else {
        sendStatusToWindow('fivem_invalid', 'Invalid FiveM location.');
      }
    }
  });

  mainWindow.on('focus', () => {
    sendStatusToWindow('window_focus', "Window gained focus.");
    // Wymusza pełne odświeżenie okna po powrocie z Alt+Tab.
    mainWindow.webContents.invalidate();
    // Powrót do launchera to dobry moment, żeby sprawdzić nową wersję.
    if (updater) {
      updater.check();
    }
  });

  mainWindow.on('blur', () => {
    sendStatusToWindow('window_blur', "Window lost focus.");
  });

  // mainWindow.webContents.openDevTools(); // @DEBUG: Enables DevTools in production
});

// Zamknięcie launchera z pobraną aktualizacją też najpierw rozłącza FiveM.
app.on('before-quit', event => {
  if (!updater || !updater.isReady() || updateInstallStarted) {
    return;
  }

  event.preventDefault();
  installUpdate();
});
