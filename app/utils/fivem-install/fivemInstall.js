import fs from "fs"
import path from "path"

// Foldery cache klienta FiveM, które można bezpiecznie usunąć.
// "game" w server-cache zawiera zasoby GTA V i musi pozostać na miejscu.
const CACHE_TARGETS = [
  {
    key: "browser",
    label: "Cache przeglądarki",
    parts: ["FiveM.app", "data", "cache", "browser"]
  },
  {
    key: "subprocess",
    label: "Cache podprocesów",
    parts: ["FiveM.app", "data", "cache", "subprocess"]
  },
  {
    key: "server-cache-priv",
    label: "Prywatny cache serwerów",
    parts: ["FiveM.app", "data", "server-cache-priv"]
  },
  {
    key: "server-cache",
    label: "Cache serwerów",
    parts: ["FiveM.app", "data", "server-cache"],
    keep: ["game"]
  },
  {
    key: "nui-storage",
    label: "Dane interfejsów NUI",
    parts: ["FiveM.app", "data", "nui-storage"]
  }
]

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

// Sprawdzamy również nazwę pliku, żeby przez pomyłkę nie czyścić
// folderów cache przy dowolnym innym programie.
const looksLikeFiveM = (layout) =>
  isFile(layout.exePath) && path.basename(layout.exePath).toLowerCase() === "fivem.exe"

const isDirectory = (targetPath) => {
  try {
    return fs.statSync(targetPath).isDirectory()
  } catch (error) {
    return false
  }
}

const measure = (targetPath, keep = []) => {
  let entries = []

  try {
    entries = fs.readdirSync(targetPath, {withFileTypes: true})
  } catch (error) {
    return 0
  }

  return entries.reduce((total, entry) => {
    if (keep.includes(entry.name) || entry.isSymbolicLink()) {
      return total
    }

    const fullPath = path.join(targetPath, entry.name)

    if (entry.isDirectory()) {
      return total + measure(fullPath)
    }

    if (entry.isFile()) {
      try {
        return total + fs.statSync(fullPath).size
      } catch (error) {
        return total
      }
    }

    return total
  }, 0)
}

const removeContents = (targetPath, keep = []) => {
  let entries = []

  try {
    entries = fs.readdirSync(targetPath, {withFileTypes: true})
  } catch (error) {
    if (error.code !== "ENOENT") {
      return {removed: 0, errors: [`${targetPath}: ${error.message}`]}
    }
    return {removed: 0, errors: []}
  }

  let removed = 0
  const errors = []

  entries.forEach((entry) => {
    if (keep.includes(entry.name)) {
      return
    }

    const fullPath = path.join(targetPath, entry.name)

    try {
      if (entry.isSymbolicLink()) {
        fs.unlinkSync(fullPath)
      } else if (entry.isDirectory()) {
        fs.rmdirSync(fullPath, {recursive: true})
      } else {
        fs.unlinkSync(fullPath)
      }
      removed += 1
    } catch (error) {
      errors.push(`${entry.name}: ${error.message}`)
    }
  })

  return {removed, errors}
}

const cacheTargetsFor = (layout) =>
  CACHE_TARGETS.map((target) => {
    const targetPath = layout.appDir ? path.join(layout.appDir, ...target.parts.slice(1)) : ""
    const exists = !!targetPath && isDirectory(targetPath)

    return {
      key: target.key,
      label: target.label,
      path: targetPath,
      exists,
      bytes: exists ? measure(targetPath, target.keep || []) : 0,
      keep: target.keep || []
    }
  })

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
    cacheBytes: targets.reduce((total, target) => total + target.bytes, 0),
    cacheTargets: targets.map(({keep, ...target}) => target),
    error: found ? null : "missing_exe"
  }
}

// Usuwa tylko zawartość znanych folderów cache. Zasoby gry w
// server-cache/game pozostają nietknięte.
export const clearCache = (rawPath) => {
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

  const before = cacheTargetsFor(layout)
  const targets = []
  const errors = []
  let removedEntries = 0

  before.forEach((target) => {
    if (!target.exists) {
      return
    }

    const result = removeContents(target.path, target.keep)
    removedEntries += result.removed
    errors.push(...result.errors)

    targets.push({
      key: target.key,
      label: target.label,
      bytes: target.bytes,
      removed: result.removed
    })
  })

  const after = cacheTargetsFor(layout)
  const afterBytes = after.reduce((total, target) => total + target.bytes, 0)

  return {
    ok: true,
    error: null,
    freedBytes: Math.max(0, before.reduce((total, target) => total + target.bytes, 0) - afterBytes),
    removedEntries,
    targets,
    errors
  }
}

export default inspectInstall
