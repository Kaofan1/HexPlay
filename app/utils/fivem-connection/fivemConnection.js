import fs from "fs"
import http from "http"
import {spawn} from "child_process"

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

// Dołączanie do serwera: najpierw protokół fivem://, bo obsługuje każdą
// instalację i wznawia połączenie w już uruchomionej grze, a gdy system nie
// ma zarejestrowanego protokołu, uruchamiamy plik z ustawień.
export const launchFivem = async ({address, exePath, openProtocol} = {}) => {
  const target = serverAddressArg(address)

  if (!target) {
    return {ok: false, error: "invalid_address"}
  }

  if (typeof openProtocol === "function") {
    try {
      await openProtocol(`fivem://connect/${target}`)
      return {ok: true, method: "protocol"}
    } catch (error) {
      // Brak zarejestrowanego protokołu - próbujemy pliku gry.
    }
  }

  const exe = resolveFivemExe(exePath) || resolveFivemExe(DEFAULT_FIVEM_PATH)

  if (exe && spawnDetached(exe, ["+connect", target])) {
    return {ok: true, method: "process", exe}
  }

  return {ok: false, error: exe ? "launch_failed" : "missing_exe"}
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
