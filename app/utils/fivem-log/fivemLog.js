import fs from "fs"
import path from "path"

import {expandPath} from "../fivem-install/fivemInstall"

const LOG_NAME_PATTERN = /^CitizenFX_log_.*\.log$/i
const EXPORT_NAME_PATTERN = /^fivem-join-.*\.log$/i
const MAX_LOG_BYTES = 2 * 1024 * 1024
const KEEP_EXPORTS = 10

const isFile = (targetPath) => {
  try {
    return fs.statSync(targetPath).isFile()
  } catch (error) {
    return false
  }
}

const isDirectory = (targetPath) => {
  try {
    return fs.statSync(targetPath).isDirectory()
  } catch (error) {
    return false
  }
}

// Logi klienta leżą obok pliku FiveM.exe, więc wystarczy ścieżka z ustawień.
// Gdyby była błędna, sprawdzamy jeszcze domyślną instalację w %localappdata%.
const candidateLogDirs = (exePath) => {
  const dirs = []
  const expanded = expandPath(exePath)
  const localAppData = process.env.LOCALAPPDATA

  if (expanded) {
    dirs.push(path.join(path.dirname(expanded), "FiveM.app", "logs"))
  }

  if (localAppData) {
    const fallback = path.join(localAppData, "FiveM", "FiveM.app", "logs")
    if (!dirs.includes(fallback)) {
      dirs.push(fallback)
    }
  }

  return dirs
}

export const newestFivemLog = (exePath) => {
  let newest = null

  candidateLogDirs(exePath).forEach((dir) => {
    if (!isDirectory(dir)) {
      return
    }

    let entries = []

    try {
      entries = fs.readdirSync(dir)
    } catch (error) {
      return
    }

    entries.forEach((name) => {
      if (!LOG_NAME_PATTERN.test(name)) {
        return
      }

      const logPath = path.join(dir, name)
      let stats = null

      try {
        stats = fs.statSync(logPath)
      } catch (error) {
        return
      }

      if (stats.isFile() && (!newest || stats.mtimeMs > newest.mtimeMs)) {
        newest = {path: logPath, size: stats.size, mtimeMs: stats.mtimeMs}
      }
    })
  })

  return newest
}

// Duży log czytamy tylko od końca, bo najnowsze wpisy są na samym dole,
// a cały plik potrafi mieć kilkaset kilobajtów.
const readLogTail = (logPath, maxBytes) => {
  const stats = fs.statSync(logPath)
  const start = Math.max(0, stats.size - maxBytes)
  const length = stats.size - start
  const buffer = Buffer.alloc(length)
  const fd = fs.openSync(logPath, "r")

  try {
    fs.readSync(fd, buffer, 0, length, start)
  } finally {
    fs.closeSync(fd)
  }

  return buffer.toString("utf8")
}

const stampFor = (date) => {
  const pad = (value) => String(value).padStart(2, "0")

  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join("")
}

const pruneExports = (logsDir) => {
  let entries = []

  try {
    entries = fs.readdirSync(logsDir)
  } catch (error) {
    return
  }

  entries
    .filter((name) => EXPORT_NAME_PATTERN.test(name))
    .sort()
    .reverse()
    .slice(KEEP_EXPORTS)
    .forEach((name) => {
      try {
        fs.unlinkSync(path.join(logsDir, name))
      } catch (error) {
        // Brak dostępu do starego pliku nie może psuć zapisu nowego.
      }
    })
}

// Wywoływane tylko wtedy, gdy dołączenie się nie udało. Zapisujemy wtedy
// kopię logu FiveM razem z informacją, co poszło nie tak, żeby gracz mógł
// podesłać jeden plik zamiast szukać logów w folderze gry.
export const saveJoinLog = ({
  exePath,
  address,
  error,
  method,
  logsDir,
  now = Date.now()
} = {}) => {
  if (!logsDir) {
    return null
  }

  try {
    fs.mkdirSync(logsDir, {recursive: true})
  } catch (mkdirError) {
    return null
  }

  const source = newestFivemLog(exePath)
  const date = new Date(now)
  const header = [
    "HexPlay Launcher - log nieudanego dołączania",
    `Data: ${date.toISOString()}`,
    `Adres serwera: ${address || "brak"}`,
    `Wynik: ${error || method || "nieznany"}`,
    source
      ? `Log FiveM: ${source.path} (zapis z ${new Date(source.mtimeMs).toISOString()})`
      : "Log FiveM: nie znaleziono, klient prawdopodobnie nie wystartował",
    "------------------------------------------------------------",
    ""
  ].join("\r\n")

  let body = ""

  if (source) {
    try {
      body = readLogTail(source.path, MAX_LOG_BYTES)
    } catch (readError) {
      body = "Nie udało się odczytać logu FiveM."
    }
  }

  const target = path.join(logsDir, `fivem-join-${stampFor(date)}.log`)

  try {
    fs.writeFileSync(target, header + body, "utf8")
  } catch (writeError) {
    return null
  }

  pruneExports(logsDir)

  return target
}

// Okno podaje ścieżkę zapisanego logu, więc otwieramy tylko pliki z własnego
// folderu launchera i tylko z rozszerzeniem .log.
export const openSavedLog = (logPath, logsDir, openItem) => {
  if (!logPath || !logsDir || typeof openItem !== "function") {
    return false
  }

  const base = path.resolve(String(logsDir))
  const target = path.resolve(String(logPath))

  if (target !== base && !target.startsWith(base + path.sep)) {
    return false
  }

  if (!/\.log$/i.test(target) || !isFile(target)) {
    return false
  }

  try {
    openItem(target)
    return true
  } catch (error) {
    return false
  }
}
