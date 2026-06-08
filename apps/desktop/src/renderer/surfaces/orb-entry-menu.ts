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
  const control = trigger.closest<HTMLElement>('.orb-entry-control')
  let suppressNextClick = false

  function setVisible(visible: boolean): void {
    control?.classList.toggle('is-open', visible)
    menu.classList.toggle('visible', visible)
    menu.setAttribute('aria-hidden', visible ? 'false' : 'true')
    trigger.setAttribute('aria-expanded', visible ? 'true' : 'false')
  }

  function runAction(action: () => void): void {
    setVisible(false)
    action()
  }

  function runMenuItem(item: HTMLElement): void {
    const action = item.dataset.entryAction
    if (action === 'system') {
      runAction(onOpenSystem)
    }
    if (action === 'chat') {
      runAction(onOpenChat)
    }
  }

  function toggleFromPointer(event: Event): void {
    if (event.type === 'mousedown' && suppressNextClick) {
      event.preventDefault()
      event.stopPropagation()
      return
    }
    event.preventDefault()
    event.stopPropagation()
    suppressNextClick = true
    setVisible(!menu.classList.contains('visible'))
  }

  trigger.addEventListener('pointerdown', toggleFromPointer, { capture: true })
  trigger.addEventListener('mousedown', toggleFromPointer, { capture: true })

  trigger.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    if (suppressNextClick) {
      suppressNextClick = false
      return
    }
    setVisible(!menu.classList.contains('visible'))
  })

  menu.addEventListener('pointerdown', (event) => {
    const target = event.target as HTMLElement | null
    const item = target?.closest<HTMLElement>('[data-entry-action]')
    if (!item) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    suppressNextClick = true
    runMenuItem(item)
  })

  menu.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null
    const item = target?.closest<HTMLElement>('[data-entry-action]')
    if (!item) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    if (suppressNextClick) {
      suppressNextClick = false
      return
    }
    runMenuItem(item)
  })

  document.addEventListener('pointerdown', (event) => {
    const target = event.target as HTMLElement | null
    if (!target?.closest('.orb-entry-control')) {
      setVisible(false)
    }
  })

  return { setVisible }
}
