import React from "react"
import {connect} from "react-redux"
import SVG from "react-inlinesvg"

import Background from "../background/Background"
import Button from "../button/Button"
import Logo from "../logo/Logo"

import branding from "../../configuration/branding.json"

import heroStyle from "./Hero.module.scss"

const Hero = ({applications}) => {
  return (
    <div className={heroStyle.hero}>
        <div className={heroStyle.header}>
          <Logo/>
        </div>
        <div className={heroStyle.main}>
          <h2>{branding.name}</h2>
          <p>{branding.tagline}</p>
        </div>
        <div className={heroStyle.footer}>
            {applications && (
            applications
              .sort((a, b) => ((a.info.priority > b.info.priority) ? 1 : -1))
              .map(app => (
                <Button
                  key={app.id}
                  href={app.url}
                  padding
                  primary
                >
                  {app.info.icon && (<SVG src={`./assets/icons/applications/${app.info.icon}`} />)}
                  {app.info.label && (<span>{app.info.label}</span>)}
                </Button>
              ))
          )}
        </div>
      <Background/>
    </div>
  )
}

const mapStateToProps = (state) => ({
  applications: state.applications
})

export default connect(mapStateToProps)(Hero)
