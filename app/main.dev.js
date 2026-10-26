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
import path from "path";

import closeFivem, {
  listFivemProcessIds,
  probeFivemProcessIds
} from "./utils/fivem-process/closeFivem";
import {watchFivemCrash} from "./utils/fivem-process/watchFivemCrash";
import {inspectInstall, measureCache, clearCache} from "./utils/fivem-install/fivemInstall";
import GithubUpdater from "./utils/updater/githubUpdater";
import {
  launchFivem as startFivem,
  serverAddressArg,
  fetchServerStatus
} from "./utils/fivem-connection/fivemConnection";
import {saveJoinLog, openSavedLog} from "./utils/fivem-log/fivemLog";

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

// Kopie logów FiveM trzymamy w folderze danych launchera, a nie w folderze gry.
const joinLogsDir = () => path.join(app.getPath('userData'), 'logs');

const fivemPathArg = (value) =>
  typeof value === 'string' && value.length <= 1024 ? value : '';

let stopCrashWatch = null;

// Zatrzymuje obserwację przed świadomym zamknięciem gry, żeby aktualizacja
// albo czyszczenie cache nie zostały zgłoszone jako crash.
const cancelCrashWatch = () => {
  if (stopCrashWatch) {
    stopCrashWatch();
    stopCrashWatch = null;
  }
};

// Po udanym dołączeniu pilnujemy, czy FiveM nie zamknął się zaraz po starcie.
// Jeśli tak, zapisujemy log i pokazujemy w oknie komunikat z przyciskiem.
const startCrashWatch = ({address, exePath}) => {
  cancelCrashWatch();

  stopCrashWatch = watchFivemCrash({
    probe: probeFivemProcessIds,
    onCrash: () => {
      stopCrashWatch = null;

      let logPath = null;

      try {
        logPath = saveJoinLog({
          exePath,
          address: serverAddressArg(address),
          error: 'FiveM zamknął się po dołączeniu do serwera',
          method: 'watch',
          logsDir: joinLogsDir()
        });
      } catch (error) {
        log.warn('Could not save FiveM log after crash:', error.message);
      }

      log.warn(`FiveM closed shortly after joining ${serverAddressArg(address)}.`);

      sendStatusToWindow(
        'fivem_crash',
        'FiveM zamknął się tuż po dołączeniu. Jeśli to był crash, otwórz log FiveM.',
        {logPath}
      );
    }
  });
};

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
  cancelCrashWatch();

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

  // Ręczne sprawdzenie z ustawień, gdy gracz nie chce czekać na cykl.
  ipcMain.handle('updater:check', () =>
    updater ? updater.checkNow() : null
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
    cancelCrashWatch();

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

  // Status serwera czytamy w procesie głównym, żeby ominąć CORS.
  ipcMain.handle('server:status', async (event, payload = {}) => {
    const status = await fetchServerStatus(payload.address);

    if (!status.ok) {
      log.info(`Server ${serverAddressArg(payload.address)} status: ${status.error}`);
    }

    return status;
  });

  // Dołączanie do serwera. Zwraca wynik, żeby okno mogło pokazać komunikat
  // zamiast milczeć, gdy gry nie da się uruchomić.
  ipcMain.handle('fivem:join', async (event, payload = {}) => {
    const result = await startFivem({
      address: payload.address,
      exePath: payload.exePath,
      openProtocol: (url) => shell.openExternal(url)
    });

    if (result.ok) {
      log.info(`Join ${payload.address}: launched through ${result.method}.`);
      startCrashWatch({address: payload.address, exePath: payload.exePath});
      return result;
    }

    log.warn(`Join ${payload.address} failed: ${result.error}.`);

    // Nieudane dołączenie zapisujemy razem z logiem FiveM, żeby gracz miał
    // jeden plik do podesłania i mógł go otworzyć z okna launchera.
    let logPath = null;

    try {
      logPath = saveJoinLog({
        exePath: payload.exePath,
        address: serverAddressArg(payload.address),
        error: result.error,
        method: result.method,
        logsDir: joinLogsDir()
      });
    } catch (error) {
      log.warn('Could not save FiveM log:', error.message);
    }

    return {...result, logPath};
  });

  ipcMain.handle('fivem:open-log', (event, logPath) =>
    openSavedLog(logPath, joinLogsDir(), (target) => shell.openItem(target))
  );

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
      // Starsza droga wywołania, zachowana dla zgodności. Wynik idzie do okna
      // komunikatem statusu, tak samo jak przy nowym fivem:join.
      startFivem({
        address: data.payload.path,
        exePath: data.payload.command,
        openProtocol: (url) => shell.openExternal(url)
      }).then((result) => {
        if (!result.ok) {
          sendStatusToWindow('fivem_invalid', 'Nieprawidłowa lokalizacja FiveM.');
        }
      });
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
