import React from "react"
import {connect} from "react-redux"
import SVG from "react-inlinesvg"

import {setNewsActive} from "../../store/news/news.actions"

import newsControlStyle from "./NewsControl.module.scss"

const NewsControl = ({newsActive, setNewsActiveAction}) => {
  return (
    <div
      className={`${newsControlStyle.action} ${newsActive && newsControlStyle.active}`}
      title="Aktualności"
      onClick={() => setNewsActiveAction(!newsActive)}
    >
      <SVG src="assets/icons/miscellaneous/news.svg" />
    </div>
  )
}

const mapStateToProps = (state) => ({
  newsActive: state.news.active
})

const mapDispatchToProps = {
  setNewsActiveAction: setNewsActive
}

export default connect(mapStateToProps, mapDispatchToProps)(NewsControl)
