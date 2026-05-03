/**
 * Platform controller factory for local computer use.
 */
import { MacOSComputerController } from './macos-control.mjs'
import { WindowsComputerController } from './windows-control.mjs'
import { LinuxComputerController } from './linux-control.mjs'

export function createLocalComputerController(options) {
  if (process.platform === 'darwin') {
    return new MacOSComputerController(options)
  }
  if (process.platform === 'win32') {
    return new WindowsComputerController(options)
  }
  if (process.platform === 'linux') {
    return new LinuxComputerController(options)
  }

  throw new Error(`computer-use does not support this platform yet: ${process.platform}`)
}
