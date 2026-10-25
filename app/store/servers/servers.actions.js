export const SET_SERVERS = "SET_SERVERS"
export const UPDATE_SERVER = "UPDATE_SERVER"

import fetchServerStatus from "../../utils/server-fetch/fetchServerStatus"

import {setServer} from "../settings/settings.actions"

export const setServers = (data) => {
  return {
    type: SET_SERVERS,
    payload: data
  }
}

export const updateServer = (data) => {
  return {
    type: UPDATE_SERVER,
    id: data.id,
    payload: data
  }
}


export const updateServerStatus = (serverId) => {
  return async (dispatch, getState) => {
    const serversList = getState().servers
    const server = serversList.find(s => s.id === serverId)

    const status = await fetchServerStatus(server.address)

    let serverObject = {}
    if (status && status.info) {
      const vars = status.info.vars || {}

      serverObject = {
        ...server,
        status: {
          ...server.status,
          online: true,
          players_online: status.players.length,
          players_max: vars.sv_maxClients || null,
          players_list: status.players
        }
      }
    } else {
      serverObject = {
        ...server,
        status: {
          ...server.status,
          online: false,
          players_online: null,
          players_max: null,
          players_list: []
        }
      }
    }

    dispatch(updateServer(serverObject))
  }
}

export const updateAllServersStatus = () => {
  return async (dispatch, getState) => {
    const serversList = getState().servers

    for (let s = 0; s < serversList.length; s++) {
      dispatch(updateServerStatus(serversList[s].id))
    }
  }
}
