import {SET_NEWS_ACTIVE} from "./news.actions"
import {SET_SETTINGS_ACTIVE} from "../settings/settings.actions"

const initialState = {
  active: false
}

export default function (state = initialState, action) {
  switch (action.type) {
    case SET_NEWS_ACTIVE:
      return {
        ...state,
        active: action.payload
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
