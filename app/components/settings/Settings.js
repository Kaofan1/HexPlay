import React, {Fragment, useRef} from "react"
import {remote} from "electron"
import {connect} from "react-redux"
import SVG from "react-inlinesvg"

import {setSettingsActive, setFivemLocation, setAnimatedBackground} from "../../store/settings/settings.actions"
import settingsConfig from "../../configuration/settings.json"

import externalLink from "../../utils/external-link/externalLink"

import Button from "../button/Button"

import settingsStyle from "./Settings.module.scss"

const Settings = ({
  fivemLocation,
  fivemInvalid,
  animatedBackground,
  setFivemLocationAction,
  setAnimatedBackgroundAction,
  setSettingsActiveAction
}) => {
  const fivemField = useRef();

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
