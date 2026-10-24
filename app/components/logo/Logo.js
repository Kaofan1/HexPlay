import React from "react"

import branding from "../../configuration/branding.json"

import logoStyle from "./Logo.module.scss"

const Logo = () => {
  return (
    <div className={logoStyle.logo}>
      {/* <h1>{branding.name}</h1> */}
      <img src={branding.logo} alt={branding.name} />
    </div>
  )
}

export default Logo
