import crypto from "crypto"
import fs from "fs"

// GitHub podaje sumę w formacie "sha256:<64 znaki hex>". Każdą inną wartość
// traktujemy jak brak sumy, żeby nie uznać pliku za sprawdzony na podstawie
// pustego albo błędnego pola z API.
export const normalizeDigest = (value) => {
  const match = /^sha256:([a-f\d]{64})$/i.exec(String(value || "").trim())

  return match ? `sha256:${match[1].toLowerCase()}` : null
}

export const sha256File = (filePath) => new Promise((resolve, reject) => {
  const hash = crypto.createHash("sha256")
  const stream = fs.createReadStream(filePath)

  stream.on("data", chunk => hash.update(chunk))
  stream.on("end", () => resolve(`sha256:${hash.digest("hex")}`))
  stream.on("error", reject)
})

// Zwraca {ok, reason}: missing | size | checksum | unverified | verified.
// "unverified" oznacza, że GitHub nie podał sumy, więc plik sprawdzono tylko
// po rozmiarze. Każdy inny powód jest brakiem ok.
export const verifyInstallerFile = async (filePath, {size, digest} = {}) => {
  if (!filePath || !fs.existsSync(filePath)) {
    return {ok: false, reason: "missing"}
  }

  if (size && fs.statSync(filePath).size !== size) {
    return {ok: false, reason: "size"}
  }

  const expected = normalizeDigest(digest)

  if (!expected) {
    return {ok: true, reason: "unverified"}
  }

  const actual = await sha256File(filePath)

  if (actual !== expected) {
    return {ok: false, reason: "checksum"}
  }

  return {ok: true, reason: "verified"}
}
