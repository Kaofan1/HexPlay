import fs from "fs"
import path from "path"

// Foldery cache klienta FiveM, które można bezpiecznie usunąć.
// "game" w server-cache zawiera zasoby GTA V i musi pozostać na miejscu.
const CACHE_TARGETS = [
  {
    key: "browser",
    label: "Cache przeglądarki",
    parts: ["data", "cache", "browser"]
  },
  {
    key: "subprocess",
    label: "Cache podprocesów",
    parts: ["data", "cache", "subprocess"]
  },
  {
    key: "server-cache-priv",
    label: "Prywatny cache serwerów",
    parts: ["data", "server-cache-priv"]
  },
  {
    key: "server-cache",
    label: "Cache serwerów",
    parts: ["data", "server-cache"],
    keep: ["game"]
  },
  {
    key: "nui-storage",
    label: "Dane interfejsów NUI",
    parts: ["data", "nui-storage"]
  }
]

const MEASURE_BUDGET = 2500
const MAX_ENTRIES = 60000
const SIZE_CACHE_TTL = 60 * 1000

let scanToken = 0
const sizeCache = new Map()

const environment = () => {
  const values = {}
  Object.keys(process.env).forEach((name) => {
    values[name.toLowerCase()] = process.env[name]
  })
  return values
}

// Ustawienia przechowują ścieżkę w postaci %localappdata%\FiveM\FiveM.exe,
// więc przed sprawdzeniem pliku trzeba rozwinąć zmienne środowiskowe.
export const expandPath = (rawPath) => {
  if (!rawPath) {
    return ""
  }

  const values = environment()

  return String(rawPath).replace(/%([^%]+)%/g, (match, name) => {
    const value = values[String(name).toLowerCase()]
    return value || match
  })
}

const layoutFor = (rawPath) => {
  const exePath = expandPath(rawPath)
  const installDir = exePath ? path.dirname(exePath) : ""

  return {
    exePath,
    installDir,
    appDir: installDir ? path.join(installDir, "FiveM.app") : "",
    dataDir: installDir ? path.join(installDir, "FiveM.app", "data") : ""
  }
}

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

// Sprawdzamy również nazwę pliku, żeby przez pomyłkę nie czyścić
// folderów cache przy dowolnym innym programie.
const looksLikeFiveM = (layout) =>
  isFile(layout.exePath) && path.basename(layout.exePath).toLowerCase() === "fivem.exe"

const cacheTargetsFor = (layout) =>
  CACHE_TARGETS.map((target) => {
    const targetPath = layout.appDir ? path.join(layout.appDir, ...target.parts) : ""
    const exists = !!targetPath && isDirectory(targetPath)

    return {
      key: target.key,
      label: target.label,
      path: targetPath,
      exists,
      keep: target.keep || []
    }
  })

// Szybkie sprawdzenie instalacji, bez liczenia rozmiaru cache. Rozmiar
// 15 GB cache potrafi zajmować sekundy, więc mierzymy go osobno i na raty.
export const inspectInstall = (rawPath) => {
  const layout = layoutFor(rawPath)
  const found = looksLikeFiveM(layout)
  const targets = cacheTargetsFor(layout)

  return {
    found,
    exePath: layout.exePath,
    installDir: layout.installDir,
    dataDir: layout.dataDir,
    folderExists: found && isDirectory(layout.dataDir),
    cacheTargets: targets.map(({keep, exists, key, label, path: targetPath}) => ({
      key,
      label,
      path: targetPath,
      exists
    })),
    error: found ? null : "missing_exe"
  }
}

const yieldToLoop = () => new Promise((resolve) => setImmediate(resolve))

// Odczyt folderów i statystyki plików są wykonywane w krótkich porcjach,
// żeby zmierzyć duży cache szybko, ale nadal oddawać wątek główny.
const scanDirectory = async (targetPath, keep, state) => {
  let entries = []

  try {
    entries = fs.readdirSync(targetPath, {withFileTypes: true})
  } catch (error) {
    return
  }

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]

    if (state.token !== scanToken) {
      state.cancelled = true
      state.stopped = true
      return
    }

    if (Date.now() > state.deadline || state.entries >= state.maxEntries) {
      state.complete = false
      state.stopped = true
      return
    }

    if (keep.includes(entry.name) || entry.isSymbolicLink()) {
      // eslint-disable-next-line no-continue
      continue
    }

    state.entries += 1
    const fullPath = path.join(targetPath, entry.name)

    if (entry.isDirectory()) {
      // eslint-disable-next-line no-await-in-loop
      await scanDirectory(fullPath, [], state)
    } else if (entry.isFile()) {
      try {
        state.bytes += fs.statSync(fullPath).size
      } catch (error) {
        // Plik mógł zniknąć w trakcie skanowania.
      }
    }

    if (state.entries % 200 === 0) {
      // eslint-disable-next-line no-await-in-loop
      await yieldToLoop()
    }

    if (state.stopped) {
      return
    }
  }
}

