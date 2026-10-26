// Pilnowanie gry chwilę po dołączeniu do serwera.
//
// Samo wywołanie fivem:// kończy się sukcesem, nawet jeśli klient FiveM
// wysypie się kilka sekund później. Dlatego po udanym dołączeniu sprawdzamy
// listę procesów: najpierw czekamy, aż gra wystartuje, a potem pilnujemy, czy
// nie zniknęła przed końcem okna obserwacji.

export const CRASH_WATCH_WINDOW = 90 * 1000
export const CRASH_WATCH_INTERVAL = 2500
export const CRASH_APPEAR_WINDOW = 30 * 1000

const defaultWait = ms => new Promise(resolve => setTimeout(resolve, ms))

/**
 * @param {Object} options
 * @param {() => Promise<Array|null>} options.probe zwraca listę PID-ów,
 *   a null, gdy stanu nie da się sprawdzić (np. błąd tasklist).
 * @param {() => void} options.onCrash wywoływane, gdy gra zniknęła.
 * @returns {() => void} funkcja zatrzymująca obserwację.
 */
export const watchFivemCrash = ({
  probe,
  onCrash,
  wait = defaultWait,
  now = Date.now,
  watchWindow = CRASH_WATCH_WINDOW,
  appearWindow = CRASH_APPEAR_WINDOW,
  interval = CRASH_WATCH_INTERVAL
} = {}) => {
  let stopped = false

  if (typeof probe !== "function" || typeof onCrash !== "function") {
    return () => {}
  }

  const startedAt = now()

  const loop = async () => {
    let seen = false

    while (!stopped) {
      if (now() - startedAt >= watchWindow) {
        return
      }

      await wait(interval)

      if (stopped) {
        return
      }

      const ids = await probe()

      if (stopped) {
        return
      }

      // Nieznany wynik (np. chwilowa awaria tasklist) nie jest crashem.
      if (!Array.isArray(ids)) {
        continue
      }

      if (ids.length > 0) {
        seen = true
        continue
      }

      if (!seen) {
        // Gra jeszcze się nie pojawiła. Po czasie rozruchu przestajemy czekać,
        // bo join i tak nie zgłosił błędu, więc nie mamy czego pokazywać.
        if (now() - startedAt >= appearWindow) {
          return
        }
        continue
      }

      // Gra była uruchomiona i zniknęła przed końcem okna obserwacji.
      stopped = true
      onCrash()
      return
    }
  }

  loop().catch(() => {})

  return () => {
    stopped = true
  }
}

export default watchFivemCrash
