/**
 * Builds the Electron application menu for desktop settings and app commands.
 */
import { Menu, shell, type MenuItemConstructorOptions } from 'electron'

export type AppMenuCommandSender = (command: string, payload?: unknown) => void

function buildSettingsMenuItems(sendCommand: AppMenuCommandSender): MenuItemConstructorOptions[] {
  return [
    {
      label: 'Settings...',
      accelerator: 'CmdOrCtrl+,',
      click: () => sendCommand('open-settings'),
    },
    {
      label: 'Plugins',
      accelerator: 'CmdOrCtrl+Shift+P',
      click: () => sendCommand('open-settings', { section: 'plugins' }),
    },
    {
      label: 'Models',
      accelerator: 'CmdOrCtrl+Shift+M',
      click: () => sendCommand('open-settings', { section: 'models' }),
    },
    {
      label: 'Logs',
      accelerator: 'CmdOrCtrl+Shift+L',
      click: () => sendCommand('open-settings', { section: 'logs' }),
    },
  ]
}

export function buildApplicationMenu(sendCommand: AppMenuCommandSender, appName = 'Noema'): Menu {
  const settingsItems = () => buildSettingsMenuItems(sendCommand)
  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin'
      ? [{
          label: appName,
          submenu: [
            { role: 'about' },
            { type: 'separator' },
            ...settingsItems(),
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' },
          ],
        } satisfies MenuItemConstructorOptions]
      : []),
    {
      label: 'File',
      submenu: [
        ...settingsItems(),
        { type: 'separator' },
        process.platform === 'darwin' ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(process.platform === 'darwin'
          ? [
              { type: 'separator' } satisfies MenuItemConstructorOptions,
              { role: 'front' } satisfies MenuItemConstructorOptions,
            ]
          : [
              { role: 'close' } satisfies MenuItemConstructorOptions,
            ]),
      ],
    },
    {
      role: 'help',
      submenu: [
        {
          label: 'Open Project Website',
          click: () => {
            void shell.openExternal('https://github.com/0xhacker/noema')
          },
        },
      ],
    },
  ]

  return Menu.buildFromTemplate(template)
}
