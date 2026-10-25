import {setSettingsConfig} from "../../utils/settings-storage/settingsStorage"

export const SET_NEWS_ACTIVE = "SET_NEWS_ACTIVE"
export const SET_NEWS_SEEN_VERSION = "SET_NEWS_SEEN_VERSION"

export const setNewsActive = (status) => {
  return {
    type: SET_NEWS_ACTIVE,
    payload: status
  }
}

// Wersja, której wpisy gracz już widział. Zapisujemy ją na dysku, żeby
// kropka przy ikonie nie wracała po restarcie launchera.
export const markNewsSeen = (version) => {
  setSettingsConfig("newsSeenVersion", version)

  return {
    type: SET_NEWS_SEEN_VERSION,
    payload: version
  }
}
