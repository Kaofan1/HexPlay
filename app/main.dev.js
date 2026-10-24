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
import { autoUpdater } from 'electron-updater';
import log from 'electron-log';
import MenuBuilder from './menu';

import {spawn, exec, execFile, fork} from "child_process";
import fs from "fs";

import fivemLocationParser from "./utils/parsers/fivemLocationParser";
import closeFivem from "./utils/fivem-process/closeFivem";

const UPDATE_CHECK_INTERVAL = 10 * 60 * 1000;
const UPDATE_CHECK_COOLDOWN = 2 * 60 * 1000;
const FIVEM_CLOSE_TIMEOUT = 15000;

let mainWindow = null;

const sendStatusToWindow = (status, message, extra = {}) => {
  if (mainWindow) {
    mainWindow.webContents.send('status', {status, message, ...extra});
  }
};

export default class AppUpdater {
  constructor() {
    log.transports.file.level = 'info';
    autoUpdater.logger = log;
    autoUpdater.autoDownload = true;
    // Instalacją sterujemy sami, żeby przed nią zdążyć zamknąć FiveM.
    autoUpdater.autoInstallOnAppQuit = false;

    this.checking = false;
    this.downloaded = false;
    this.lastCheck = 0;

    autoUpdater.on('checking-for-update', () => {
      log.info('Checking for update...');
    });

    autoUpdater.on('update-available', info => {
      sendStatusToWindow(
        'update_available',
        `Dostępna nowa wersja ${info.version} — pobieranie…`,
        {version: info.version}
      );
    });

    autoUpdater.on('update-not-available', () => {
      log.info('Update not available.');
    });

    autoUpdater.on('download-progress', progressObj => {
      sendStatusToWindow(
        'update_progress',
        `Pobieranie aktualizacji (${Math.round(progressObj.percent)}%)`,
        {percent: Math.round(progressObj.percent)}
      );
    });

    autoUpdater.on('update-downloaded', info => {
      this.downloaded = true;
      sendStatusToWindow(
        'update_downloaded',
        `Nowa wersja ${info.version} gotowa — FiveM zostanie zamknięty`,
        {version: info.version}
      );
    });

    autoUpdater.on('error', error => {
      log.warn('Update error:', error);
    });

    this.check(true);
    this.interval = setInterval(() => this.check(), UPDATE_CHECK_INTERVAL);
  }

  /**
   * Sprawdza aktualizacje w tle. Dzięki temu nowa wersja pojawia się
   * w uruchomionym launcherze, a nie dopiero po jego restarcie.
   */
  check(force = false) {
    if (this.checking || this.downloaded) {
      return;
    }

    if (!force && Date.now() - this.lastCheck < UPDATE_CHECK_COOLDOWN) {
      return;
    }

    this.checking = true;
    this.lastCheck = Date.now();

    autoUpdater
      .checkForUpdates()
      .catch(error => log.warn('Update check failed:', error))
      .then(() => {
        this.checking = false;
      });
  }

  isReady() {
    return this.downloaded;
  }
}

let updater = null;
let updateInstallStarted = false;

// Przed instalacją aktualizacji zamykamy FiveM, żeby gracz nie został
// na serwerze ze starą wersją launchera.
const installUpdate = async () => {
  if (updateInstallStarted) {
    return;
  }

  updateInstallStarted = true;
  sendStatusToWindow('update_installing', 'Zamykanie FiveM i instalowanie aktualizacji…');

  try {
    await Promise.race([
      closeFivem(),
      new Promise(resolve => setTimeout(resolve, FIVEM_CLOSE_TIMEOUT))
    ]);
  } catch (error) {
    log.warn('Could not close FiveM:', error);
  }

  autoUpdater.quitAndInstall(false, true);
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
  app.quit()
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
      enableRemoteModule: true
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

  updater = new AppUpdater();

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
