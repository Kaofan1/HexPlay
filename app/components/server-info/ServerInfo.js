import React, {Fragment, useEffect, useState} from "react"
import {ipcRenderer} from "electron"
import {connect} from "react-redux"
import {Link, useParams} from "react-router-dom"
import SVG from "react-inlinesvg"

import {setServer} from "../../store/sidebar/sidebar.actions"
import {updateServerStatus} from "../../store/servers/servers.actions"
import {setFivemInvalid} from "../../store/settings/settings.actions"

import externalLink from "../../utils/external-link/externalLink"

import Select from "../select/Select"
import Button from "../button/Button"
import PlayerCard from "../player-card/PlayerCard"

import serverInfoStyle from "./ServerInfo.module.scss"

const ServerInfo = ({
  serverId,
  serversList,
  fivemLocation,
  setServerAction,
  updateServerStatusAction,
  setFivemInvalidAction
}) => {
  const server = serversList.find(s => s.id == serverId)

  const {id, address} = server
  const {label} = server.info
  const {teamspeak, tokovoip} = server.applications
  const {online, players_list, players_max} = server.status

  useEffect(() => {
    updateServerStatusAction(server.id)
  }, [serverId])

  const [timer, setTimer] = useState(0)
  const [joining, setJoining] = useState(false)
  const [joinMessage, setJoinMessage] = useState("")

  useEffect(() => {
    updateServerStatusAction(server.id)
    let refreshCooldown = setTimeout(() => {
      setTimer(timer + 1)
    }, 20000)
    return () => clearTimeout(refreshCooldown);
  }, [timer])

  useEffect(() => {
    const onStatus = (event, data) => {
      if (data.status === "fivem_invalid") {
        setFivemInvalidAction(true)
      }
    }

    ipcRenderer.on("status", onStatus)

    return () => ipcRenderer.removeListener("status", onStatus)
  }, [setFivemInvalidAction])

  const onJoinClick = async (e, serverAddress) => {
    e.preventDefault()

    if (joining) {
      return
    }

    setJoining(true)
    setJoinMessage("Uruchamianie FiveM…")

    try {
      const result = await ipcRenderer.invoke("fivem:join", {
        address: serverAddress,
        exePath: fivemLocation
      })

      if (result && result.ok) {
        setJoinMessage("FiveM się uruchamia, za chwilę połączysz się z serwerem.")
      } else if (result && result.error === "invalid_address") {
        setJoinMessage("Adres serwera jest niepoprawny.")
      } else {
        setJoinMessage("")
        setFivemInvalidAction(true)
      }
    } catch (error) {
      setJoinMessage("")
      setFivemInvalidAction(true)
    } finally {
      setJoining(false)
    }
  }

  let players = null
  if (players_list.length > 0) {
    players = players_list.map(player => (
      <div className={serverInfoStyle.player} key={player.id}>
        <PlayerCard playerName={player.name}/>
      </div>
    ))
  }

  return (
    <Fragment>
      {serversList.length > 1 && (
        <section name="servers" className={serverInfoStyle.section}>
          <div className={serverInfoStyle.servers}>
            <Select
              current={{label: label, value: id}}
              onSelect={(v) => setServerAction(v)}
              options={serversList.map(s => ({
                value: s.id,
                label: s.info.label
              }))}
            />
          </div>
        </section>
      )}
      <section name="actions" className={serverInfoStyle.section}>
        <div className={serverInfoStyle.title}>
          <h2>Akcje</h2>
        </div>
        <div className={serverInfoStyle.actions}>
          {address && (
            <div className={serverInfoStyle.action}>
              <Button to="/" onClick={e => onJoinClick(e, address)} primary>
                <SVG src="./assets/icons/applications/fivem.svg" />
                <span>Dołącz do serwera</span>
              </Button>
              {joinMessage && (
                <div className={serverInfoStyle.description}>{joinMessage}</div>
              )}
            </div>
          )}
          {teamspeak && (
            <div className={serverInfoStyle.action}>
              <Button href={`ts3server://${teamspeak}`}>
                <SVG src="assets/icons/applications/teamspeak.svg" />
                <span>Otwórz komunikację</span>
              </Button>
              {tokovoip && (
                <div className={serverInfoStyle.description}>
                  {/* <span className={serverInfoStyle.link} onClick={() => externalLink(`https://github.com/Itokoyamato/TokoVOIP_TS3/releases/tag/v${tokovoip}`)} target="_blank">TokoVOIP v{tokovoip}</span> */}
                  <span className={serverInfoStyle.link} onClick={() => externalLink(`https://github.com/Itokoyamato/TokoVOIP_TS3/releases/download/v${tokovoip}/tokovoip-${tokovoip}.ts3_plugin`)} target="_blank">TokoVOIP v{tokovoip}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </section>
      <section name="players" className={serverInfoStyle.section}>
        <div className={serverInfoStyle.title}>
          <h2>Gracze {players && `(${players.length}/${players_max})`}</h2>
        </div>
        <div className={serverInfoStyle.players}>
          {online ? (players ? players : "Brak graczy online") : "Serwer jest offline"}
        </div>
      </section>
    </Fragment>
  )
}

const mapStateToProps = (state) => ({
  serversList: state.servers,
  fivemLocation: state.settings.fivemLocation
})

const mapDispatchToProps = {
  setServerAction: setServer,
  updateServerStatusAction: updateServerStatus,
  setFivemInvalidAction: setFivemInvalid
}

export default connect(mapStateToProps, mapDispatchToProps)(ServerInfo)
