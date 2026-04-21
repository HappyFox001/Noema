import { execFileSync } from 'node:child_process'

const port = process.env.HER_TEXT_DEV_PORT || '5173'

try {
  const output = execFileSync('lsof', ['-ti', `tcp:${port}`], { encoding: 'utf8' }).trim()
  if (!output) {
    process.exit(0)
  }

  const pids = output
    .split('\n')
    .map(line => Number(line.trim()))
    .filter(pid => Number.isInteger(pid) && pid > 0 && pid !== process.pid)

  for (const pid of pids) {
    process.kill(pid, 'SIGTERM')
  }

  if (pids.length > 0) {
    console.log(`[ensure-dev-port] released port ${port} from PID(s): ${pids.join(', ')}`)
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('Command failed')) {
    process.exit(0)
  }
  throw error
}
