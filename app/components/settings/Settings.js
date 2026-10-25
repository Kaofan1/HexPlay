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

const parseVersion = (raw) =>
  String(raw || "")
    .replace(/^v/i, "")
    .split(".")
    .map((part) => parseInt(part, 10) || 0)

const isNewerVersion = (latest, current) => {
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

const formatDateTime = (timestamp) =>
  new Date(timestamp).toLocaleString("pl-PL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  })

const Settings = ({
  fivemLocation,
  fivemInvalid,
  animatedBackground,
  setFivemLocationAction,
  setAnimatedBackgroundAction,
  setSettingsActiveAction
}) => {
  const fivemField = useRef();
  const requestRef = useRef(0)
  const clearActiveRef = useRef(false)
  const [installInfo, setInstallInfo] = useState(null)
  const [installBusy, setInstallBusy] = useState(false)
  const [cacheSize, setCacheSize] = useState({state: "idle", bytes: 0, complete: true})
  const [running, setRunning] = useState(false)
  const [cacheBusy, setCacheBusy] = useState(false)
  const [cacheMessage, setCacheMessage] = useState("")
  const [confirmClear, setConfirmClear] = useState(false)
  const [updateState, setUpdateState] = useState(null)
  const [updateBusy, setUpdateBusy] = useState(false)

  // Sprawdzenie instalacji jest szybkie, a rozmiar cache liczy się
  // osobno w tle, żeby otwarcie ustawień nie zamrażało okna.
  const refreshInstall = async (force = false) => {
    const requestId = requestRef.current + 1
    requestRef.current = requestId

    setInstallBusy(true)

    try {
      const info = await ipcRenderer.invoke("fivem:inspect", fivemLocation)

      if (requestRef.current !== requestId) {
        return
      }

      setInstallInfo(info)
      setInstallBusy(false)

      if (!info.found) {
        setCacheSize({state: "idle", bytes: 0, complete: true})
        setRunning(false)
        return
      }

      setCacheSize((current) => ({...current, state: "loading"}))

      const sizePromise = ipcRenderer
        .invoke("fivem:cache-size", {exePath: fivemLocation, force})
        .then((size) => {
          if (requestRef.current !== requestId || !size || size.cancelled) {
            return
          }

          if (!size.ok) {
            setCacheSize({state: "idle", bytes: 0, complete: true})
            return
          }

          setCacheSize({state: "ready", bytes: size.bytes, complete: size.complete})
        })
        .catch(() => {
          if (requestRef.current === requestId) {
            setCacheSize({state: "idle", bytes: 0, complete: true})
          }
        })

      await sizePromise

      // Sprawdzanie procesów uruchamia tasklist, więc robimy je dopiero
      // po zmierzeniu cache, żeby nie obciążać dysku i procesora naraz.
      try {
        const isRunning = await ipcRenderer.invoke("fivem:process-state")

        if (requestRef.current === requestId) {
          setRunning(!!isRunning)
        }
      } catch (error) {
        if (requestRef.current === requestId) {
          setRunning(false)
        }
      }
    } catch (error) {
      if (requestRef.current === requestId) {
        setInstallInfo(null)
        setInstallBusy(false)
      }
    }
  }

  useEffect(() => {
    refreshInstall()
  }, [fivemLocation])

  // Stan auto-aktualizacji jest liczony w procesie głównym, więc pytamy
  // o niego raz przy otwarciu ustawień.
  useEffect(() => {
    let active = true

    ipcRenderer
      .invoke("updater:state")
      .then((state) => {
        if (active) {
          setUpdateState(state)
        }
      })
      .catch(() => {
        if (active) {
          setUpdateState(null)
        }
      })

    return () => {
      active = false
    }
  }, [])

  useEffect(
    () => () => {
      // Starsze odpowiedzi nie mogą już zmieniać stanu po zamknięciu ustawień.
      requestRef.current += 1
    },
    []
  )

  useEffect(() => {
    if (!confirmClear) {
      return undefined
    }

    const timer = setTimeout(() => setConfirmClear(false), 6000)
    return () => clearTimeout(timer)
  }, [confirmClear])

  useEffect(() => {
    const onProgress = (event, data) => {
      // Późne komunikaty nie mogą nadpisać wyniku po zakończeniu czyszczenia.
      if (clearActiveRef.current && data && data.total) {
        setCacheMessage(`Czyszczenie cache: ${data.label} (${data.done}/${data.total})`)
      }
    }

    ipcRenderer.on("fivem-cache-progress", onProgress)

    return () => ipcRenderer.removeListener("fivem-cache-progress", onProgress)
  }, [])

  const onOpenFolderClick = () => {
    ipcRenderer.invoke("fivem:open-folder", fivemLocation)
  }

  const onRefreshClick = () => {
    setCacheMessage("")
    refreshInstall(true)
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
    clearActiveRef.current = true
    setCacheMessage("Zamykanie FiveM i czyszczenie cache…")

    try {
      const result = await ipcRenderer.invoke("fivem:clear-cache", fivemLocation)
      clearActiveRef.current = false

      if (!result.ok) {
        setCacheMessage(
          result.error === "busy"
            ? "Czyszczenie już trwa. Poczekaj na zakończenie."
            : "Nie udało się wyczyścić cache. Sprawdź lokalizację FiveM."
        )
      } else if (result.errors && result.errors.length > 0) {
        setCacheMessage(
          `Usunięto ${formatBytes(result.freedBytes)}, ale części plików nie udało się usunąć.`
        )
      } else if (result.freedBytes > 0) {
        setCacheMessage(`Usunięto ${formatBytes(result.freedBytes)} cache.`)
      } else {
        setCacheMessage("Cache było już puste.")
      }
    } catch (error) {
      clearActiveRef.current = false
      setCacheMessage("Nie udało się wyczyścić cache. Spróbuj ponownie.")
    } finally {
      clearActiveRef.current = false
      setCacheBusy(false)
      refreshInstall(true)
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

  const onCheckUpdatesClick = async () => {
    if (updateBusy) {
      return
    }

    setUpdateBusy(true)

    try {
      const state = await ipcRenderer.invoke("updater:check")

      if (state) {
        setUpdateState(state)
      }
    } catch (error) {
      // Bez połączenia zostaje poprzedni stan razem z informacją o błędzie.
    } finally {
      setUpdateBusy(false)
    }
  }

  const installedVersion = (updateState && updateState.current) || remote.app.getVersion()

  const latestVersionText = () => {
    if (!updateState) {
      return "Sprawdzanie…"
    }

    return updateState.latest || "nieznana"
  }

  const updateHintText = () => {
    if (!updateState) {
      return ""
    }

    if (!updateState.latest) {
      return "Nie udało się odczytać najnowszej wersji z GitHuba."
    }

    if (updateState.readyVersion) {
      return `Wersja ${updateState.readyVersion} jest gotowa do instalacji.`
    }

    if (isNewerVersion(updateState.latest, installedVersion)) {
      return "Dostępna jest nowsza wersja. Launcher pobierze ją automatycznie."
    }

    return "Masz najnowszą wersję."
  }

  const lastCheckText = () => {
    if (updateBusy || !updateState) {
      return "Sprawdzanie…"
    }

    if (!updateState.lastCheckAt) {
      return "jeszcze nie sprawdzono"
    }

    return formatDateTime(updateState.lastCheckAt)
  }

  const cacheText = () => {
    if (cacheSize.state === "loading") {
      return "Cache: liczenie…"
    }

    if (cacheSize.state === "ready") {
      return `Cache: ${cacheSize.complete ? "" : "co najmniej "}${formatBytes(cacheSize.bytes)}`
    }

    return "Cache: nie sprawdzono"
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
            onClick={() => !(installBusy || cacheBusy) && onRefreshClick()}
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
              <div className={settingsStyle.meta}>{cacheText()}</div>
              {running && (
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
            data-disabled={installBusy || cacheBusy}
            onClick={() => !(installBusy || cacheBusy) && onRefreshClick()}
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
            {cacheBusy ? "Czyszczenie…" : confirmClear ? "Potwierdź czyszczenie" : "Wyczyść cache"}
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
      <section name="updates" className={settingsStyle.section}>
        <div className={settingsStyle.title}>
          <h2>Aktualizacje</h2>
        </div>
        <div className={settingsStyle.info}>
          <div className={settingsStyle.infoRow}>
            <span className={settingsStyle.infoLabel}>Zainstalowana wersja</span>
            <span>{installedVersion}</span>
          </div>
          <div className={settingsStyle.infoRow}>
            <span className={settingsStyle.infoLabel}>Najnowsza wersja</span>
            <span>{latestVersionText()}</span>
          </div>
          <div className={settingsStyle.infoRow}>
            <span className={settingsStyle.infoLabel}>Ostatnie sprawdzenie</span>
            <span>{lastCheckText()}</span>
          </div>
          {updateHintText() && (
            <div className={settingsStyle.meta}>
              {updateHintText()}
              {updateState && updateState.error &&
                " Ostatnie sprawdzenie nie powiodło się, launcher spróbuje ponownie."}
            </div>
          )}
          <div
            className={settingsStyle.checkNow}
            data-disabled={updateBusy}
            onClick={() => onCheckUpdatesClick()}
          >
            {updateBusy ? "Sprawdzanie…" : "Sprawdź teraz"}
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
