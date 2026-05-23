/**
 * Renderer-owned Realtime Work Surface view.
 *
 * Converts constrained work surface snapshots into application-styled DOM
 * without accepting raw HTML, script, or model-owned markup.
 */
type WorkSurfaceViewOptions = {
  setTaskPanelVisible: (visible: boolean) => void
}

type TableState = {
  sortColumnId?: string
  sortDirection: 'asc' | 'desc'
  filterText: string
  page: number
}

const MAX_RENDERED_ROWS = 80

export class WorkSurfaceView {
  private enabled = false
  private snapshot: any | null = null
  private snapshots = new Map<string, any>()
  private activeSurfaceId: string | null = null
  private draggedComponentId: string | null = null
  private componentOrder = new Map<string, string[]>()
  private tableState = new Map<string, TableState>()

  constructor(
    private readonly root: HTMLElement,
    private readonly options: WorkSurfaceViewOptions
  ) {}

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    document.body.classList.toggle('work-surface-enabled', enabled)
    this.root.hidden = !enabled || !this.snapshot
    if (!enabled) {
      this.snapshot = null
      this.snapshots.clear()
      this.activeSurfaceId = null
      this.root.textContent = ''
      this.tableState.clear()
    }
  }

  close(): void {
    this.snapshot = null
    this.snapshots.clear()
    this.activeSurfaceId = null
    this.root.hidden = true
    this.root.textContent = ''
    this.tableState.clear()
  }

  renderSnapshot(snapshot: any): void {
    if (!this.enabled || !snapshot) {
      return
    }
    this.snapshots.set(snapshot.surfaceId, snapshot)
    this.activeSurfaceId = this.activeSurfaceId && this.snapshots.has(this.activeSurfaceId)
      ? this.activeSurfaceId
      : snapshot.surfaceId
    snapshot = this.snapshots.get(this.activeSurfaceId) ?? snapshot
    this.snapshot = snapshot
    this.root.hidden = false
    this.root.textContent = ''

    const header = document.createElement('div')
    header.className = 'work-surface-header'
    const title = document.createElement('div')
    title.className = 'work-surface-title'
    title.textContent = snapshot.title || 'Work Surface'
    const mode = document.createElement('div')
    mode.className = 'work-surface-mode'
    mode.textContent = snapshot.mode || 'task'
    header.append(title, mode)
    if (this.snapshots.size > 1) {
      const tabs = document.createElement('div')
      tabs.className = 'work-surface-tabs'
      for (const item of this.snapshots.values()) {
        const tab = document.createElement('button')
        tab.type = 'button'
        tab.className = 'work-surface-tab'
        tab.classList.toggle('active', item.surfaceId === this.activeSurfaceId)
        tab.textContent = item.title || item.surfaceId
        tab.addEventListener('click', () => {
          this.activeSurfaceId = item.surfaceId
          this.renderSnapshot(item)
        })
        tabs.appendChild(tab)
      }
      header.appendChild(tabs)
    }

    const body = document.createElement('div')
    body.className = 'work-surface-body'
    const components = this.orderComponents(snapshot)
    if (components.length === 0) {
      body.appendChild(this.renderEmpty('No work surface components yet.'))
    }
    for (const component of components) {
      try {
        body.appendChild(this.renderComponent(component))
      } catch (error: any) {
        body.appendChild(this.renderError(component?.id, error?.message || String(error)))
      }
    }

    this.root.append(header, body)
    this.root.classList.toggle('readonly', Boolean(snapshot.closedAt))
    this.options.setTaskPanelVisible(true)
  }

  private renderComponent(component: any): HTMLElement {
    const node = document.createElement('section')
    node.className = `work-surface-component ${component.kind || 'unknown'}`
    node.classList.toggle('focused', this.snapshot?.focusedId === component.id)
    node.classList.toggle('loading', component.loading === true)
    node.dataset.componentId = component.id
    node.tabIndex = 0
    node.draggable = true
    node.addEventListener('dragstart', (event) => {
      this.draggedComponentId = component.id
      event.dataTransfer?.setData('text/plain', component.id)
    })
    node.addEventListener('dragover', (event) => {
      event.preventDefault()
    })
    node.addEventListener('drop', (event) => {
      event.preventDefault()
      this.reorderComponent(component.id)
    })

    if (component.title) {
      const title = document.createElement('div')
      title.className = 'work-surface-component-title'
      title.textContent = component.title
      node.appendChild(title)
    }

    if (component.kind === 'status') {
      node.appendChild(this.renderText(component.label, component.detail))
    } else if (component.kind === 'taskPlan') {
      node.appendChild(this.renderTaskPlan(component))
    } else if (component.kind === 'markdown') {
      node.appendChild(this.renderMarkdown(component.markdown ?? ''))
    } else if (component.kind === 'table') {
      node.appendChild(this.renderTable(component))
    } else if (component.kind === 'artifacts') {
      node.appendChild(this.renderArtifacts(component))
    } else if (component.kind === 'actions') {
      node.appendChild(this.renderActions(component))
    } else if (component.kind === 'form') {
      node.appendChild(this.renderForm(component))
    } else if (component.kind === 'chart') {
      node.appendChild(this.renderChart(component))
    } else if (component.kind === 'timeline') {
      node.appendChild(this.renderTimeline(component))
    } else if (component.kind === 'inspector') {
      node.appendChild(this.renderInspector(component))
    } else {
      node.appendChild(this.renderText(component.prompt ?? JSON.stringify(component, null, 2)))
    }

    node.addEventListener('click', () => {
      void window.electronAPI.sendWorkSurfaceEvent({
        type: 'surface.select',
        surfaceId: this.snapshot?.surfaceId,
        targetId: component.id,
        selectedIds: [component.id],
        bindings: component.bindings ?? [],
      })
    })
    return node
  }

  private orderComponents(snapshot: any): any[] {
    const components = Object.values(snapshot.components ?? {}) as any[]
    const order = this.componentOrder.get(snapshot.surfaceId)
    if (!order) {
      return components
    }
    return components.sort((left, right) => {
      const leftIndex = order.indexOf(left.id)
      const rightIndex = order.indexOf(right.id)
      return (leftIndex < 0 ? Number.MAX_SAFE_INTEGER : leftIndex) - (rightIndex < 0 ? Number.MAX_SAFE_INTEGER : rightIndex)
    })
  }

  private reorderComponent(targetId: string): void {
    if (!this.snapshot?.surfaceId || !this.draggedComponentId || this.draggedComponentId === targetId) {
      return
    }
    const current = this.orderComponents(this.snapshot).map(component => component.id)
    const from = current.indexOf(this.draggedComponentId)
    const to = current.indexOf(targetId)
    if (from < 0 || to < 0) {
      return
    }
    current.splice(to, 0, ...current.splice(from, 1))
    this.componentOrder.set(this.snapshot.surfaceId, current)
    this.draggedComponentId = null
    this.renderSnapshot(this.snapshot)
  }

  private renderEmpty(message: string): HTMLElement {
    const node = document.createElement('div')
    node.className = 'work-surface-empty'
    node.textContent = message
    return node
  }

  private renderError(componentId: string | undefined, message: string): HTMLElement {
    const node = document.createElement('div')
    node.className = 'work-surface-component error'
    node.textContent = componentId
      ? `Component ${componentId} failed: ${message}`
      : `Component failed: ${message}`
    return node
  }

  private renderText(primary: string, secondary?: string): HTMLElement {
    const wrapper = document.createElement('div')
    wrapper.className = 'work-surface'
    const main = document.createElement('div')
    main.textContent = primary || ''
    wrapper.appendChild(main)
    if (secondary) {
      const detail = document.createElement('div')
      detail.className = 'work-surface-muted'
      detail.textContent = secondary
      wrapper.appendChild(detail)
    }
    return wrapper
  }

  private renderMarkdown(markdown: string): HTMLElement {
    const wrapper = document.createElement('div')
    wrapper.className = 'work-surface-markdown'
    const parts = String(markdown).split(/(```[\s\S]*?```)/g)
    for (const part of parts) {
      const fence = part.match(/^```([a-zA-Z0-9_-]+)?\n?([\s\S]*?)```$/)
      if (fence) {
        const pre = document.createElement('pre')
        const code = document.createElement('code')
        code.dataset.language = fence[1] || ''
        code.textContent = fence[2].replace(/\n$/, '')
        pre.appendChild(code)
        wrapper.appendChild(pre)
        continue
      }
      for (const line of part.split('\n')) {
        const block = document.createElement(line.trim().startsWith('- ') ? 'li' : 'p')
        block.textContent = line.trim().startsWith('- ') ? line.trim().slice(2) : line
        if (block.textContent.trim()) {
          wrapper.appendChild(block)
        }
      }
    }
    return wrapper
  }

  private renderTaskPlan(component: any): HTMLElement {
    const list = document.createElement('ol')
    list.className = 'work-surface-plan'
    for (const step of component.plan?.steps ?? []) {
      const item = document.createElement('li')
      item.className = `work-surface-plan-step ${step.status || 'pending'}`
      item.textContent = step.error
        ? `${step.title || step.id}: ${step.error}`
        : step.title || step.description || step.id
      list.appendChild(item)
    }
    return list
  }

  private renderTable(component: any): HTMLElement {
    const wrapper = document.createElement('div')
    wrapper.className = 'work-surface-table-wrap'
    const state = this.getTableState(component)
    const rows = this.prepareTableRows(component, state)
    const pageSize = Math.max(1, Math.min(Number(component.pageSize ?? 30), MAX_RENDERED_ROWS))
    const pageCount = Math.max(1, Math.ceil(rows.length / pageSize))
    state.page = Math.min(state.page, pageCount - 1)
    const visibleRows = rows.slice(state.page * pageSize, (state.page + 1) * pageSize)

    const toolbar = document.createElement('div')
    toolbar.className = 'work-surface-table-toolbar'
    const filter = document.createElement('input')
    filter.type = 'search'
    filter.placeholder = 'Filter'
    filter.value = state.filterText
    filter.addEventListener('input', () => {
      state.filterText = filter.value
      state.page = 0
      this.renderSnapshot(this.snapshot)
    })
    toolbar.appendChild(filter)
    if (rows.length > pageSize || component.rows?.length > MAX_RENDERED_ROWS) {
      const page = document.createElement('span')
      page.className = 'work-surface-muted'
      page.textContent = `${state.page + 1}/${pageCount} · ${rows.length} rows`
      toolbar.appendChild(page)
    }
    wrapper.appendChild(toolbar)

    const table = document.createElement('table')
    table.className = 'work-surface-table'
    const head = document.createElement('thead')
    const headRow = document.createElement('tr')
    for (const column of component.columns ?? []) {
      const cell = document.createElement('th')
      if (column.sortable !== false) {
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'work-surface-sort'
        button.textContent = column.label || column.id
        if (state.sortColumnId === column.id) {
          button.textContent += state.sortDirection === 'asc' ? ' ↑' : ' ↓'
        }
        button.addEventListener('click', () => {
          state.sortDirection = state.sortColumnId === column.id && state.sortDirection === 'asc' ? 'desc' : 'asc'
          state.sortColumnId = column.id
          state.page = 0
          this.renderSnapshot(this.snapshot)
        })
        cell.appendChild(button)
      } else {
        cell.textContent = column.label || column.id
      }
      headRow.appendChild(cell)
    }
    if ((component.rows ?? []).some((row: any) => row.actions?.length)) {
      const actionHead = document.createElement('th')
      actionHead.textContent = ''
      headRow.appendChild(actionHead)
    }
    head.appendChild(headRow)

    const body = document.createElement('tbody')
    for (const row of visibleRows) {
      const tableRow = document.createElement('tr')
      tableRow.dataset.componentId = row.id
      tableRow.addEventListener('click', (event) => {
        event.stopPropagation()
        void window.electronAPI.sendWorkSurfaceEvent({
          type: 'surface.select',
          surfaceId: this.snapshot?.surfaceId,
          targetId: row.id,
          selectedIds: [row.id],
          bindings: row.bindings ?? component.bindings ?? [],
        })
      })
      for (const column of component.columns ?? []) {
        const cell = document.createElement('td')
        cell.textContent = String(row.cells?.[column.id] ?? '')
        tableRow.appendChild(cell)
      }
      if (row.actions?.length) {
        const actionCell = document.createElement('td')
        actionCell.className = 'work-surface-row-actions'
        actionCell.appendChild(this.renderActions({ actions: row.actions, targetId: row.id, bindings: row.bindings ?? [] }))
        tableRow.appendChild(actionCell)
      }
      body.appendChild(tableRow)
    }
    table.append(head, body)
    wrapper.appendChild(table)

    if (pageCount > 1) {
      const pager = document.createElement('div')
      pager.className = 'work-surface-table-pager'
      pager.append(
        this.renderPagerButton('Prev', state.page <= 0, () => {
          state.page -= 1
          this.renderSnapshot(this.snapshot)
        }),
        this.renderPagerButton('Next', state.page >= pageCount - 1, () => {
          state.page += 1
          this.renderSnapshot(this.snapshot)
        })
      )
      wrapper.appendChild(pager)
    }
    return wrapper
  }

  private getTableState(component: any): TableState {
    const id = component.id || 'table'
    let state = this.tableState.get(id)
    if (!state) {
      state = {
        sortColumnId: component.sort?.columnId,
        sortDirection: component.sort?.direction === 'desc' ? 'desc' : 'asc',
        filterText: component.filterText || '',
        page: 0,
      }
      this.tableState.set(id, state)
    }
    return state
  }

  private prepareTableRows(component: any, state: TableState): any[] {
    let rows = Array.isArray(component.rows) ? [...component.rows] : []
    if (state.filterText.trim()) {
      const query = state.filterText.trim().toLowerCase()
      rows = rows.filter(row => Object.values(row.cells ?? {}).some(value => String(value ?? '').toLowerCase().includes(query)))
    }
    if (state.sortColumnId) {
      rows.sort((a, b) => compareTableCell(a.cells?.[state.sortColumnId!], b.cells?.[state.sortColumnId!], state.sortDirection))
    }
    return rows.slice(0, Math.max(MAX_RENDERED_ROWS, Number(component.pageSize ?? 30)))
  }

  private renderPagerButton(label: string, disabled: boolean, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'work-surface-action secondary'
    button.disabled = disabled
    button.textContent = label
    button.addEventListener('click', onClick)
    return button
  }

  private renderForm(component: any): HTMLElement {
    const form = document.createElement('form')
    form.className = 'work-surface-form'
    for (const field of component.fields ?? []) {
      const label = document.createElement('label')
      label.className = 'work-surface-field'
      const labelText = document.createElement('span')
      labelText.textContent = field.label || field.id
      const input = this.createInput(field)
      input.name = field.id
      label.append(labelText, input)
      form.appendChild(label)
    }
    const actions = document.createElement('div')
    actions.className = 'work-surface-actions'
    const submit = document.createElement('button')
    submit.className = 'work-surface-action primary'
    submit.type = 'submit'
    submit.textContent = 'Submit'
    actions.appendChild(submit)
    form.appendChild(actions)
    form.addEventListener('submit', (event) => {
      event.preventDefault()
      const formData = new FormData(form)
      const value = Object.fromEntries(formData.entries())
      void window.electronAPI.sendWorkSurfaceEvent({
        type: 'surface.input_submitted',
        surfaceId: this.snapshot?.surfaceId,
        targetId: component.id,
        requestId: component.requestId,
        value,
        bindings: component.bindings ?? [],
      })
    })
    return form
  }

  private createInput(field: any): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
    if (field.kind === 'textarea') {
      const input = document.createElement('textarea')
      input.placeholder = field.placeholder || ''
      input.value = field.value ?? ''
      return input
    }
    if (field.kind === 'select') {
      const input = document.createElement('select')
      for (const option of field.options ?? []) {
        const item = document.createElement('option')
        item.value = option.value
        item.textContent = option.label
        input.appendChild(item)
      }
      return input
    }
    const input = document.createElement('input')
    input.type = field.kind === 'password' ? 'password' : field.kind === 'number' ? 'number' : field.kind === 'checkbox' ? 'checkbox' : 'text'
    input.placeholder = field.placeholder || ''
    if (field.value !== undefined && input.type !== 'checkbox') {
      input.value = String(field.value)
    }
    if (input.type === 'checkbox') {
      input.checked = Boolean(field.value)
    }
    return input
  }

  private renderChart(component: any): HTMLElement {
    const chart = document.createElement('div')
    chart.className = `work-surface-chart ${component.chart?.type || 'bar'}`
    const data = Array.isArray(component.chart?.data) ? component.chart.data : []
    if (data.length === 0) {
      chart.appendChild(this.renderText('No data'))
      return chart
    }
    if (component.chart?.type === 'pie') {
      chart.style.setProperty('--work-surface-pie', buildPieGradient(data, component.chart?.yKey || 'value'))
      chart.classList.add('pie-rendered')
      return chart
    }
    if (component.chart?.type === 'scatter') {
      return this.renderScatterChart(chart, data, component.chart)
    }
    const values = data.map((item: any) => Number(item[component.chart?.yKey || 'value'] ?? item.value ?? 0))
    const max = Math.max(1, ...values.map(Math.abs))
    values.slice(0, 40).forEach((value, index) => {
      const bar = document.createElement('div')
      bar.className = 'work-surface-chart-bar'
      bar.style.height = `${Math.max(4, Math.round(Math.abs(value) / max * 80))}%`
      if (component.chart?.type === 'line') {
        bar.style.width = '2px'
      }
      bar.title = `${index}: ${value}`
      chart.appendChild(bar)
    })
    return chart
  }

  private renderScatterChart(chart: HTMLElement, data: any[], spec: any): HTMLElement {
    chart.classList.add('scatter-rendered')
    const xValues = data.map(item => Number(item[spec?.xKey || 'x'] ?? 0))
    const yValues = data.map(item => Number(item[spec?.yKey || 'y'] ?? item.value ?? 0))
    const maxX = Math.max(1, ...xValues.map(Math.abs))
    const maxY = Math.max(1, ...yValues.map(Math.abs))
    data.slice(0, 80).forEach((item, index) => {
      const dot = document.createElement('span')
      dot.className = 'work-surface-chart-dot'
      dot.style.left = `${Math.min(96, Math.max(0, Number(item[spec?.xKey || 'x'] ?? 0) / maxX * 96))}%`
      dot.style.bottom = `${Math.min(86, Math.max(0, Number(item[spec?.yKey || 'y'] ?? item.value ?? 0) / maxY * 86))}%`
      dot.title = `${index}`
      chart.appendChild(dot)
    })
    return chart
  }

  private renderTimeline(component: any): HTMLElement {
    const list = document.createElement('ol')
    list.className = 'work-surface-timeline'
    for (const item of component.items ?? []) {
      const entry = document.createElement('li')
      entry.className = `work-surface-timeline-item ${item.status || 'pending'}`
      entry.textContent = item.description ? `${item.title}: ${item.description}` : item.title
      list.appendChild(entry)
    }
    return list
  }

  private renderInspector(component: any): HTMLElement {
    const panel = document.createElement('dl')
    panel.className = 'work-surface-inspector'
    for (const property of component.properties ?? []) {
      const term = document.createElement('dt')
      term.textContent = property.label || property.id
      const value = document.createElement('dd')
      value.textContent = typeof property.value === 'string'
        ? property.value
        : JSON.stringify(property.value)
      panel.append(term, value)
    }
    return panel
  }

  private renderArtifacts(component: any): HTMLElement {
    const grid = document.createElement('div')
    grid.className = 'work-surface-artifacts'
    for (const artifact of component.artifacts ?? []) {
      const item = document.createElement('button')
      item.className = 'work-surface-artifact'
      item.type = 'button'
      item.textContent = artifact.diffSummary
        ? `${artifact.title || artifact.id}: ${artifact.diffSummary}`
        : artifact.title || artifact.path || artifact.id
      item.addEventListener('click', (event) => {
        event.stopPropagation()
        void window.electronAPI.sendWorkSurfaceEvent({
          type: 'surface.select',
          surfaceId: this.snapshot?.surfaceId,
          targetId: artifact.id,
          selectedIds: [artifact.id],
          bindings: artifact.bindings ?? component.bindings ?? [],
        })
      })
      grid.appendChild(item)
    }
    return grid
  }

  private renderActions(component: any): HTMLElement {
    const bar = document.createElement('div')
    bar.className = 'work-surface-actions'
    for (const action of component.actions ?? []) {
      const button = document.createElement('button')
      button.className = `work-surface-action ${action.variant || 'secondary'}`
      button.type = 'button'
      button.disabled = Boolean(action.disabled)
      button.textContent = action.label || action.id
      button.addEventListener('click', (event) => {
        event.stopPropagation()
        void window.electronAPI.sendWorkSurfaceEvent({
          type: 'surface.action',
          surfaceId: this.snapshot?.surfaceId,
          actionId: action.id,
          targetId: action.targetId ?? component.targetId,
          bindings: action.bindings ?? component.bindings ?? [],
        })
      })
      bar.appendChild(button)
    }
    return bar
  }
}

function compareTableCell(left: unknown, right: unknown, direction: 'asc' | 'desc'): number {
  const leftNumber = Number(left)
  const rightNumber = Number(right)
  const result = Number.isFinite(leftNumber) && Number.isFinite(rightNumber)
    ? leftNumber - rightNumber
    : String(left ?? '').localeCompare(String(right ?? ''), undefined, { numeric: true, sensitivity: 'base' })
  return direction === 'asc' ? result : -result
}

function buildPieGradient(data: any[], yKey: string): string {
  const values = data.map(item => Math.max(0, Number(item[yKey] ?? item.value ?? 0)))
  const total = values.reduce((sum, value) => sum + value, 0) || 1
  const colors = ['#70d3ff', '#9ce6c5', '#f2d27a', '#ff7084', '#b6a5ff']
  let cursor = 0
  const stops = values.slice(0, 12).map((value, index) => {
    const start = cursor
    cursor += value / total * 100
    return `${colors[index % colors.length]} ${start.toFixed(2)}% ${cursor.toFixed(2)}%`
  })
  return `conic-gradient(${stops.join(', ')})`
}
