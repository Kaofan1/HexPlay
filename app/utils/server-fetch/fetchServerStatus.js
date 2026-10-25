import {ipcRenderer} from "electron"

// info.json serwera FiveM nie wysyła nagłówka CORS, więc zapytanie idzie
// przez proces główny. Zwracamy null, gdy serwer nie odpowiada.
const fetchServerStatus = async (address) => {
  try {
    const result = await ipcRenderer.invoke("server:status", {address})

    if (!result || !result.ok || !result.info) {
      return null
    }

    return {
      info: result.info,
      players: Array.isArray(result.players) ? result.players : []
    }
  } catch (error) {
    return null
  }
}

export default fetchServerStatus
