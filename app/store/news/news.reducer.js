import {SET_NEWS_ACTIVE, SET_NEWS_SEEN_VERSION} from "./news.actions"
import {SET_SETTINGS_ACTIVE} from "../settings/settings.actions"

import {getSettingsConfig} from "../../utils/settings-storage/settingsStorage"

const initialState = {
  active: false,
  seenVersion: getSettingsConfig("newsSeenVersion") || null
}

export default function (state = initialState, action) {
  switch (action.type) {
    case SET_NEWS_ACTIVE:
      return {
        ...state,
        active: action.payload
      }
    case SET_NEWS_SEEN_VERSION:
      return {
        ...state,
        seenVersion: action.payload
      }
    case SET_SETTINGS_ACTIVE:
      // Ustawienia i Aktualności zajmują to samo miejsce, więc otwarcie
      // jednego panelu zamyka drugi.
      if (action.payload) {
        return {
          ...state,
          active: false
        }
      }

      return state
    default:
      return state
  }
}
