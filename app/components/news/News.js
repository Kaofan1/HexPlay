import React, {Fragment} from "react"
import {connect} from "react-redux"

import {setNewsActive} from "../../store/news/news.actions"
import changelog from "../../configuration/changelog.json"

import Button from "../button/Button"

import newsStyle from "./News.module.scss"

const GROUPS = [
  {key: "added", label: "Dodane", className: newsStyle.added},
  {key: "changed", label: "Zmienione", className: newsStyle.changed},
  {key: "fixed", label: "Naprawione", className: newsStyle.fixed},
  {key: "removed", label: "Usunięte", className: newsStyle.removed}
]

const formatDate = (value) => {
  const [year, month, day] = String(value || "").split("-")

  if (!year || !month || !day) {
    return ""
  }

  return `${day}.${month}.${year}`
}

const News = ({setNewsActiveAction}) => {
  const onClose = (e) => {
    e.preventDefault()
    setNewsActiveAction(false)
  }

  return (
    <Fragment>
      <div className={newsStyle.intro}>
        <h2>Aktualności</h2>
        <p>Co się zmieniło w launcherze, wersja po wersji.</p>
      </div>
      {changelog.map((entry) => {
        const groups = GROUPS.filter(
          (group) => entry[group.key] && entry[group.key].length > 0
        )

        return (
          <article key={entry.version} className={newsStyle.release}>
            <div className={newsStyle.head}>
              <h3>{`Wersja ${entry.version}`}</h3>
              <span>{formatDate(entry.date)}</span>
            </div>
            {groups.map((group) => (
              <div key={group.key} className={newsStyle.group}>
                <div className={`${newsStyle.label} ${group.className}`}>
                  {group.label}
                </div>
                <ul className={newsStyle.list}>
                  {entry[group.key].map((item, index) => (
                    <li key={`${group.key}-${index}`}>{item}</li>
                  ))}
                </ul>
              </div>
            ))}
            {groups.length === 0 && (
              <div className={newsStyle.empty}>Brak opisanych zmian.</div>
            )}
          </article>
        )
      })}
      <section className={newsStyle.exit}>
        <Button to="/" onClick={onClose} primary>
          <span>Zamknij aktualności</span>
        </Button>
      </section>
    </Fragment>
  )
}

const mapDispatchToProps = {
  setNewsActiveAction: setNewsActive
}

export default connect(null, mapDispatchToProps)(News)
