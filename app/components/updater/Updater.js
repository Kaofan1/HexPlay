import React, {useEffect, useState} from "react"
import {ipcRenderer} from "electron"

import updaterStyle from "./Updater.module.scss"

const statusToState = (data) => {
  if (data.status === "update_available") {
    return {state: "downloading", message: data.message, percent: 0}
  }

  if (data.status === "update_progress") {
    return {state: "downloading", message: data.message, percent: data.percent || 0}
  }

  if (data.status === "update_downloaded") {
    return {state: "ready", message: data.message, percent: 100}
  }

  if (data.status === "update_installing") {
    return {state: "installing", message: data.message, percent: 100}
  }

  return null
}

const Updater = () => {
  const [update, setUpdate] = useState(null)

  useEffect(() => {
    const onStatus = (event, data) => {
      if (!data || !data.status) {
        return
      }

      const nextUpdate = statusToState(data)

      if (nextUpdate) {
        setUpdate(nextUpdate)
      }
    }

    ipcRenderer.on("status", onStatus)

    return () => ipcRenderer.removeListener("status", onStatus)
  }, [])

  const onInstall = () => {
    ipcRenderer.send("mainprocess_action", {action: "app_restart"})
  }

  if (!update) {
    return null
  }

  const canInstall = update.state === "ready"

  return (
    <div
      className={`${updaterStyle.updater} ${updaterStyle.active} ${canInstall && updaterStyle.restartable}`}
    >
      <div className={updaterStyle.content}>
        <span className={updaterStyle.message}>{update.message}</span>
        {update.state === "downloading" && (
          <div className={updaterStyle.progress}>
            <div
              className={updaterStyle.progressBar}
              style={{width: `${update.percent}%`}}
            />
          </div>
        )}
      </div>
      {canInstall && (
        <div
          className={updaterStyle.action}
          onClick={() => onInstall()}
          title="Zainstaluj aktualizację i uruchom launcher ponownie"
        >
          <i className="material-icon">system_update</i>
          <span>Zainstaluj</span>
        </div>
      )}
    </div>
  )
}

export default Updater
