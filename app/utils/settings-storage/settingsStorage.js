import Store from "electron-store"

const store = new Store();

export const setSettingsConfig = (key, value) => {
  const currentSettings = store.get("settings") || {}

  store.set({
    settings: {
      ...currentSettings,
      [key]: value
    }
  })
}

export const getSettingsConfig = (key) => {
  const storeData = store.get("settings")
  if (typeof storeData == "undefined") {
    return null
  } else {
    return storeData[key]
  }
}
