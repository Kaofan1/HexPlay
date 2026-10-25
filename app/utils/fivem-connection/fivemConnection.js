import fs from "fs"
import http from "http"
import {execFile, spawn} from "child_process"

// Adres serwera trafia do polecenia gry, więc dopuszczamy tylko postać
// IP:port lub host:port. Dzięki temu nic obcego nie uruchomi się w grze.
export const SERVER_ADDRESS_PATTERN = /^[a-z0-9][a-z0-9.-]{0,80}:\d{2,5}$/i

export const DEFAULT_FIVEM_PATH = "%localappdata%\\FiveM\\FiveM.exe"

export const serverAddressArg = (value) => {
  const address = typeof value === "string" ? value.trim() : ""

  return SERVER_ADDRESS_PATTERN.test(address) ? address : null
}

export const expandEnvVars = (value) => {
  const env = {}

  Object.keys(process.env).forEach((key) => {
    env[key.toLowerCase()] = process.env[key]
  })

  return String(value || "").replace(/%([^%]+)%/g, (match, name) =>
    env[String(name).toLowerCase()] || match
  )
}

// Ścieżka z ustawień bywa zapisana ze zmienną (%localappdata%) lub innym
// rozmiarem liter, więc plik sprawdzamy po rozwinięciu zmiennych środowiska.
export const resolveFivemExe = (value) => {
  const expanded = expandEnvVars(
    typeof value === "string" && value.length <= 1024 ? value : ""
  )

  if (!expanded || !/\.exe$/i.test(expanded)) {
    return null
  }

  try {
    return fs.statSync(expanded).isFile() ? expanded : null
  } catch (error) {
    return null
  }
}

export const spawnDetached = (file, args) => {
  try {
    const child = spawn(file, args, {detached: true, stdio: "ignore"})

    // Błędy startu nie mogą wysypać procesu głównego, a zdarzenie "spawn"
    // istnieje dopiero od Node 15, więc nie czekamy na nie.
    child.on("error", () => {})
    child.unref()

    return true
  } catch (error) {
    return false
  }
}

const GAME_PROCESS_PATTERN = /^fivem_b\d+_gtaprocess\.exe$/

// Nazwy procesów wystarczą, żeby rozpoznać, czy klient i gra już działają.
export const listProcessNames = () =>
  new Promise((resolve) => {
    try {
      execFile(
        "tasklist",
        ["/FO", "CSV", "/NH"],
        {windowsHide: true, maxBuffer: 4 * 1024 * 1024, timeout: 8000},
        (error, stdout) => {
          if (error) {
            resolve([])
            return
          }

          const lines = String(stdout || "").match(/^"[^"]+"/gm) || []
          const names = lines.map((entry) => entry.slice(1, -1).toLowerCase())

          resolve(names)
        }
      )
    } catch (error) {
      resolve([])
    }
  })

export const isGameRunning = (names) =>
  Array.isArray(names) && names.some((name) => GAME_PROCESS_PATTERN.test(name))

export const isClientRunning = (names) =>
  Array.isArray(names) && names.some((name) => /^fivem.*\.exe$/.test(name))

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Czekamy, aż klient FiveM uruchomi grę. Dopiero wtedy przekazanie adresu
// przez fivem:// łączy działającą grę, zamiast startować klienta z argumentem.
const waitForGame = async ({listProcesses, wait, timeout, settle}) => {
  const deadline = Date.now() + timeout

  while (Date.now() < deadline) {
    if (isGameRunning(await listProcesses())) {
      await wait(settle)
      return true
    }

    await wait(2000)
  }

  return false
}

