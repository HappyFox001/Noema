/**
 * Owns the standalone chat surface interactions and window mode transitions.
 */
export interface ChatPanelController {
  open(): Promise<void>
  close(): void
}

export interface ChatPanelOptions {
  panel: HTMLElement
  closeButton: HTMLButtonElement
  composeForm: HTMLFormElement
  composeInput: HTMLTextAreaElement
  messageList: HTMLElement
  mainView: HTMLElement
  settingsPanel: HTMLElement
  getLanguage(): 'zh-CN' | 'en-US'
  escapeHtml(value: string): string
  waitForNextPaint(): Promise<void>
  enterFullWindowMode(): Promise<void>
  restoreCompactWindowMode(): Promise<void>
  pausePresence(): void
  resumePresence(): void
  onBeforeOpen?(): void
}

export function initializeChatPanel(options: ChatPanelOptions): ChatPanelController {
  let closeAnimationTimer: number | undefined
  let toastTimer: number | undefined
  let carouselSlide = 0
  let fullscreen = false
  let dragging = false
  let lastDragX = 0
  let lastDragY = 0
  const panel = options.panel
  const navItems = Array.from(panel.querySelectorAll<HTMLButtonElement>('[data-chat-nav]'))
  const threads = Array.from(panel.querySelectorAll<HTMLButtonElement>('.chat-thread'))
  const searchInput = panel.querySelector<HTMLInputElement>('.chat-search input')
  const headerAvatar = panel.querySelector<HTMLElement>('.chat-identity .chat-avatar')
  const headerName = panel.querySelector<HTMLElement>('.chat-identity h1')
  const profileTitle = panel.querySelector<HTMLElement>('.chat-config-copy h2')
  const profileCopy = panel.querySelector<HTMLElement>('.chat-config-copy p')
  const portrait = panel.querySelector<HTMLElement>('.chat-config-portrait')
  const carouselDots = Array.from(panel.querySelectorAll<HTMLElement>('[data-chat-action="carousel-dot"]'))
  const videoCard = panel.querySelector<HTMLElement>('.chat-video-card')
  const videoPlayButton = panel.querySelector<HTMLButtonElement>('[data-chat-action="video-play"]')
  const languageMark = panel.querySelector<HTMLElement>('.chat-language-mark')
  const generateButton = panel.querySelector<HTMLButtonElement>('[data-chat-action="generate-image"]')
  const generateLabel = generateButton?.querySelector<HTMLElement>('span')
  const windowCloseButton = panel.querySelector<HTMLButtonElement>('[data-chat-action="window-close"]')
  const windowFullscreenButton = panel.querySelector<HTMLButtonElement>('[data-chat-action="window-fullscreen"]')
  const fullscreenButtons = Array.from(panel.querySelectorAll<HTMLElement>('[data-chat-action="details"], [data-chat-action="window-fullscreen"]'))
  const shell = panel.querySelector<HTMLElement>('.chat-shell')
  const toast = document.createElement('div')

  toast.className = 'chat-status-toast'
  toast.setAttribute('role', 'status')
  panel.appendChild(toast)

  const profileDescriptions: Record<string, string> = {
    'Daphne Spencers': 'College volleyball star Daphne Spencers dreams of going pro... and sneaking into the men’s locker room for an extra workout.',
    'Katarina Sommerfeld': 'Exchange student Katarina keeps her evenings precise, bright, and difficult to read.',
    Darkangel666: 'A late-night regular with a sharp mouth, heavy eyeliner, and very little patience for being ignored.',
    'Simona Rossi': 'Simona messages after midnight, half amused and half convinced she should have gone to sleep.',
    'Diane Robinson': 'Diane notices small details first and asks questions before anyone else thinks to look.',
    'Volleyball Group': 'A fresh group draft for planning clips, calls, and private character chats.',
  }

  function showToast(message: string): void {
    toast.textContent = message
    toast.classList.add('visible')
    if (toastTimer !== undefined) {
      window.clearTimeout(toastTimer)
    }
    toastTimer = window.setTimeout(() => {
      toast.classList.remove('visible')
      toastTimer = undefined
    }, 1500)
  }

  function getAvatarClass(thread: HTMLElement): string {
    const avatar = thread.querySelector<HTMLElement>('.chat-avatar')
    if (!avatar) {
      return 'daphne-avatar'
    }
    return Array.from(avatar.classList)
      .filter((className) => className !== 'chat-avatar')
      .join(' ')
  }

  function setActiveThread(thread: HTMLButtonElement): void {
    threads.forEach((item) => item.classList.toggle('active', item === thread))
    threads.forEach((item) => item.classList.toggle('is-active', item === thread))

    const character = thread.dataset.character || 'Daphne'
    const profile = thread.dataset.profile || `${character} Spencers`
    const avatarClass = getAvatarClass(thread)
    if (headerName) {
      headerName.textContent = character
    }
    if (profileTitle) {
      profileTitle.textContent = profile
    }
    if (profileCopy) {
      profileCopy.textContent = profileDescriptions[profile] || profileDescriptions['Daphne Spencers']
    }
    if (headerAvatar) {
      headerAvatar.className = `chat-avatar large ${avatarClass}`
    }
    showToast(`${profile} selected`)
  }

  function filterThreads(query: string): void {
    const normalized = query.trim().toLowerCase()
    threads.forEach((thread) => {
      const text = `${thread.dataset.profile || ''} ${thread.dataset.preview || ''}`.toLowerCase()
      thread.classList.toggle('is-hidden', Boolean(normalized) && !text.includes(normalized))
    })
  }

  function setActiveNav(button: HTMLButtonElement): void {
    navItems.forEach((item) => item.classList.toggle('active', item === button))
    navItems.forEach((item) => item.classList.toggle('is-active', item === button))
    const label = button.getAttribute('aria-label') || 'Section'
    showToast(`${label} view`)
  }

  function setCarouselSlide(nextSlide: number): void {
    carouselSlide = (nextSlide + carouselDots.length) % Math.max(1, carouselDots.length)
    portrait?.setAttribute('data-slide', String(carouselSlide))
    carouselDots.forEach((dot, index) => {
      dot.classList.toggle('active', index === carouselSlide)
      dot.classList.toggle('is-active', index === carouselSlide)
    })
  }

  function setChatFullscreen(active: boolean): void {
    fullscreen = active
    document.body.classList.toggle('chat-fullscreen', fullscreen)
    fullscreenButtons.forEach((button) => {
      button.classList.toggle('is-active', fullscreen)
      button.setAttribute('aria-label', fullscreen ? 'Exit fullscreen' : 'Toggle fullscreen')
    })
    void window.electronAPI.setChatWindowMode(true, fullscreen).catch((error) => {
      console.warn('[Window] Failed to toggle chat fullscreen mode:', error)
    })
    showToast(fullscreen ? 'Fullscreen chat' : 'Windowed chat')
  }

  function isInteractiveTarget(target: EventTarget | null): boolean {
    return Boolean((target as HTMLElement | null)?.closest(
      'button, input, textarea, select, a, .chat-thread-list, .chat-composer, .chat-config-portrait, .chat-config-copy'
    ))
  }

  function beginManualDrag(event: PointerEvent): void {
    if (event.button !== 0 || fullscreen || isInteractiveTarget(event.target)) {
      return
    }

    dragging = true
    lastDragX = event.screenX
    lastDragY = event.screenY
    event.preventDefault()
  }

  function updateManualDrag(event: PointerEvent): void {
    if (!dragging) {
      return
    }

    const deltaX = Math.round(event.screenX - lastDragX)
    const deltaY = Math.round(event.screenY - lastDragY)
    lastDragX = event.screenX
    lastDragY = event.screenY
    if (deltaX !== 0 || deltaY !== 0) {
      window.electronAPI.moveWindow(deltaX, deltaY)
    }
  }

  function endManualDrag(): void {
    dragging = false
  }

  function appendLocalMessage(text: string, role: 'user' | 'assistant'): void {
    const message = document.createElement('article')
    message.className = `chat-message ${role}`
    const time = new Date().toLocaleTimeString(options.getLanguage() === 'zh-CN' ? 'zh-CN' : 'en-US', {
      hour: '2-digit',
      minute: '2-digit',
    })
    message.innerHTML = `<p>${options.escapeHtml(text)}</p><span>${options.escapeHtml(time)}</span>`
    options.messageList.appendChild(message)
    options.messageList.scrollTop = options.messageList.scrollHeight
  }

  function createGroupThread(): void {
    const existing = panel.querySelector<HTMLButtonElement>('[data-profile="Volleyball Group"]')
    if (existing) {
      setActiveThread(existing)
      return
    }

    const thread = document.createElement('button')
    thread.className = 'chat-thread'
    thread.type = 'button'
    thread.dataset.character = 'Group'
    thread.dataset.profile = 'Volleyball Group'
    thread.dataset.preview = 'Daphne, Katarina, Simona...'
    thread.dataset.time = 'Draft'
    thread.innerHTML = `
      <span class="chat-avatar daphne-avatar"></span>
      <span class="chat-thread-copy">
        <strong>Volleyball Group</strong>
        <span>Daphne, Katarina, Simona...</span>
      </span>
      <time>Draft</time>
    `
    thread.addEventListener('click', () => setActiveThread(thread))
    threads.unshift(thread)
    panel.querySelector('.chat-thread-list')?.prepend(thread)
    setActiveThread(thread)
  }

  function handleAction(action: string, target: HTMLElement): void {
    switch (action) {
      case 'language': {
        const nextLanguage = languageMark?.textContent === 'US' ? 'CN' : 'US'
        if (languageMark) {
          languageMark.textContent = nextLanguage
        }
        showToast(nextLanguage === 'US' ? 'English preview' : 'Chinese preview')
        break
      }
      case 'new-group':
        createGroupThread()
        showToast('Group draft created')
        break
      case 'voice-call':
        target.classList.toggle('is-active')
        showToast(target.classList.contains('is-active') ? 'Voice call ready' : 'Voice call closed')
        break
      case 'more':
        target.classList.toggle('is-active')
        showToast('Conversation actions')
        break
      case 'details':
      case 'window-fullscreen':
        setChatFullscreen(!fullscreen)
        break
      case 'window-close':
        close()
        break
      case 'video-play':
        videoCard?.classList.toggle('is-playing')
        target.setAttribute('aria-label', videoCard?.classList.contains('is-playing') ? 'Pause video' : 'Play video')
        showToast(videoCard?.classList.contains('is-playing') ? 'Video playing' : 'Video paused')
        break
      case 'video-more':
        target.classList.toggle('is-active')
        showToast('Video options')
        break
      case 'suggestion':
        options.composeInput.value = target.dataset.message || 'Send me a video of you'
        options.composeInput.focus()
        options.composeInput.dispatchEvent(new Event('input'))
        break
      case 'attach-image':
      case 'attach-video':
        target.classList.toggle('is-active')
        showToast(action === 'attach-image' ? 'Image attachment selected' : 'Video attachment selected')
        break
      case 'carousel-prev':
        setCarouselSlide(carouselSlide - 1)
        break
      case 'carousel-next':
        setCarouselSlide(carouselSlide + 1)
        break
      case 'carousel-dot':
        setCarouselSlide(Number(target.dataset.slide || 0))
        break
      case 'generate-image':
        if (!generateButton || generateButton.classList.contains('is-loading')) {
          return
        }
        generateButton.classList.add('is-loading')
        if (generateLabel) {
          generateLabel.textContent = 'Generating...'
        }
        showToast('Image request queued')
        window.setTimeout(() => {
          generateButton.classList.remove('is-loading')
          generateButton.classList.add('is-done')
          if (generateLabel) {
            generateLabel.textContent = 'Generate Image'
          }
          showToast('Image preview ready')
          window.setTimeout(() => generateButton.classList.remove('is-done'), 1200)
        }, 900)
        break
      default:
        break
    }
  }

  async function open(): Promise<void> {
    if (closeAnimationTimer !== undefined) {
      window.clearTimeout(closeAnimationTimer)
      closeAnimationTimer = undefined
    }

    options.onBeforeOpen?.()
    document.body.classList.add('window-mode-changing')
    options.pausePresence()
    let windowHiddenForResize = false
    try {
      await window.electronAPI.setWindowOpacity(0.01)
      windowHiddenForResize = true
      await options.enterFullWindowMode()
      document.body.classList.remove('settings-open', 'settings-closing')
      options.settingsPanel.classList.remove('visible', 'warping-in', 'warping-out')
      document.body.classList.add('chat-open')
      document.body.classList.remove('window-mode-changing')
      options.panel.classList.add('visible')
      options.panel.setAttribute('aria-hidden', 'false')
      options.mainView.setAttribute('aria-hidden', 'true')
      await options.waitForNextPaint()
    } finally {
      if (windowHiddenForResize) {
        await window.electronAPI.setWindowOpacity(1).catch((error) => {
          console.warn('[Window] Failed to restore window opacity:', error)
        })
      }
    }

    window.requestAnimationFrame(() => {
      options.messageList.scrollTop = options.messageList.scrollHeight
      options.composeInput.focus()
    })
  }

  function close(): void {
    if (!document.body.classList.contains('chat-open')) {
      return
    }
    fullscreen = false
    document.body.classList.remove('chat-fullscreen')
    fullscreenButtons.forEach((button) => button.classList.remove('is-active'))
    options.panel.classList.remove('visible')
    options.panel.setAttribute('aria-hidden', 'true')
    if (closeAnimationTimer !== undefined) {
      window.clearTimeout(closeAnimationTimer)
    }
    closeAnimationTimer = window.setTimeout(() => {
      void finishClose()
    }, 220)
  }

  async function finishClose(): Promise<void> {
    document.body.classList.add('window-mode-changing')
    try {
      await options.restoreCompactWindowMode()
    } catch (error) {
      console.warn('[Window] Failed to leave chat window mode:', error)
    } finally {
      document.body.classList.remove('chat-open', 'window-mode-changing')
      options.mainView.removeAttribute('aria-hidden')
      options.resumePresence()
      closeAnimationTimer = undefined
    }
  }

  options.closeButton.addEventListener('pointerdown', (event) => {
    event.preventDefault()
    event.stopPropagation()
    close()
  })
  options.closeButton.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    close()
  })

  windowCloseButton?.addEventListener('pointerdown', (event) => {
    event.preventDefault()
    event.stopPropagation()
  })
  windowCloseButton?.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    close()
  })

  windowFullscreenButton?.addEventListener('pointerdown', (event) => {
    event.preventDefault()
    event.stopPropagation()
  })
  windowFullscreenButton?.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    setChatFullscreen(!fullscreen)
  })

  options.composeInput.addEventListener('input', () => {
    options.composeInput.style.height = 'auto'
    options.composeInput.style.height = `${Math.min(options.composeInput.scrollHeight, 120)}px`
  })

  options.composeInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      options.composeForm.requestSubmit()
    }
  })

  options.composeForm.addEventListener('submit', (event) => {
    event.preventDefault()
    const text = options.composeInput.value.trim()
    if (!text) {
      return
    }
    appendLocalMessage(text, 'user')
    options.composeInput.value = ''
    options.composeInput.style.height = 'auto'
  })

  navItems.forEach((button) => {
    button.addEventListener('click', () => setActiveNav(button))
  })

  threads.forEach((thread) => {
    thread.addEventListener('click', () => setActiveThread(thread))
  })

  searchInput?.addEventListener('input', () => {
    filterThreads(searchInput.value)
  })

  panel.addEventListener('click', (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-chat-action]')
    if (!target || !panel.contains(target)) {
      return
    }
    handleAction(target.dataset.chatAction || '', target)
  })

  panel.addEventListener('pointerdown', beginManualDrag)
  window.addEventListener('pointermove', updateManualDrag)
  window.addEventListener('pointerup', endManualDrag)
  window.addEventListener('pointercancel', endManualDrag)

  setCarouselSlide(0)

  return { open, close }
}
