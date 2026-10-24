import {execFile} from "child_process"

/**
 * Zamyka klienta FiveM (launcher + proces gry) przed instalacją aktualizacji.
 *
 * Najpierw wysyła grzeczne zamknięcie (WM_CLOSE), żeby gra zdążyła rozłączyć
 * się z serwerem, a po chwili wymusza zakończenie pozostałych procesów.
 */

const FIVEM_PROCESS_NAME = /^FiveM.*\.exe$/i
const GRACE_PERIOD = 4000

const run = (command, args) => new Promise(resolve => {
  execFile(command, args, {windowsHide: true, maxBuffer: 8 * 1024 * 1024}, (error, stdout) => {
    resolve({error, stdout: stdout || ""})
  })
})

const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

export const listFivemProcessIds = async () => {
  if (process.platform !== "win32") {
    return []
  }

  const {error, stdout} = await run("tasklist", ["/FO", "CSV", "/NH"])

  if (error) {
    return []
  }

  return stdout.split(/\r?\n/).reduce((ids, line) => {
    const match = line.match(/^"([^"]+)","(\d+)"/)

    if (match && FIVEM_PROCESS_NAME.test(match[1])) {
      ids.push(Number(match[2]))
    }

    return ids
  }, [])
}

const closeFivem = async () => {
  const processIds = await listFivemProcessIds()

  if (processIds.length === 0) {
    return false
  }

  await Promise.all(processIds.map(id => run("taskkill", ["/PID", String(id)])))
  await wait(GRACE_PERIOD)

  const remaining = await listFivemProcessIds()

  await Promise.all(remaining.map(id => run("taskkill", ["/F", "/T", "/PID", String(id)])))

  return true
}

export default closeFivem
