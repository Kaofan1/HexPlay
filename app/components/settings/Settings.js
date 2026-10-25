import React, {Fragment, useEffect, useRef, useState} from "react"
import {ipcRenderer, remote} from "electron"
import {connect} from "react-redux"
import SVG from "react-inlinesvg"

import {setSettingsActive, setFivemLocation, setAnimatedBackground} from "../../store/settings/settings.actions"
import settingsConfig from "../../configuration/settings.json"

import externalLink from "../../utils/external-link/externalLink"

import Button from "../button/Button"

import settingsStyle from "./Settings.module.scss"

const formatBytes = (bytes) => {
  if (!bytes) {
    return "0 B"
  }

  const units = ["B", "KB", "MB", "GB"]
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / Math.pow(1024, index)

  return `${value.toLocaleString("pl-PL", {maximumFractionDigits: index === 0 ? 0 : 1})} ${units[index]}`
}

const Settings = ({
  fivemLocation,
  fivemInvalid,
  animatedBackground,
  setFivemLocationAction,
  setAnimatedBackgroundAction,
  setSettingsActiveAction
}) => {
  const fivemField = useRef();
  const [installInfo, setInstallInfo] = useState(null)
  const [installBusy, setInstallBusy] = useState(false)
  const [cacheBusy, setCacheBusy] = useState(false)
  const [cacheMessage, setCacheMessage] = useState("")
  const [confirmClear, setConfirmClear] = useState(false)

  const refreshInstall = async () => {
    setInstallBusy(true)

    try {
      setInstallInfo(await ipcRenderer.invoke("fivem:inspect", fivemLocation))
    } catch (error) {
      setInstallInfo(null)
    } finally {
      setInstallBusy(false)
    }
  }

  useEffect(() => {
    refreshInstall()
  }, [fivemLocation])

  useEffect(() => {
    if (!confirmClear) {
      return undefined
    }

    const timer = setTimeout(() => setConfirmClear(false), 6000)
    return () => clearTimeout(timer)
  }, [confirmClear])

  const onOpenFolderClick = () => {
    ipcRenderer.invoke("fivem:open-folder", fivemLocation)
  }

  const onClearCacheClick = async () => {
    if (cacheBusy) {
      return
    }

    if (!confirmClear) {
      setConfirmClear(true)
      setCacheMessage("Kliknij ponownie, aby potwierdzić. Launcher zamknie FiveM.")
      return
    }

    setConfirmClear(false)
    setCacheBusy(true)
    setCacheMessage("Zamykanie FiveM i czyszczenie cache…")

    try {
      const result = await ipcRenderer.invoke("fivem:clear-cache", fivemLocation)

      if (!result.ok) {
        setCacheMessage("Nie udało się wyczyścić cache. Sprawdź lokalizację FiveM.")
      } else if (result.errors && result.errors.length > 0) {
        setCacheMessage(
          `Usunięto ${formatBytes(result.freedBytes)}, ale części plików nie udało się usunąć.`
        )
      } else if (result.freedBytes > 0) {
        setCacheMessage(`Usunięto ${formatBytes(result.freedBytes)} cache.`)
      } else {
        setCacheMessage("Cache było już puste.")
      }

      setInstallInfo(await ipcRenderer.invoke("fivem:inspect", fivemLocation))
    } catch (error) {
      setCacheMessage("Nie udało się wyczyścić cache. Spróbuj ponownie.")
    } finally {
      setCacheBusy(false)
    }
  }

  const onFivemClick = () => {
    fivemField.current.click()
  }

  const onFivemSelect = (e) => {
    setFivemLocationAction(e.target.files[0].path)
  }

  const onFivemRestore = () => {
    setFivemLocationAction(settingsConfig.defaultFivemLocation)
  }

  const onSaveClick = (e) => {
    e.preventDefault()
    setSettingsActiveAction(false)
  }

  return (
    <Fragment>
      <section name="fivem-location" className={settingsStyle.section}>
        <div className={settingsStyle.title}>
          <h2>Lokalizacja FiveM</h2>
          <div
            className={settingsStyle.action}
            onClick={() => onFivemRestore()}
          >
            <i className="material-icon">settings_backup_restore</i>
          </div>
        </div>
        <div className={`${settingsStyle.input} ${fivemInvalid && settingsStyle.invalid}`}>
          <div
            className={settingsStyle.field}
            onClick={() => onFivemClick()}
          >
            {fivemLocation}
          </div>
          <input
            ref={fivemField}
            onChange={(e) => onFivemSelect(e)}
            type="file"
            accept=".exe"
            hidden
          />
          <div className={settingsStyle.hint}>
            Wybierz prawidłową lokalizację FiveM.exe
          </div>
        </div>
      </section>
      <section name="fivem-install" className={settingsStyle.section}>
        <div className={settingsStyle.title}>
          <h2>Stan instalacji</h2>
          <div
            className={settingsStyle.action}
            title="Sprawdź ponownie"
            onClick={() => refreshInstall()}
          >
            <i className="material-icon">refresh</i>
          </div>
        </div>
        <div className={settingsStyle.status}>
          {!installInfo && (
            <div className={settingsStyle.meta}>Sprawdzanie instalacji…</div>
          )}
          {installInfo && installInfo.found && (
            <Fragment>
              <div className={settingsStyle.statusOk}>
                <i className="material-icon">check_circle</i>
                <span>FiveM znaleziony</span>
              </div>
              <div className={settingsStyle.meta}>
                {`Cache: ${formatBytes(installInfo.cacheBytes)}`}
              </div>
              {installInfo.running && (
                <div className={settingsStyle.meta}>
                  FiveM jest uruchomiony. Czyszczenie cache go zamknie.
                </div>
              )}
            </Fragment>
          )}
          {installInfo && !installInfo.found && (
            <div className={settingsStyle.statusError}>
              <i className="material-icon">error</i>
              <span>Nie znaleziono FiveM.exe</span>
            </div>
          )}
        </div>
        <div className={settingsStyle.actions}>
          <div
            className={settingsStyle.actionButton}
            data-disabled={installBusy}
            onClick={() => !installBusy && refreshInstall()}
          >
            Sprawdź
          </div>
          <div
            className={settingsStyle.actionButton}
            data-disabled={!installInfo || !installInfo.found}
            onClick={() => installInfo && installInfo.found && onOpenFolderClick()}
          >
            Otwórz folder
          </div>
          <div
            className={`${settingsStyle.actionButton} ${settingsStyle.clearAction}`}
            data-disabled={cacheBusy || !installInfo || !installInfo.found}
            onClick={() => !(cacheBusy || !installInfo || !installInfo.found) && onClearCacheClick()}
          >
            {confirmClear ? "Potwierdź czyszczenie" : "Wyczyść cache"}
          </div>
        </div>
        {cacheMessage && (
          <div className={settingsStyle.message}>{cacheMessage}</div>
        )}
      </section>
      <section name="background" className={settingsStyle.section}>
        <div className={settingsStyle.title}>
          <h2>Animowane tło</h2>
        </div>
        <div
          className={settingsStyle.toggle}
          role="switch"
          aria-checked={animatedBackground}
          tabIndex={0}
          onClick={() => setAnimatedBackgroundAction(!animatedBackground)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault()
              setAnimatedBackgroundAction(!animatedBackground)
            }
          }}
        >
          <div className={settingsStyle.toggleLabel}>
            <span>{animatedBackground ? "Włączone" : "Wyłączone"}</span>
            <small>Wyłącz, aby oszczędzać CPU i GPU na słabszych komputerach.</small>
          </div>
          <div className={`${settingsStyle.switch} ${animatedBackground && settingsStyle.switchOn}`}>
            <div className={settingsStyle.knob} />
          </div>
        </div>
      </section>
      <section name="exit" className={settingsStyle.section}>
        <Button
          to="/"
          onClick={e => onSaveClick(e)}
          primary
        >
          <span>Zamknij ustawienia</span>
        </Button>
      </section>
      <section name="footnotes" className={settingsStyle.section}>
        <div>
          <span>{`Wersja aplikacji: ${remote.app.getVersion()}`}</span>
        </div>
        <div>
          <span
            className={settingsStyle.credits}
            onClick={() => externalLink("https://github.com/bartosjiri")}
          >
            {"Stworzone przez"}
            <SVG src="./assets/icons/miscellaneous/bartosjiri.svg" />
          </span>
        </div>
      </section>
    </Fragment>
  )
}

const mapStateToProps = (state) => ({
  fivemLocation: state.settings.fivemLocation,
  fivemInvalid: state.settings.fivemInvalid,
  animatedBackground: state.settings.animatedBackground
})

const mapDispatchToProps = {
  setSettingsActiveAction: setSettingsActive,
  setFivemLocationAction: setFivemLocation,
  setAnimatedBackgroundAction: setAnimatedBackground
}

export default connect(mapStateToProps, mapDispatchToProps)(Settings)
