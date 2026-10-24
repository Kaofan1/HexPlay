import {
  SET_SETTINGS_ACTIVE,
  SET_FIVEM_LOCATION,
  SET_FIVEM_INVALID,
  SET_ANIMATED_BACKGROUND
} from "./settings.actions"

import {getSettingsConfig} from "../../utils/settings-storage/settingsStorage"
import settings from "../../configuration/settings.json"

const initialState = {
  active: false,
  fivemLocation: getSettingsConfig("fivemLocation") || settings.defaultFivemLocation,
  fivemInvalid: false,
  animatedBackground: getSettingsConfig("animatedBackground") !== false
}

export default function (state = initialState, action) {
  switch (action.type) {
    case SET_SETTINGS_ACTIVE:
      return {
        ...state,
        active: action.payload
      }
    case SET_FIVEM_LOCATION:
      return {
        ...state,
        fivemLocation: action.payload,
        fivemInvalid: false
      }
    case SET_ANIMATED_BACKGROUND:
      return {
        ...state,
        animatedBackground: action.payload
      }
    case SET_FIVEM_INVALID:
      if (action.payload) {
        return {
          ...state,
          active: true,
          fivemInvalid: true
        }
      } else {
        return {
          ...state,
          fivemInvalid: false
        }
      }
    default:
      return state
  }
}
