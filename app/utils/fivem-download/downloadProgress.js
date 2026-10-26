import fs from "fs"

import {newestFivemLog} from "../fivem-log/fivemLog"

// Klient FiveM wypisuje postęp dołączenia do logu, np.
//   [ 52406] [b2699_GTAProce] Render/ OnConnectionProgress: Downloading
//   qb-core (10 of 199 - 0.06/0.62 MiB)
// Ten sam tekst trafia do okna ładowania gry, więc launcher ma prawdziwy
// postęp pobierania bez zaglądania w wewnętrzny format cache.
const PROGRESS_PATTERN = /OnConnectionProgress:\s*(.+?)\s*$/
const RESOURCE_PATTERN = /^Downloading\s+(.+?)\s+\((\d+)\s+of\s+(\d+)\s+-\s+([\d.,]+)\/([\d.,]+)\s+MiB\)/i
const MANIFEST_DOWNLOAD_PATTERN = /^Downloading\s+content\s+manifest/i
const MANIFEST_LOAD_PATTERN = /^Loading\s+content\s+manifest/i
const DOWNLOADING_PATTERN = /^Downloading/i
const LOADING_PATTERN = /^(Loading|Initializing|Connecting|Joining)/i

const MIB = 1024 * 1024
const TAIL_BYTES = 64 * 1024
const MAX_CHUNK_BYTES = 256 * 1024

const toNumber = (value) => {
  const parsed = Number(String(value || "").replace(",", "."))

  return Number.isFinite(parsed) ? parsed : 0
}

const percentOf = (current, total) => {
  if (!Number.isFinite(current) || !Number.isFinite(total) || total <= 0) {
    return null
  }

  return Math.min(100, Math.max(0, Math.round((current / total) * 100)))
}

// Zamienia pojedynczą linię logu na stan pobierania. Zwraca null, gdy linia
// nie dotyczy postępu dołączania.
export const parseProgressEvent = (line) => {
  if (typeof line !== "string") {
    return null
  }

  const match = PROGRESS_PATTERN.exec(line)

  if (!match) {
    return null
  }

  const text = match[1]
  const resource = RESOURCE_PATTERN.exec(text)

  if (resource) {
    const current = Number(resource[2])
    const total = Number(resource[3])

    return {
      phase: "downloading",
      text,
      resource: resource[1].trim(),
      current,
      total,
      doneBytes: Math.round(toNumber(resource[4]) * MIB),
      totalBytes: Math.round(toNumber(resource[5]) * MIB),
      percent: percentOf(current, total)
    }
  }

  if (MANIFEST_DOWNLOAD_PATTERN.test(text)) {
    return {phase: "manifest", text, percent: null}
  }

  if (MANIFEST_LOAD_PATTERN.test(text)) {
    return {phase: "loading", text, percent: 100}
  }

  if (DOWNLOADING_PATTERN.test(text)) {
    return {phase: "downloading", text, percent: null}
  }

  if (LOADING_PATTERN.test(text)) {
    return {phase: "loading", text, percent: 100}
  }

  return {phase: "progress", text, percent: null}
}

// Bierzemy ostatnie zdarzenie z odczytanego fragmentu logu, bo tylko ono
// opisuje aktualny etap dołączania.
export const parseProgressFromLog = (chunk) => {
  if (typeof chunk !== "string" || chunk === "") {
    return null
  }

  const lines = chunk.split(/\r?\n/)

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const event = parseProgressEvent(lines[index])

    if (event) {
      return event
    }
  }

  return null
}

const emptyState = (at) => ({
  active: true,
  phase: "starting",
  text: "",
  resource: null,
  current: null,
  total: null,
  percent: null,
  stalled: false,
  stalledFor: 0,
  updatedAt: at
})

// Stan pobierania i wykrywanie zastoju. Log FiveM jest jedynym źródłem
// świeżych danych, więc brak nowych wpisów przez dłuższy czas oznacza, że
// pobieranie stoi. Progi są inne dla manifestu, bo bywa duży i rzadko
// raportuje postęp.
export const createProgressTracker = ({
  stallMs = 40000,
  manifestStallMs = 90000,
  now = Date.now
} = {}) => {
  let state = emptyState(now())

  const stallLimit = () => {
    if (state.phase === "downloading") {
      return stallMs
    }

    if (state.phase === "manifest") {
      return manifestStallMs
    }

    return 0
  }

  return {
    start(at = now()) {
      state = emptyState(at)
    },
    push(event, at = now()) {
      if (!event || !event.phase) {
        return
      }

      state = {
        ...emptyState(at),
        phase: event.phase,
        text: event.text || "",
        resource: event.resource || null,
        current: Number.isFinite(event.current) ? event.current : null,
        total: Number.isFinite(event.total) ? event.total : null,
        percent: Number.isFinite(event.percent) ? event.percent : null
      }
    },
    tick(at = now()) {
      const limit = stallLimit()
      const waited = Math.max(0, at - state.updatedAt)
      const stalled = limit > 0 && waited > limit

      state = {
        ...state,
        stalled,
        stalledFor: stalled ? waited : 0
      }
    },
    state() {
      return {...state}
    }
  }
}