// Mierzenie rozmiaru jest asynchroniczne i ma limit czasu oraz liczby
// plików, żeby nie zawieszać interfejsu na dużym cache.
export const measureCache = async (rawPath, {force = false} = {}) => {
  const layout = layoutFor(rawPath)

  if (!looksLikeFiveM(layout)) {
    return {
      ok: false,
      error: "missing_exe",
      bytes: 0,
      complete: true,
      targets: [],
      cached: false,
      cancelled: false
    }
  }

  const cacheKey = layout.exePath.toLowerCase()
  const cached = sizeCache.get(cacheKey)

  if (!force && cached && Date.now() - cached.at < SIZE_CACHE_TTL) {
    return {...cached.value, cached: true, cancelled: false}
  }

  const token = scanToken + 1
  scanToken = token

  const state = {
    token,
    bytes: 0,
    entries: 0,
    complete: true,
    cancelled: false,
    stopped: false,
    deadline: Date.now() + MEASURE_BUDGET,
    maxEntries: MAX_ENTRIES
  }

  const targets = []

  for (let index = 0; index < CACHE_TARGETS.length; index += 1) {
    const target = CACHE_TARGETS[index]
    const targetPath = path.join(layout.appDir, ...target.parts)

    if (!isDirectory(targetPath)) {
      targets.push({key: target.key, label: target.label, bytes: 0, complete: true})
      // eslint-disable-next-line no-continue
      continue
    }

    const startBytes = state.bytes
    // eslint-disable-next-line no-await-in-loop
    await scanDirectory(targetPath, target.keep || [], state)

    targets.push({
      key: target.key,
      label: target.label,
      bytes: state.bytes - startBytes,
      complete: state.complete
    })

    if (state.stopped) {
      break
    }
  }

  if (state.cancelled) {
    return {
      ok: true,
      bytes: 0,
      complete: false,
      targets: [],
      cached: false,
      cancelled: true
    }
  }

  const result = {
    ok: true,
    bytes: state.bytes,
    complete: state.complete,
    targets
  }

  if (state.complete) {
    sizeCache.set(cacheKey, {at: Date.now(), value: {ok: true, bytes: state.bytes, complete: true, targets}})
  }

  return {...result, cached: false, cancelled: false}
}

const removePath = async (targetPath) => {
  let bytes = 0
  let entries = []

  try {
    entries = await fs.promises.readdir(targetPath, {withFileTypes: true})
  } catch (error) {
    return {bytes: 0, removed: 0, errors: [error.message]}
  }

  let removed = 0
  const errors = []

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]
    const fullPath = path.join(targetPath, entry.name)

    try {
      if (entry.isSymbolicLink()) {
        // eslint-disable-next-line no-await-in-loop
        await fs.promises.unlink(fullPath)
        removed += 1
      } else if (entry.isDirectory()) {
        // eslint-disable-next-line no-await-in-loop
        const child = await removePath(fullPath)
        bytes += child.bytes
        removed += 1
        errors.push(...child.errors)
      } else {
        // eslint-disable-next-line no-await-in-loop
        const stats = await fs.promises.stat(fullPath)
        // eslint-disable-next-line no-await-in-loop
        await fs.promises.unlink(fullPath)
        bytes += stats.size
        removed += 1
      }
    } catch (error) {
      errors.push(`${entry.name}: ${error.message}`)
    }
  }

  try {
    await fs.promises.rmdir(targetPath)
  } catch (error) {
    if (error.code !== "ENOENT" && error.code !== "ENOTEMPTY") {
      errors.push(`${path.basename(targetPath)}: ${error.message}`)
    }
  }

  return {bytes, removed, errors}
}

// Usuwa tylko zawartość znanych folderów cache. Zasoby gry w
// server-cache/game pozostają nietknięte.
export const clearCache = async (rawPath, {onProgress} = {}) => {
  const layout = layoutFor(rawPath)

  if (!looksLikeFiveM(layout)) {
    return {
      ok: false,
      error: "missing_exe",
      freedBytes: 0,
      removedEntries: 0,
      targets: [],
      errors: []
    }
  }

  const targets = cacheTargetsFor(layout).filter((target) => target.exists)
  const errors = []
  let freedBytes = 0
  let removedEntries = 0

  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index]
    let entries = []

    try {
      // eslint-disable-next-line no-await-in-loop
      entries = await fs.promises.readdir(target.path, {withFileTypes: true})
    } catch (error) {
      errors.push(`${target.label}: ${error.message}`)
      entries = []
    }

    let targetBytes = 0

    for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
      const entry = entries[entryIndex]

      if (target.keep.includes(entry.name)) {
        // eslint-disable-next-line no-continue
        continue
      }

      const fullPath = path.join(target.path, entry.name)

      try {
        // eslint-disable-next-line no-await-in-loop
        const stats = entry.isDirectory() ? null : await fs.promises.stat(fullPath)

        if (entry.isDirectory()) {
          // eslint-disable-next-line no-await-in-loop
          const child = await removePath(fullPath)
          targetBytes += child.bytes
          removedEntries += child.removed
          errors.push(...child.errors)
        } else {
          // eslint-disable-next-line no-await-in-loop
          await fs.promises.unlink(fullPath)
          targetBytes += stats.size
          removedEntries += 1
        }
      } catch (error) {
        errors.push(`${entry.name}: ${error.message}`)
      }
    }

    freedBytes += targetBytes

    if (onProgress) {
      onProgress({
        key: target.key,
        label: target.label,
        freedBytes: targetBytes,
        done: index + 1,
        total: targets.length
      })
    }
  }

  sizeCache.delete(layout.exePath.toLowerCase())

  return {
    ok: true,
    error: null,
    freedBytes,
    removedEntries,
    targets: targets.map(({key, label}) => ({key, label})),
    errors
  }
}

export default inspectInstall
