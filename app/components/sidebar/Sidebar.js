import React, {Fragment} from "react"
import {connect} from "react-redux"

import ServerInfo from "../server-info/ServerInfo"
import Settings from "../settings/Settings"
import News from "../news/News"

const Sidebar = ({selectedServer, serversList, settingsActive, newsActive}) => {
  if (newsActive) {
    return (<News />)
  }

  if (settingsActive) {
    return (<Settings />)
  }

  if (selectedServer) {
    return (<ServerInfo serverId={selectedServer} />)
  } else {
    return (<ServerInfo serverId={serversList[0].id} />)
  }
}

const mapStateToProps = (state) => ({
  selectedServer: state.sidebar.server,
  serversList: state.servers,
  settingsActive: state.settings.active,
  newsActive: state.news.active
})

export default connect(mapStateToProps, null)(Sidebar)