// Dołączanie do serwera w dwóch krokach. Gdy klient już działa, sam adres
// fivem:// wystarcza. Przy zimnym starcie najpierw uruchamiamy FiveM bez
// argumentów, bo start z adresem potrafi wywalić przekazanie gry z Rockstar
// Launchera ("This application should be launched directly from the shell...").
export const launchFivem = async ({
  address,
  exePath,
  openProtocol,
  listProcesses = listProcessNames,
  wait = sleep,
  readyTimeout = 70000,
  settle = 8000
} = {}) => {
  const target = serverAddressArg(address)

  if (!target) {
    return {ok: false, error: "invalid_address"}
  }

  const link = `fivem://connect/${target}`
  const processes = await listProcesses()

  if (isGameRunning(processes)) {
    try {
      await openProtocol(link)
      return {ok: true, method: "running"}
    } catch (error) {
      return {ok: false, error: "launch_failed"}
    }
  }

  const exe = resolveFivemExe(exePath) || resolveFivemExe(DEFAULT_FIVEM_PATH)

  if (!exe) {
    try {
      await openProtocol(link)
      return {ok: true, method: "protocol"}
    } catch (error) {
      return {ok: false, error: "missing_exe"}
    }
  }

  if (!spawnDetached(exe, [])) {
    try {
      await openProtocol(link)
      return {ok: true, method: "protocol"}
    } catch (error) {
      return {ok: false, error: "launch_failed"}
    }
  }

  const ready = await waitForGame({listProcesses, wait, timeout: readyTimeout, settle})

  try {
    await openProtocol(link)
    return {ok: true, method: ready ? "client" : "client_unready"}
  } catch (error) {
    // Klient i tak wystartował, więc gracz może dołączyć z listy serwerów.
    return {ok: true, method: "client_manual"}
  }
}

const requestJson = (url, timeout) =>
  new Promise((resolve, reject) => {
    let settled = false
    let timer = null

    const finish = (callback, value) => {
      if (settled) {
        return
      }

      settled = true

      if (timer) {
        clearTimeout(timer)
      }

      callback(value)
    }

    const request = http.get(url, (response) => {
      if (response.statusCode !== 200) {
        response.resume()
        finish(reject, new Error(`HTTP ${response.statusCode}`))
        return
      }

      let body = ""
      let size = 0

      response.setEncoding("utf8")
      response.on("data", (chunk) => {
        size += chunk.length

        if (size > 2 * 1024 * 1024) {
          request.destroy()
          finish(reject, new Error("response_too_large"))
          return
        }

        body += chunk
      })
      response.on("error", (error) => finish(reject, error))
      response.on("end", () => {
        try {
          finish(resolve, JSON.parse(body))
        } catch (error) {
          finish(reject, new Error("invalid_json"))
        }
      })
    })

    // Limit musi obejmować samo łączenie, bo przy nieosiągalnym porcie
    // system potrafi czekać z SYN nawet ponad 20 sekund.
    timer = setTimeout(() => {
      request.destroy()
      finish(reject, new Error("timeout"))
    }, timeout)

    request.on("error", (error) => finish(reject, error))
  })

const readStatus = async (target, timeout) => {
  let info = null

  try {
    info = await requestJson(`http://${target}/info.json`, timeout)
  } catch (error) {
    // Pojedyncze zacięcie serwera nie może udawać serwera offline,
    // więc przy przekroczeniu czasu pytamy jeszcze raz, krótko.
    if (error.message !== "timeout") {
      return {ok: false, error: error.message, info: null, players: []}
    }

    try {
      info = await requestJson(`http://${target}/info.json`, Math.min(timeout, 4000))
    } catch (retryError) {
      return {ok: false, error: retryError.message, info: null, players: []}
    }
  }

  if (!info || typeof info !== "object") {
    return {ok: false, error: "invalid_response", info: null, players: []}
  }

  let players = []

  try {
    players = await requestJson(`http://${target}/players.json`, timeout)
  } catch (error) {
    players = []
  }

  return {ok: true, error: null, info, players: Array.isArray(players) ? players : []}
}

// Jedno zapytanie na adres naraz. Odświeżanie statusu co 20 sekund nie
// mnoży wtedy wolnych połączeń, gdy serwer odpowiada z opóźnieniem.
const inFlight = new Map()

// info.json serwera FiveM nie wysyła nagłówka CORS, więc okno launchera
// (działające z pliku) nie odczytałoby odpowiedzi. Dlatego pytamy tutaj.
export const fetchServerStatus = (address, {timeout = 6000} = {}) => {
  const target = serverAddressArg(address)

  if (!target) {
    return Promise.resolve({ok: false, error: "invalid_address", info: null, players: []})
  }

  const key = target.toLowerCase()

  if (inFlight.has(key)) {
    return inFlight.get(key)
  }

  const request = readStatus(target, timeout).then(
    (result) => {
      inFlight.delete(key)
      return result
    },
    (error) => {
      inFlight.delete(key)
      throw error
    }
  )

  inFlight.set(key, request)

  return request
}
