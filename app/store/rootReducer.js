import {combineReducers} from 'redux'
import {connectRouter} from 'connected-react-router'

import applications from './applications/applications.reducer'
import servers from './servers/servers.reducer'
import sidebar from './sidebar/sidebar.reducer'
import settings from "./settings/settings.reducer"
import news from "./news/news.reducer"

const createRootReducer = history => {
  return combineReducers({
    router: connectRouter(history),
    applications,
    sidebar,
    servers,
    settings,
    news
  })
}

export default createRootReducer
