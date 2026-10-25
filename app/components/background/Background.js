import React, {useState, useEffect} from "react"
import {ipcRenderer} from "electron"
import {connect} from "react-redux"

import Image1 from "../../assets/images/background/image1.jpg"
import Image2 from "../../assets/images/background/image2.jpg"
import Image3 from "../../assets/images/background/image3.jpg"
import Image4 from "../../assets/images/background/image4.jpg"
import Image5 from "../../assets/images/background/image5.jpg"

import style from "./Background.module.scss"

const SLIDE_DURATION = 10

const Background = ({animated}) => {
  const [windowFocused, setWindowFocused] = useState(true)

  useEffect(() => {
    const onStatus = (event, data) => {
      if (data.status === "window_focus") {
        setWindowFocused(true)
      }
      if (data.status === "window_blur") {
        setWindowFocused(false)
      }
    }

    ipcRenderer.on('status', onStatus)

    return () => ipcRenderer.removeListener('status', onStatus)
  }, [])

  // Klipy .webm w tle były zakodowane w VP9, którego dekoder w Electronie 8
  // nie obsługuje poprawnie: obraz dzielił się na pół i miał bloki.
  // Zamiast nich używamy ostrych zdjęć w wysokiej rozdzielczości.
  const backgroundsList = [Image1, Image2, Image3, Image4, Image5]

  // Statyczne tło dla słabszych komputerów: jedno zdjęcie, bez animacji.
  if (!animated) {
    return (
      <ul className={style.background}>
        <li className={`${style.image} ${style.static}`}>
          <img src={Image2} alt="" />
        </li>
      </ul>
    )
  }

  const imageAnimation = "imageAnimation"

  // Każde zdjęcie ma własne okno 10 s: szybkie pojawienie się, pauzę
  // i zniknięcie przed startem następnego. Dwa kadry nigdy nie nachodzą
  // na siebie, więc tło nie robi się mętne.
  const slot = 100 / backgroundsList.length
  const fadeInEnd = 2
  const holdEnd = slot - 3
  const fadeOutEnd = slot - 0.3

  const imageAnimatonKeyframes = `
    @keyframes ${imageAnimation} {
      0% {
        opacity: 0;
      }
      ${fadeInEnd}% {
        opacity: 0.6;
      }
      ${holdEnd}% {
        opacity: 0.6;
      }
      ${fadeOutEnd}% {
        opacity: 0;
      }
      100% {
        opacity: 0;
      }
    }
  `

  return (
    <ul className={`${style.background} ${!windowFocused && style.paused }`}>
      <style>{imageAnimatonKeyframes}</style>
      {backgroundsList.map((file, i) => (
        <li
          key={file}
          className={style.image}
          style={{
            animationName: imageAnimation,
            animationDuration: `${backgroundsList.length * SLIDE_DURATION}s`,
            animationDelay: `${i * SLIDE_DURATION}s`,
            animationTimingFunction: "linear",
            animationIterationCount: "infinite"
          }}
        >
          <img src={file} alt="" />
        </li>
      ))}
    </ul>
  )
}

const mapStateToProps = (state) => ({
  animated: state.settings.animatedBackground
})

export default connect(mapStateToProps)(Background)
