import {app, net} from "electron"
import log from "electron-log"
import crypto from "crypto"
import fs from "fs"
import path from "path"

const RELEASES_URL = "https://api.github.com/repos/Kaofan1/HexPlay/releases/latest"
const INSTALLER_NAME = "HexPlay-Launcher-Setup.exe"
const REQUEST_TIMEOUT = 60000
const CHECK_COOLDOWN = 30 * 1000

// GitHub zwraca 304 dla zapytań z pasującym ETagiem, a takie odpowiedzi
// nie liczą się do limitu API. Dzięki temu można sprawdzać częściej.
let latestReleaseETag = null

const parseVersion = raw => String(raw || "").trim().replace(/^v/i, "").split(".").map(part => parseInt(part, 10) || 0)

const isNewer = (latest, current) => {
  const latestParts = parseVersion(latest)
  const currentParts = parseVersion(current)
  const length = Math.max(latestParts.length, currentParts.length)

  for (let index = 0; index < length; index += 1) {
    const latestPart = latestParts[index] || 0
    const currentPart = currentParts[index] || 0

    if (latestPart !== currentPart) {
      return latestPart > currentPart
    }
  }

  return false
}

// Używamy sieci Electrona (Chromium), bo Node 12 w Electronie 8 nie mieści
// długich nagłówków przekierowania plików z GitHuba.
const request = (url, {headers = {}, timeout = REQUEST_TIMEOUT, allowNotModified = false} = {}) => new Promise((resolve, reject) => {
  const clientRequest = net.request({method: "GET", url, redirect: "follow"})

  Object.keys(headers).forEach(name => clientRequest.setHeader(name, headers[name]))

  const timer = setTimeout(() => {
    clientRequest.abort()
    reject(new Error("Przekroczono czas połączenia z GitHubem."))
  }, timeout)

  clientRequest.on("response", response => {
    clearTimeout(timer)

    if (allowNotModified && response.statusCode === 304) {
      response.resume()
      resolve(response)
      return
    }

    if (response.statusCode !== 200) {
      response.resume()
      reject(new Error(`GitHub odpowiedział HTTP ${response.statusCode}`))
      return
    }

    resolve(response)
  })

  clientRequest.on("error", error => {
    clearTimeout(timer)
    reject(error)
  })

  clientRequest.end()
})

const headerValue = value => (Array.isArray(value) ? value[0] : value)

const readBody = response => new Promise((resolve, reject) => {
  const chunks = []

  response.on("data", chunk => chunks.push(chunk))
  response.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
  response.on("error", reject)
})

const fetchLatestRelease = async () => {
  const headers = {
    "User-Agent": "HexPlay-Launcher",
    Accept: "application/vnd.github+json"
  }

  if (latestReleaseETag) {
    headers["If-None-Match"] = latestReleaseETag
  }

  const response = await request(RELEASES_URL, {headers, allowNotModified: true})

  if (response.statusCode === 304) {
    return null
  }

  latestReleaseETag = headerValue(response.headers.etag) || latestReleaseETag

  const release = JSON.parse(await readBody(response))

  if (!release || release.draft || release.prerelease) {
    return null
  }

  const asset = (release.assets || []).find(item => item.name === INSTALLER_NAME)

  if (!asset) {
    return null
  }

  return {
    version: String(release.tag_name || "").replace(/^v/i, ""),
    url: asset.browser_download_url,
    size: asset.size,
    digest: asset.digest || null
  }
}

const sha256 = filePath => new Promise((resolve, reject) => {
  const hash = crypto.createHash("sha256")
  const stream = fs.createReadStream(filePath)

  stream.on("data", chunk => hash.update(chunk))
  stream.on("end", () => resolve(`sha256:${hash.digest("hex")}`))
  stream.on("error", reject)
})

const downloadInstaller = async (asset, destination, onProgress) => {
  const response = await request(asset.url, {
    headers: {
      "User-Agent": "HexPlay-Launcher",
      Accept: "application/octet-stream"
    }
  })
  const total = Number(headerValue(response.headers["content-length"])) || asset.size || 0
  const temporaryPath = `${destination}.part`

  await fs.promises.mkdir(path.dirname(destination), {recursive: true})

  try {
    await new Promise((resolve, reject) => {
      const stream = fs.createWriteStream(temporaryPath)
      let received = 0

      response.on("data", chunk => {
        received += chunk.length
        onProgress(received, total)
      })

      response.on("error", reject)
      stream.on("error", reject)
      stream.on("finish", () => stream.close(resolve))
      response.pipe(stream)
    })
  } catch (error) {
    if (fs.existsSync(temporaryPath)) {
      fs.unlinkSync(temporaryPath)
    }
    throw error
  }

  const downloadedSize = fs.statSync(temporaryPath).size

  if (asset.size && downloadedSize !== asset.size) {
    fs.unlinkSync(temporaryPath)
    throw new Error(`Niekompletny plik aktualizacji (${downloadedSize} z ${asset.size} bajtów).`)
  }

  if (asset.digest && asset.digest.startsWith("sha256:")) {
    const actualDigest = await sha256(temporaryPath)

    if (actualDigest !== asset.digest) {
      fs.unlinkSync(temporaryPath)
      throw new Error("Suma kontrolna pobranej aktualizacji jest nieprawidłowa.")
    }
  }

  if (fs.existsSync(destination)) {
    fs.unlinkSync(destination)
  }

  fs.renameSync(temporaryPath, destination)
}

export default class GithubUpdater {
  constructor({onStatus}) {
    this.onStatus = onStatus
    this.checking = false
    this.downloaded = null
    this.lastCheck = 0
  }

  isReady() {
    return this.downloaded !== null
  }

  installerPath() {
    return this.downloaded && this.downloaded.path
  }

  async check(force = false) {
    if (this.checking || this.downloaded) {
      return
    }

    if (!force && Date.now() - this.lastCheck < CHECK_COOLDOWN) {
      return
    }

    this.checking = true
    this.lastCheck = Date.now()

    try {
      await this.runCheck()
    } catch (error) {
      // Brak internetu albo limit GitHub API nie może blokować launchera.
      log.warn("Update check failed: ", error.message)
    } finally {
      this.checking = false
    }
  }

  async runCheck() {
    const release = await fetchLatestRelease()

    if (!release || !release.version) {
      return
    }

    if (!isNewer(release.version, app.getVersion())) {
      return
    }

    const destination = path.join(
      app.getPath("userData"),
      "updates",
      `HexPlay-Launcher-Setup-${release.version}.exe`
    )

    if (fs.existsSync(destination) && fs.statSync(destination).size === release.size) {
      this.setDownloaded(release.version, destination)
      return
    }

    this.onStatus(
      "update_available",
      `Dostępna nowa wersja ${release.version}: pobieranie…`,
      {version: release.version}
    )

    await downloadInstaller(release, destination, (received, total) => {
      const percent = total > 0 ? Math.round((received / total) * 100) : 0

      this.onStatus(
        "update_progress",
        `Pobieranie aktualizacji (${percent}%)`,
        {percent}
      )
    })

    this.setDownloaded(release.version, destination)
  }

  setDownloaded(version, installerPath) {
    this.downloaded = {version, path: installerPath}
    this.onStatus(
      "update_downloaded",
      `Nowa wersja ${version} gotowa. FiveM zostanie zamknięty`,
      {version}
    )
  }
}