const readLogChunk = (logPath, from, length) => {
  const buffer = Buffer.alloc(length)
  const descriptor = fs.openSync(logPath, "r")

  try {
    fs.readSync(descriptor, buffer, 0, length, from)
  } finally {
    fs.closeSync(descriptor)
  }

  return buffer.toString("utf8")
}

// Monitor działa w procesie głównym: raz na sekundę sprawdza rozmiar
// najnowszego logu i czyta tylko nowy fragment. Dzięki temu duży log nie
// obciąża dysku, a okno dostaje aktualny etap pobierania.
export const startDownloadMonitor = ({
  exePath,
  onUpdate = () => {},
  onStop = () => {},
  pollMs = 1000,
  idleMs = 60000,
  loadingMs = 20000,
  maxDuration = 15 * 60 * 1000,
  stallMs = 40000,
  manifestStallMs = 90000,
  now = Date.now,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  findLog = newestFivemLog,
  statLog = (logPath) => fs.statSync(logPath),
  readChunk = readLogChunk
} = {}) => {
  const tracker = createProgressTracker({stallMs, manifestStallMs, now})
  const startedAt = now()

  let logPath = ""
  let offset = 0
  let timer = null
  let stopped = false
  let lastEmitted = ""

  tracker.start(startedAt)

  const emit = (state) => {
    const serialized = JSON.stringify(state)

    if (serialized === lastEmitted) {
      return
    }

    lastEmitted = serialized
    onUpdate(state)
  }

  const stop = (phase = "stopped") => {
    if (stopped) {
      return
    }

    stopped = true

    if (timer) {
      clearIntervalFn(timer)
    }

    timer = null
    emit({...tracker.state(), active: false, phase})
    onStop()
  }

  const readNewProgress = (at) => {
    const found = findLog(exePath)

    if (!found || !found.path) {
      return
    }

    // Log z poprzedniego uruchomienia klienta nie opisuje tego dołączenia,
    // więc czekamy, aż FiveM zacznie pisać nowy plik.
    if (!logPath && found.mtimeMs && found.mtimeMs < startedAt - 5000) {
      return
    }

    if (found.path !== logPath) {
      logPath = found.path
      offset = 0
    }

    let stats = null

    try {
      stats = statLog(logPath)
    } catch (error) {
      // Klient mógł zamknąć log albo zacząć nowy plik.
      logPath = ""
      offset = 0
      return
    }

    if (!stats || typeof stats.size !== "number" || stats.size <= 0) {
      return
    }

    // Pierwsze czytanie bierze ogon logu, żeby nie przegapić etapu, który
    // zdążył się wypisać przed pierwszym sprawdzeniem.
    let from = offset > 0 ? offset : Math.max(0, stats.size - TAIL_BYTES)

    if (from >= stats.size) {
      return
    }

    if (stats.size - from > MAX_CHUNK_BYTES) {
      from = stats.size - MAX_CHUNK_BYTES
    }

    let text = ""

    try {
      text = readChunk(logPath, from, stats.size - from)
    } catch (error) {
      logPath = ""
      offset = 0
      return
    }

    offset = stats.size

    const event = parseProgressFromLog(text)

    if (event) {
      tracker.push(event, at)
    }
  }

  const tick = () => {
    if (stopped) {
      return
    }

    const at = now()

    try {
      readNewProgress(at)
    } catch (error) {
      // Błąd odczytu logu nie może zatrzymać samego monitorowania.
    }

    tracker.tick(at)

    const state = tracker.state()

    if (at - startedAt >= maxDuration) {
      stop("stopped")
      return
    }

    if (state.phase === "loading" && at - state.updatedAt >= loadingMs) {
      stop("done")
      return
    }

    // Bezczynny klient z ciepłym cache nie wypisze etapu pobierania, więc
    // pasek nie może wisieć w oknie bez końca.
    if (state.phase === "starting" && at - startedAt >= idleMs) {
      stop("idle")
      return
    }

    emit(state)
  }

  timer = setIntervalFn(tick, pollMs)

  if (timer && typeof timer.unref === "function") {
    timer.unref()
  }

  tick()

  return {
    stop: () => stop(),
    state: () => tracker.state()
  }
}
