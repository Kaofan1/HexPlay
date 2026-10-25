import React from "react"
import {connect} from "react-redux"
import SVG from "react-inlinesvg"

import {setNewsActive} from "../../store/news/news.actions"
import changelog from "../../configuration/changelog.json"

import newsControlStyle from "./NewsControl.module.scss"

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

const NewsControl = ({newsActive, seenVersion, setNewsActiveAction}) => {
  const latestVersion = changelog.length > 0 ? changelog[0].version : null
  const unread = !!latestVersion && (!seenVersion || isNewerVersion(latestVersion, seenVersion))

  return (
    <div
      className={`${newsControlStyle.action} ${newsActive && newsControlStyle.active}`}
      title={unread ? "Aktualności: nowe wpisy" : "Aktualności"}
      onClick={() => setNewsActiveAction(!newsActive)}
    >
      <SVG src="assets/icons/miscellaneous/news.svg" />
      {unread && <span className={newsControlStyle.dot} />}
    </div>
  )
}

const mapStateToProps = (state) => ({
  newsActive: state.news.active,
  seenVersion: state.news.seenVersion
})

const mapDispatchToProps = {
  setNewsActiveAction: setNewsActive
}

export default connect(mapStateToProps, mapDispatchToProps)(NewsControl)
