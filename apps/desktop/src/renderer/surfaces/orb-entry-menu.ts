/**
 * Controls the compact orb entry menu on the presence surface.
 */
export interface OrbEntryMenuController {
  setVisible(visible: boolean): void
}

export interface OrbEntryMenuOptions {
  trigger: HTMLButtonElement
  menu: HTMLElement
  onOpenSystem(): void
  onOpenChat(): void
}

export function initializeOrbEntryMenu(options: OrbEntryMenuOptions): OrbEntryMenuController {
  const { trigger, menu, onOpenSystem, onOpenChat } = options

  function setVisible(visible: boolean): void {
    menu.classList.toggle('visible', visible)
    menu.setAttribute('aria-hidden', visible ? 'false' : 'true')
    trigger.setAttribute('aria-expanded', visible ? 'true' : 'false')
  }

  function runAction(action: () => void): void {
    setVisible(false)
    action()
  }

  trigger.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    setVisible(!menu.classList.contains('visible'))
  })

  menu.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null
    const item = target?.closest<HTMLElement>('[data-entry-action]')
    if (!item) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    const action = item.dataset.entryAction
    if (action === 'system') {
      runAction(onOpenSystem)
    }
    if (action === 'chat') {
      runAction(onOpenChat)
    }
  })

  document.addEventListener('pointerdown', (event) => {
    const target = event.target as HTMLElement | null
    if (!target?.closest('#orb-entry-menu') && !target?.closest('#orb-settings-btn')) {
      setVisible(false)
    }
  })

  return { setVisible }
}
