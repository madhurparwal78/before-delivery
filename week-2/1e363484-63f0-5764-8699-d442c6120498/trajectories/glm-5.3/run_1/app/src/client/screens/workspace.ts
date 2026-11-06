import {
  api, type Person, type Preview, type ProjectDetail, type Figure,
  type LedgerEntry, type Summary, ApiError, NetworkError,
} from '../api.js'
import { el, clear, announce, setAlert } from '../ui.js'
import {
  halfHourIndex, fromHalfHourIndex, displayInterval, displayChecked,
  compactStamp, fromCompactStamp, signedTonnes, reducedMotion,
} from '../format.js'
import { Brush } from './brush.js'
import { CoverageMap } from './map.js'
import { setProjectsMessage } from '../router.js'

type UrlState = { from?: string; to?: string; start?: string; end?: string; sensors?: string }

const PREVIEW_TIMEOUT_MS = 8000

export async function renderWorkspace(
  main: HTMLElement, slug: string, me: Person, query: URLSearchParams,
): Promise<void> {
  clear(main)
  let project: ProjectDetail
  try {
    project = await api<ProjectDetail>('GET', `/api/projects/${slug}`)
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      setProjectsMessage({ kind: 'lost-access' })
      window.history.replaceState({}, '', '/projects')
      window.dispatchEvent(new PopStateEvent('popstate'))
      return
    }
    throw err
  }

  // ---------- state ----------
  const sensorIds = project.sensors.map((s) => s.id)
  const hasReadings = project.record_start !== null && project.record_end !== null
  const recStart = hasReadings ? halfHourIndex(project.record_start!) : 0
  const recEnd = hasReadings ? halfHourIndex(project.record_end!) : 0

  // window: whole record by default, or from URL after validation
  let windowStart = recStart
  let windowEnd = recEnd
  let brushStart = recStart
  let brushEnd = recEnd
  let selected = new Set(sensorIds)

  if (hasReadings) {
    const url = readUrlState(query)
    const firstDay = fromHalfHourIndex(recStart).slice(0, 10)
    const lastDay = fromHalfHourIndex(recEnd - 1).slice(0, 10)
    let fromOk = false
    if (url.from && url.to && /^\d{4}-\d{2}-\d{2}$/.test(url.from) && /^\d{4}-\d{2}-\d{2}$/.test(url.to)
      && url.from >= firstDay && url.from <= lastDay && url.to >= firstDay && url.to <= lastDay
      && url.from <= url.to) {
      windowStart = halfHourIndex(`${url.from}T00:00:00Z`)
      windowEnd = Math.min(halfHourIndex(`${url.to}T00:00:00Z`) + 48, recEnd)
      fromOk = true
    }
    if (fromOk && url.start && url.end && /^\d{12}$/.test(url.start) && /^\d{12}$/.test(url.end)) {
      const s = halfHourIndex(fromCompactStamp(url.start))
      const e = halfHourIndex(fromCompactStamp(url.end))
      const minuteOk = Number(url.start!.slice(10)) % 30 === 0 && Number(url.end!.slice(10)) % 30 === 0
      if (s >= windowStart && e <= windowEnd && s < e && minuteOk) {
        brushStart = s
        brushEnd = e
      } else {
        brushStart = windowStart
        brushEnd = windowEnd
      }
    } else if (fromOk) {
      brushStart = windowStart
      brushEnd = windowEnd
    }
    if (url.sensors) {
      const ids = url.sensors.split(',')
      const distinct = new Set(ids)
      if (ids.length > 0 && distinct.size === ids.length && ids.every((id) => sensorIds.includes(id))) {
        selected = distinct
      }
    }
  }

  // ---------- header ----------
  main.append(el('h1', { text: project.name }))
  const headerMeta = el('p', { class: 'meta' })
  headerMeta.append(
    `${project.kind} · coverage floor ${project.floor_pct}% · buffer ${project.buffer_pct}%`,
  )
  main.append(headerMeta)

  // ---------- panes ----------
  const grid = el('div', { class: 'workspace-grid' })
  const timelinePane = el('div', { class: 'timeline-pane' })
  const mapPanel = el('div', { class: 'map-panel' })
  grid.append(mapPanel, timelinePane)
  const belowFold = el('div', { class: 'below-fold' })

  const workspaceAlert = el('div', { role: 'alert', class: 'alert', hidden: true })
  const workspaceStatus = el('p', { class: 'status-live', role: 'status', 'aria-label': 'Workspace status' })

  // ----- timeline pane -----
  const timelineGroup = el('div', { role: 'group', 'aria-label': 'Flux timeline' })
  const noReadings = el('p', { class: 'projects-note', text: 'No readings have been ingested for this project yet.', hidden: !hasReadings ? false : true })
  if (!hasReadings) timelineGroup.append(noReadings)

  const dateWindow = el('div', { class: 'date-window' })
  const fromInput = el('input', { type: 'date', id: 'from', 'aria-label': 'From' }) as HTMLInputElement
  const toInput = el('input', { type: 'date', id: 'to', 'aria-label': 'To' }) as HTMLInputElement
  const applyDates = el('button', { text: 'Apply dates', onclick: () => applyDateWindow() }) as HTMLButtonElement
  const fromLabel = el('label', { for: 'from', text: 'From' })
  const toLabel = el('label', { for: 'to', text: 'To' })
  fromLabel.append(fromInput)
  toLabel.append(toInput)
  dateWindow.append(fromLabel, toLabel, applyDates)

  let brush: Brush | null = null
  if (project.role === 'viewer') {
    // the published viewer copy lives in the timeline area
    const copy = el('p', {
      class: 'projects-note',
      text: 'Your role on this project can view sealed figures but not preview new ones.',
    })
    timelineGroup.append(copy)
    timelinePane.append(timelineGroup)
  } else if (hasReadings) {
    timelineGroup.append(dateWindow)
    timelinePane.append(timelineGroup)
    brush = new Brush(timelineGroup, () => undefined, {
      onPreview: () => { void requestPreview() },
      onSettle: () => { void settlePreview() },
    })
    brush.setBounds(recStart, recEnd)
    brush.setWindow(windowStart, windowEnd, false)
    brush.setBrush(brushStart, brushEnd)
    fromInput.value = fromHalfHourIndex(windowStart).slice(0, 10)
    toInput.value = fromHalfHourIndex(windowEnd - 1).slice(0, 10)
    timelineGroup.prepend(dateWindow)
  } else {
    // no readings yet: the copy is already inside the timeline group
    timelinePane.append(timelineGroup)
  }

  // ----- map -----
  const map = new CoverageMap(mapPanel, project.boundary, project.sensors)

  // ----- sensors -----
  const sensorPanel = el('div', { class: 'panel sensor-panel', role: 'group', 'aria-label': 'Sensors' })
  sensorPanel.append(el('h2', { text: 'Sensors' }))
  const checkboxById = new Map<string, HTMLInputElement>()
  const footprintById = new Map<string, HTMLButtonElement>()
  for (const s of project.sensors) {
    const cb = el('input', { type: 'checkbox', id: `sensor-${s.id}`, 'aria-label': s.id }) as HTMLInputElement
    cb.checked = selected.has(s.id)
    const label = el('label', { for: `sensor-${s.id}` })
    label.append(cb, el('span', { text: `${s.id} ` }), el('span', { text: s.kind === 'tower' ? 'Tower' : 'Satellite cell' }))
    cb.addEventListener('change', () => {
      setSelected(s.id, cb.checked)
    })
    checkboxById.set(s.id, cb)
    sensorPanel.append(label)

    const fp = el('button', {
      class: 'map-footprint',
      'aria-pressed': String(selected.has(s.id)),
      onclick: () => { setSelected(s.id, !selected.has(s.id)) },
      onkeydown: (e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(s.id, !selected.has(s.id)) }
      },
    })
    fp.textContent = ''
    fp.append(`${s.id} footprint`)
    fp.setAttribute('aria-label', `${s.id} footprint`)
    footprintById.set(s.id, fp)
  }
  // footprint buttons live on the map panel
  const mapPanelHost = mapPanel.firstElementChild as HTMLElement
  const fpGroup = el('div', { class: 'figure-actions' })
  for (const s of project.sensors) fpGroup.append(footprintById.get(s.id)!)
  mapPanelHost.append(fpGroup)
  grid.append(sensorPanel)

  function setSelected(sensorId: string, on: boolean): void {
    if (on) selected.add(sensorId)
    else {
      if (selected.size <= 1) return
      selected.delete(sensorId)
    }
    for (const [id, cb] of checkboxById) {
      cb.checked = selected.has(id)
      cb.disabled = selected.size === 1 && selected.has(id)
    }
    for (const [id, fp] of footprintById) {
      fp.setAttribute('aria-pressed', String(selected.has(id)))
      if (selected.size === 1 && selected.has(id)) fp.setAttribute('disabled', '')
      else fp.removeAttribute('disabled')
    }
    syncUrl()
    void requestPreview()
    void settlePreview()
  }

  // ----- figure panel -----
  const figurePanel = el('div', { class: 'panel figure-panel', role: 'region', 'aria-label': 'Figure' })
  figurePanel.append(el('h2', { text: 'Figure' }))
  const dl = el('dl')
  const dt = (t: string): HTMLElement => el('dt', { text: t })
  const dd = (): HTMLElement => el('dd')

  const intervalDd = dd(); intervalDd.append(el('span', { class: 'num', text: '—' }))
  dl.append(dt('Interval'), intervalDd)

  const coverageDd = dd()
  const coverageCounting = el('span', { class: 'num counting', 'aria-hidden': 'true', text: '0.0%' })
  const coverageHidden = el('span', { class: 'visually-hidden', text: '0.0%' })
  coverageDd.append(coverageCounting, coverageHidden)
  dl.append(dt('Coverage'), coverageDd)

  const netDd = dd()
  const netCounting = el('span', { class: 'num counting', 'aria-hidden': 'true', text: '0.000' })
  const netHidden = el('span', { class: 'visually-hidden', text: '0.000' })
  netDd.append(netCounting, netHidden, el('span', { class: 'buffer-bar', 'aria-hidden': 'true' }))
  dl.append(dt('Net tCO2e'), netDd)

  const co2Dd = dd(); co2Dd.append(el('span', { class: 'num', text: '—' }))
  const ch4Dd = dd(); ch4Dd.append(el('span', { class: 'num', text: '—' }))
  const bufferDd = dd(); bufferDd.append(el('span', { class: 'num', text: '—' }))
  const creditedDd = dd(); creditedDd.append(el('span', { class: 'num', text: '—' }))
  const readingsDd = dd(); readingsDd.append(el('span', { class: 'num', text: '—' }))
  dl.append(dt('CO2 tCO2e'), co2Dd, dt('CH4 tCO2e'), ch4Dd, dt('Buffer tCO2e'), bufferDd, dt('Credited tCO2e'), creditedDd, dt('Readings'), readingsDd)

  const meterRow = el('div', { class: 'meter-row' })
  const meterHolder = el('div', { class: 'meter-holder' })
  const meter = el('meter', {
    min: '0', max: '100', value: '0', 'aria-label': 'Coverage',
    'aria-valuetext': '0.0%',
  }) as HTMLMeterElement
  const tick = el('span', { class: 'floor-tick', 'aria-hidden': 'true' })
  tick.style.left = `${project.floor_pct}%`
  const tickLabel = el('span', { class: 'floor-tick-label', text: `Floor ${project.floor_pct}%` })
  meterHolder.append(meter, tick)
  meterRow.append(meterHolder, tickLabel)
  dl.append(meterRow)
  figurePanel.append(dl)

  const figureActions = el('div', { class: 'figure-actions' })
  const unitButton = el('button', { text: 'Unit breakdown', onclick: () => openUnitBreakdown() }) as HTMLButtonElement
  const sealButton = el('button', {
    id: 'seal-figure', text: 'Seal figure', disabled: true,
    onclick: () => openSealDialog(),
  }) as HTMLButtonElement
  const sealReason = el('p', { class: 'seal-reason', hidden: true })
  figureActions.append(unitButton, sealButton)
  figurePanel.append(figureActions, sealReason)

  // ----- bottom sheet (below 700px) -----
  // The figure panel itself is the sheet. A compact bar stays visible while
  // collapsed; the rest of the panel is hidden and inert.
  figurePanel.classList.add('sheet')
  const sheetBar = el('div', { class: 'sheet-bar' })
  const sheetDetails = el('button', {
    text: 'Figure details', 'aria-expanded': 'false', 'aria-controls': 'sheet-extra',
    onclick: () => toggleSheet(),
  }) as HTMLButtonElement
  sheetBar.append(coverageCounting, netCounting, sealButton, sheetDetails)
  const sheetExtra = el('div', { id: 'sheet-extra', 'data-sheet-extra': '' })
  figurePanel.insertBefore(sheetBar, figurePanel.firstChild)
  figurePanel.insertBefore(sheetExtra, dl)
  dl.setAttribute('data-sheet-extra', '')
  unitButton.setAttribute('data-sheet-extra', '')
  sealReason.setAttribute('data-sheet-extra', '')

  const smallScreen = window.matchMedia('(max-width: 699px)')
  function applySheetMode(): void {
    if (!smallScreen.matches) {
      sheetBar.hidden = true
      for (const n of figurePanel.querySelectorAll('[data-sheet-extra]')) {
        ;(n as HTMLElement).hidden = false
      }
      sheetDetails.setAttribute('aria-expanded', 'false')
      return
    }
    sheetBar.hidden = false
    const expanded = sheetDetails.getAttribute('aria-expanded') === 'true'
    for (const n of figurePanel.querySelectorAll('[data-sheet-extra]')) {
      ;(n as HTMLElement).hidden = !expanded
    }
  }
  smallScreen.addEventListener('change', applySheetMode)

  function toggleSheet(): void {
    const expanded = sheetDetails.getAttribute('aria-expanded') === 'true'
    sheetDetails.setAttribute('aria-expanded', String(!expanded))
    applySheetMode()
    if (!expanded) sheetDetails.focus()
  }
  applySheetMode()
  grid.append(figurePanel)

  // pane order follows the viewport: map first below 1200, timeline first above
  const wide = window.matchMedia('(min-width: 1200px)')
  function applyPaneOrder(): void {
    if (wide.matches) {
      grid.insertBefore(timelinePane, grid.firstChild)
      grid.insertBefore(mapPanel, timelinePane.nextSibling)
    } else {
      grid.insertBefore(mapPanel, grid.firstChild)
      grid.insertBefore(timelinePane, mapPanel.nextSibling)
    }
  }
  wide.addEventListener('change', applyPaneOrder)
  applyPaneOrder()

  // ----- below fold: balance, figures, ledger -----
  const balancePanel = el('div', { class: 'panel', role: 'region', 'aria-label': 'Project balance' })
  balancePanel.append(el('h2', { text: 'Project balance' }))
  const balanceStrip = el('div', { class: 'balance-strip' })
  const balanceItems: Record<string, HTMLElement> = {}
  for (const [key, label] of [
    ['sealed', 'Sealed net tCO2e'], ['buffer', 'Buffer tCO2e'],
    ['intact', 'Intact figures'], ['broken', 'Broken figures'], ['superseded', 'Superseded figures'],
  ] as [string, string][]) {
    const item = el('div', { class: 'item' })
    const labelEl = el('div', { class: 'label', text: label })
    const value = el('div', { class: 'value', text: '—' })
    item.append(labelEl, value)
    balanceStrip.append(item)
    balanceItems[key] = value
  }
  balancePanel.append(balanceStrip)
  belowFold.append(balancePanel)

  const figuresPanel = el('div', { class: 'panel' })
  figuresPanel.append(el('h2', { text: 'Figures' }))
  const figuresTableHost = el('div', { class: 'table-scroll card-table' })
  figuresPanel.append(figuresTableHost)
  belowFold.append(figuresPanel)

  const ledgerPanel = el('div', { class: 'panel' })
  ledgerPanel.append(el('h2', { text: 'Sealed-tonnes ledger' }))
  const ledgerHost = el('div', { class: 'table-scroll card-table' })
  ledgerPanel.append(ledgerHost)
  belowFold.append(ledgerPanel)

  main.append(workspaceAlert, workspaceStatus, grid, belowFold)

  // ---------- preview lifecycle ----------

  let previewSeq = 0
  let currentPreview: Preview | null = null
  let announcedKey: string | null = null
  let pendingSeal = false

  async function requestPreview(): Promise<void> {
    if (!brush || !hasReadings) return
    if (me && project.role === 'viewer') return
    const seq = ++previewSeq
    const { startIdx, endIdx } = brush.value
    const body = {
      start: fromHalfHourIndex(startIdx),
      end: fromHalfHourIndex(endIdx),
      sensor_ids: [...selected].sort(),
    }
    try {
      const res = await api<Preview>('POST', `/api/projects/${slug}/preview`, body, PREVIEW_TIMEOUT_MS)
      if (seq !== previewSeq) return // older response discarded
      currentPreview = res
      paintPreview(res)
      if (brush.isSettled()) maybeAnnounce()
    } catch (err) {
      if (seq !== previewSeq) return
      if (lostAccess(err)) return
      if (err instanceof ApiError && err.status === 403) {
        workspaceAlert.hidden = false
        setAlert(workspaceAlert, 'Your role on this project can view sealed figures but not preview new ones.')
        return
      }
      workspaceAlert.hidden = false
      setAlert(workspaceAlert, 'Could not load the figure for this interval. Move the brush to try again.')
    }
  }

  /** The settle announcement fires once per settled preview position. */
  function maybeAnnounce(): void {
    if (!currentPreview || !brush) return
    const { startIdx, endIdx } = brush.value
    if (currentPreview.start !== fromHalfHourIndex(startIdx)) return
    if (currentPreview.end !== fromHalfHourIndex(endIdx)) return
    const key = `${currentPreview.start}|${currentPreview.end}|${currentPreview.fingerprint}`
    if (announcedKey === key) return
    announcedKey = key
    announceBrush(currentPreview)
  }

  async function settlePreview(): Promise<void> {
    maybeAnnounce()
    syncUrl()
  }

  function announceBrush(p: Preview): void {
    const cov = p.coverage_pct
    const net = signedTonnes(p.net_tco2e)
    let msg: string
    if (p.sealable) msg = `Coverage ${cov}%, net ${net} tCO2e. Seal available.`
    else if (p.blocked_reason === 'below_coverage_floor') {
      msg = `Coverage ${cov}%, net ${net} tCO2e. Below the ${project.floor_pct}% floor.`
    } else {
      msg = `Coverage ${cov}%, net ${net} tCO2e. Seal unavailable.`
    }
    announce(workspaceStatus, msg)
  }

  // counting numerals and the coverage tide
  function paintPreview(p: Preview): void {
    const prevCov = currentCoverageShown
    const prevNet = currentNetShown
    intervalDd.textContent = ''
    intervalDd.append(el('span', { class: 'num', text: `${displayInterval(p.start)} to ${displayInterval(p.end)}` }))
    ;(co2Dd.firstChild as HTMLElement).textContent = p.co2_tco2e
    ;(ch4Dd.firstChild as HTMLElement).textContent = p.ch4_tco2e
    ;(bufferDd.firstChild as HTMLElement).textContent = p.buffer_tco2e
    ;(creditedDd.firstChild as HTMLElement).textContent = p.credited_tco2e
    ;(readingsDd.firstChild as HTMLElement).textContent = String(p.readings_count)

    coverageHidden.textContent = `${p.coverage_pct}%`
    netHidden.textContent = signedTonnes(p.net_tco2e)
    meter.value = Number(p.coverage_pct)

    countTo(coverageCounting, prevCov, Number(p.coverage_pct), 1, '%')
    countTo(netCounting, prevNet, Number(p.net_tco2e), 3, '', true)

    // map redraw
    const contributing = new Set(p.contributions.map((c) => c.sensor_id))
    map.draw({ selected, contributing })

    // armed state
    const reasonFor = (): string | null => {
      if (p.blocked_reason === 'below_coverage_floor') {
        return `Coverage ${p.coverage_pct}% is below this project's ${project.floor_pct}% floor, so this figure cannot be sealed.`
      }
      if (p.blocked_reason === 'overlaps_sealed') {
        return `This interval overlaps sealed figure ${p.blocking_figure_id}. Choose an interval that does not overlap it.`
      }
      if (p.blocked_reason === 'already_sealed') {
        return `This interval is already sealed as ${p.blocking_figure_id}.`
      }
      if (p.blocked_reason === 'role') {
        return 'Your role on this project can preview figures but not seal them.'
      }
      return null
    }
    const reason = reasonFor()
    if (p.sealable && project.role === 'sealer') {
      sealButton.disabled = false
      sealButton.classList.add('armed')
      sealReason.hidden = true
    } else {
      sealButton.disabled = true
      sealButton.classList.remove('armed')
      if (reason) {
        sealReason.hidden = false
        sealReason.textContent = reason
      } else {
        sealReason.hidden = true
      }
    }
  }

  let currentCoverageShown = 0
  let currentNetShown = 0

  /** Count a numeral from its previous value to the new one, or jump under reduced motion. */
  function countTo(
    target: HTMLElement, from: number, to: number, dp: number, suffix = '', signed = false,
  ): void {
    const fmt = (v: number): string => {
      const fixed = v.toFixed(dp)
      if (signed) {
        if (v > 0 && dp === 3) return `+${fixed}`
        if (v === 0) return fixed
      }
      return fixed
    }
    if (reducedMotion()) {
      target.textContent = `${signedTonnesSigned(to, dp)}${suffix}`
      if (dp === 1) currentCoverageShown = to
      else currentNetShown = to
      return
    }
    const start = performance.now()
    const duration = 450
    const step = (now: number): void => {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - t, 3)
      const v = from + (to - from) * eased
      target.textContent = `${fmt(v)}${suffix}`
      if (t < 1) requestAnimationFrame(step)
      else {
        target.textContent = `${fmt(to)}${suffix}`
        if (dp === 1) currentCoverageShown = to
        else currentNetShown = to
      }
    }
    requestAnimationFrame(step)
  }

  function signedTonnesSigned(v: number, dp: number): string {
    if (dp === 3) {
      if (v > 0) return `+${v.toFixed(3)}`
      if (v === 0) return v.toFixed(3)
      return v.toFixed(3)
    }
    return v.toFixed(1)
  }

  // ---------- date window ----------
  function applyDateWindow(): void {
    const from = fromInput.value
    const to = toInput.value
    if (!from || !to || to < from) {
      workspaceAlert.hidden = false
      setAlert(workspaceAlert, 'The To date must be on or after the From date.')
      return
    }
    workspaceAlert.hidden = true
    const firstDay = fromHalfHourIndex(recStart).slice(0, 10)
    const lastDay = fromHalfHourIndex(recEnd - 1).slice(0, 10)
    const safeFrom = from < firstDay ? firstDay : from
    const safeTo = to > lastDay ? lastDay : to
    windowStart = Math.max(recStart, halfHourIndex(`${safeFrom}T00:00:00Z`))
    windowEnd = Math.min(recEnd, halfHourIndex(`${safeTo}T00:00:00Z`) + 48)
    brush!.setWindow(windowStart, windowEnd, true)
    fromInput.value = fromHalfHourIndex(windowStart).slice(0, 10)
    toInput.value = fromHalfHourIndex(windowEnd - 1).slice(0, 10)
    window.history.pushState({}, '', canonicalUrl())
    void loadTimeline()
    void requestPreview()
    void settlePreview()
  }

  // ---------- URL ----------
  function canonicalUrl(): string {
    if (!hasReadings) return `/projects/${slug}`
    const from = fromHalfHourIndex(windowStart).slice(0, 10)
    const to = fromHalfHourIndex(windowEnd - 1).slice(0, 10)
    const start = compactStamp(fromHalfHourIndex(brush!.value.startIdx))
    const end = compactStamp(fromHalfHourIndex(brush!.value.endIdx))
    const sensors = [...selected].sort().join(',')
    // exact canonical form, with literal commas
    return `/projects/${slug}?from=${from}&to=${to}&start=${start}&end=${end}&sensors=${sensors}`
  }

  function syncUrl(): void {
    if (!hasReadings) return
    window.history.replaceState({}, '', canonicalUrl())
  }

  // ---------- timeline ----------
  async function loadTimeline(): Promise<void> {
    if (!hasReadings) return
    const from = fromHalfHourIndex(windowStart).slice(0, 10)
    const to = fromHalfHourIndex(windowEnd - 1).slice(0, 10)
    try {
      const res = await api<{ days: { date: string; net_tco2e: string; coverage_pct: string }[] }>(
        'GET', `/api/projects/${slug}/timeline?from=${from}&to=${to}`)
      brush!.renderDays(res.days)
    } catch { /* keep old bars */ }
  }

  // ---------- unit breakdown dialog ----------
  function openUnitBreakdown(): void {
    const dlg = document.createElement('dialog')
    dlg.setAttribute('aria-label', 'Unit breakdown')
    const body = el('div', { class: 'dialog-body' })
    body.append(el('h2', { text: 'Unit breakdown' }))
    body.append(el('p', {
      class: 'projects-note',
      text: 'CO2: FC µmol/m²/s × 1800 s × 0.00004401 g/µmol × area ÷ 1,000,000. CH4: FCH4 nmol/m²/s × 1800 s × 0.00000001604 g/nmol × 27.0 GWP100 × area ÷ 1,000,000.',
    }))
    const p = currentPreview
    const table = el('table', { 'aria-label': 'Unit breakdown' })
    const thead = el('thead')
    const hr = el('tr')
    for (const c of ['Sensor', 'Kind', 'Area m²', 'Qualifying half-hours', 'CO2 tCO2e', 'CH4 tCO2e', 'Net tCO2e']) {
      hr.append(el('th', { text: c }))
    }
    thead.append(hr)
    const tbody = el('tbody')
    if (p) {
      for (const c of p.contributions) {
        const tr = el('tr')
        tr.append(
          el('td', { text: c.sensor_id }),
          el('td', { text: c.kind === 'tower' ? 'Tower' : 'Satellite cell' }),
          el('td', { class: 'num', text: String(c.area_m2) }),
          el('td', { class: 'num', text: `${c.qualifying_half_hours} of ${c.half_hours}` }),
          el('td', { class: 'num', text: c.co2_tco2e }),
          el('td', { class: 'num', text: c.ch4_tco2e }),
          el('td', { class: 'num', text: c.net_tco2e }),
        )
        tbody.append(tr)
      }
      const total = el('tr')
      total.append(
        el('td', { text: 'Total' }),
        el('td', {}),
        el('td', {}),
        el('td', {}),
        el('td', { class: 'num', text: p.co2_tco2e }),
        el('td', { class: 'num', text: p.ch4_tco2e }),
        el('td', { class: 'num', text: p.net_tco2e }),
      )
      tbody.append(total)
    }
    table.append(thead, tbody)
    body.append(el('div', { class: 'table-scroll' }, table))
    const actions = el('div', { class: 'dialog-actions' })
    const close = el('button', { text: 'Close' }) as HTMLButtonElement
    actions.append(close)
    dlg.append(body, actions)
    document.body.append(dlg)

    const closeDialog = (): void => {
      dlg.close()
      dlg.remove()
      unitButton.focus()
    }
    close.addEventListener('click', closeDialog)
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); closeDialog() })
    dlg.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { closeDialog(); return }
      if (e.key === 'Tab') {
        // keep Tab inside the dialog
        const focusables = [close]
        const first = focusables[0]!
        const last = focusables[focusables.length - 1]!
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
      }
    })
    dlg.showModal()
    close.focus()
  }

  // ---------- seal dialog ----------
  function openSealDialog(): void {
    const p = currentPreview
    if (!p || !p.sealable || project.role !== 'sealer') return
    const idempotencyKey = crypto.randomUUID()
    const dlg = document.createElement('dialog')
    dlg.setAttribute('aria-label', 'Seal figure')
    const body = el('div', { class: 'dialog-body' })
    body.append(el('h2', { text: 'Seal figure' }))
    const facts = el('dl')
    const row = (t: string, v: string): void => {
      facts.append(el('dt', { text: t }), el('dd', { text: v }))
    }
    row('Interval', `${displayInterval(p.start)} to ${displayInterval(p.end)}`)
    row('Sensors', p.sensor_ids.join(', '))
    row('Coverage', `${p.coverage_pct}%`)
    row('Net tCO2e', signedTonnes(p.net_tco2e))
    row('Buffer tCO2e', p.buffer_tco2e)
    row('Credited tCO2e', p.credited_tco2e)
    row('Fingerprint', p.fingerprint.slice(0, 12))
    body.append(facts)
    const dialogAlert = el('div', { role: 'alert', class: 'alert', hidden: true })
    body.append(dialogAlert)
    const actions = el('div', { class: 'dialog-actions' })
    const confirm = el('button', { text: 'Confirm seal' }) as HTMLButtonElement
    const cancel = el('button', { text: 'Cancel' }) as HTMLButtonElement
    actions.append(confirm, cancel)
    dlg.append(body, actions)
    document.body.append(dlg)

    let inFlight = false
    const closeDialog = (): void => {
      dlg.close()
      dlg.remove()
      sealButton.focus()
    }
    cancel.addEventListener('click', closeDialog)
    dlg.addEventListener('cancel', (e) => { if (!inFlight) { e.preventDefault(); closeDialog() } })

    confirm.addEventListener('click', async () => {
      if (inFlight) return
      inFlight = true
      pendingSeal = true
      confirm.disabled = true
      confirm.textContent = 'Sealing...'
      announce(workspaceStatus, 'Sealing figure. Waiting for evidence storage to confirm.')
      const payload = {
        start: p.start, end: p.end,
        sensor_ids: [...selected].sort(),
        preview_fingerprint: p.fingerprint,
      }
      try {
        const res = await apiWithHeadersTimeout<Figure>(
          'POST', `/api/projects/${slug}/figures`, payload,
          { 'Idempotency-Key': idempotencyKey }, 15000)
        // success
        dlg.close()
        dlg.remove()
        const suffix = res.data.supersedes ? ` Supersedes ${res.data.supersedes}.` : ''
        announce(workspaceStatus, `Sealed ${res.data.id}: ${signedTonnes(res.data.net_tco2e)} tCO2e at ${res.data.coverage_pct}% coverage.${suffix}`)
        await refreshBelowFold()
        pendingSeal = false
        await requestPreview()
        const link = figuresTableHost.querySelector(`a[href="/projects/${slug}/figures/${res.data.id}"]`) as HTMLElement | null
        if (link) link.focus()
      } catch (err) {
        inFlight = false
        pendingSeal = false
        confirm.disabled = false
        confirm.textContent = 'Confirm seal'
        if (err instanceof NetworkError) {
          dialogAlert.hidden = false
          setAlert(dialogAlert, 'No answer from the server yet. Confirm seal again to retry safely.')
          return
        }
        if (err instanceof ApiError) {
          if (err.status === 403) {
            // role changed under us: refetch the project
            try {
              project = await api<ProjectDetail>('GET', `/api/projects/${slug}`)
            } catch { /* keep old role */ }
            const copy = project.role === 'viewer'
              ? 'Your role on this project can view sealed figures but not preview new ones.'
              : 'Your role on this project can preview figures but not seal them.'
            dialogAlert.hidden = false
            setAlert(dialogAlert, copy)
            announce(workspaceStatus, copy)
            return
          }
          if (err.status === 409 || err.status === 422) {
            const copy = refusalCopy(err)
            dialogAlert.hidden = false
            setAlert(dialogAlert, copy)
            announce(workspaceStatus, copy)
            return
          }
          if (err.status === 503) {
            const copy = err.code === 'storage_unavailable'
              ? 'Evidence storage is unreachable, so nothing was sealed. Try again in a few minutes.'
              : 'The seal notice could not be sent, so nothing was sealed. Try again in a few minutes.'
            dialogAlert.hidden = false
            setAlert(dialogAlert, copy)
            return
          }
        }
        dialogAlert.hidden = false
        setAlert(dialogAlert, 'No answer from the server yet. Confirm seal again to retry safely.')
      }
    })

    dlg.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        const focusables = [confirm, cancel]
        const first = focusables[0]!
        const last = focusables[focusables.length - 1]!
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
      }
    })
    dlg.showModal()
    confirm.focus()
  }

  function refusalCopy(err: ApiError): string {
    switch (err.code) {
      case 'readings_changed':
        return 'Readings in this interval changed since the preview. Check the new figure before sealing.'
      case 'below_coverage_floor':
        return `Coverage ${String(err.extra.coverage_pct ?? '')} is below this project's ${String(err.extra.floor_pct ?? '')} floor, so this figure cannot be sealed.`
      case 'interval_overlaps_sealed':
        return `This interval overlaps sealed figure ${String(err.extra.figure_id ?? '')}. Choose an interval that does not overlap it.`
      case 'already_sealed':
        return `This interval is already sealed as ${String(err.extra.figure_id ?? '')}.`
      default:
        return 'The figure could not be sealed right now. Try again in a few minutes.'
    }
  }

  // ---------- below fold refresh ----------
  let knownFigureStatus = new Map<string, string>()

  function lostAccess(err: unknown): boolean {
    if (err instanceof ApiError && err.status === 404) {
      setProjectsMessage({ kind: 'lost-access' })
      window.history.replaceState({}, '', '/projects')
      window.dispatchEvent(new PopStateEvent('popstate'))
      return true
    }
    return false
  }

  async function refreshBelowFold(): Promise<void> {
    try {
      const [figs, ledger] = await Promise.all([
        api<{ figures: Figure[]; summary: Summary }>('GET', `/api/projects/${slug}/figures`),
        api<{ entries: LedgerEntry[]; balance_tco2e: string; buffer_tco2e: string }>('GET', `/api/projects/${slug}/ledger`),
      ])
      paintSummary(figs.summary)
      paintFigures(figs.figures)
      paintLedger(ledger)
      detectNewBreaks(figs.figures)
    } catch (err) {
      if (!lostAccess(err)) { /* keep previous */ }
    }
  }

  function paintSummary(s: Summary): void {
    balanceItems.sealed!.textContent = s.sealed_net_tco2e
    balanceItems.buffer!.textContent = s.buffer_tco2e
    balanceItems.intact!.textContent = String(s.intact_count)
    balanceItems.broken!.textContent = String(s.broken_count)
    balanceItems.superseded!.textContent = String(s.superseded_count)
  }

  function paintFigures(figures: Figure[]): void {
    clear(figuresTableHost)
    const table = el('table', { 'aria-label': 'Figures' })
    const thead = el('thead')
    const hr = el('tr')
    for (const c of ['Figure', 'Interval', 'Net tCO2e', 'Buffer tCO2e', 'Credited tCO2e', 'Coverage', 'Status', 'Checked at']) {
      hr.append(el('th', { text: c }))
    }
    thead.append(hr)
    const tbody = el('tbody')
    for (const f of figures) {
      const tr = el('tr')
      const tdId = el('td')
      tdId.append(el('a', { href: `/projects/${slug}/figures/${f.id}`, text: f.id }))
      tr.append(
        tdId,
        el('td', { class: 'num', text: `${f.start.slice(0, 10)} to ${f.end.slice(0, 10)}` }),
        el('td', { class: 'num', text: f.net_tco2e }),
        el('td', { class: 'num', text: f.buffer_tco2e }),
        el('td', { class: 'num', text: f.credited_tco2e }),
        el('td', { class: 'num', text: f.coverage_pct }),
        statusPill(f.status),
        el('td', { class: 'num', text: displayChecked(f.checked_at) }),
      )
      tbody.append(tr)
    }
    table.append(thead, tbody)
    figuresTableHost.append(table)
  }

  function statusPill(status: string): HTMLElement {
    const td = el('td')
    const pill = el('span', { class: `status-pill ${status}`, text: status.charAt(0).toUpperCase() + status.slice(1) })
    td.append(pill)
    return td
  }

  function paintLedger(ledger: { entries: LedgerEntry[]; balance_tco2e: string; buffer_tco2e: string }): void {
    clear(ledgerHost)
    const table = el('table', { 'aria-label': 'Sealed-tonnes ledger' })
    const thead = el('thead')
    const hr = el('tr')
    for (const c of ['Entry', 'Figure', 'Kind', 'tCO2e', 'Recorded at']) hr.append(el('th', { text: c }))
    thead.append(hr)
    const tbody = el('tbody')
    for (const e of ledger.entries) {
      const tr = el('tr')
      tr.append(
        el('td', { class: 'num', text: e.id.slice(0, 13) }),
        el('td', { text: e.figure_id }),
        el('td', { text: e.kind.charAt(0).toUpperCase() + e.kind.slice(1) }),
        el('td', { class: 'num', text: e.tco2e }),
        el('td', { class: 'num', text: displayChecked(e.recorded_at) }),
      )
      tbody.append(tr)
    }
    const balanceRow = el('tr')
    balanceRow.append(
      el('td', {}),
      el('td', {}),
      el('td', { text: 'Balance' }),
      el('td', { class: 'num', text: ledger.balance_tco2e }),
      el('td', {}),
    )
    tbody.append(balanceRow)
    table.append(thead, tbody)
    ledgerHost.append(table)
  }

  function detectNewBreaks(figures: Figure[]): void {
    const newly: string[] = []
    for (const f of figures) {
      const prev = knownFigureStatus.get(f.id)
      if (prev === 'sealed' && f.status === 'broken') newly.push(f.id)
    }
    knownFigureStatus = new Map(figures.map((f) => [f.id, f.status]))
    if (newly.length > 0) {
      const ids = [...newly].sort()
      announce(workspaceStatus, ids.map((id) => `Seal broken on ${id}. Its tonnes have been reversed in the ledger.`).join(' '))
    }
  }

  // ---------- periodic refresh ----------
  const refreshTimer = setInterval(() => {
    if (document.visibilityState === 'hidden' || pendingSeal) return
    void refreshBelowFold()
  }, 15000)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !pendingSeal) void refreshBelowFold()
  })

  // stop the refresh loop once this screen leaves the document
  const watchdog = setInterval(() => {
    if (!main.isConnected) {
      clearInterval(refreshTimer)
      clearInterval(watchdog)
      smallScreen.removeEventListener('change', applySheetMode)
      wide.removeEventListener('change', applyPaneOrder)
    }
  }, 1000)

  // ---------- initial loads ----------
  if (hasReadings) {
    await loadTimeline()
    await requestPreview()
    await settlePreview()
  }
  await refreshBelowFold()
  syncUrl()
}

async function apiWithHeadersTimeout<T>(
  method: string, path: string, body: unknown, headers: Record<string, string>, timeoutMs: number,
): Promise<{ data: T; headers: Record<string, string> }> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(path, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: ctrl.signal,
      credentials: 'same-origin',
    })
    const text = await res.text()
    const data = text ? JSON.parse(text) : {}
    if (!res.ok) {
      throw new ApiError(res.status, String((data as Record<string, unknown>).error ?? 'unknown'), data as Record<string, unknown>)
    }
    return { data: data as T, headers: {} }
  } catch (err) {
    if (err instanceof ApiError) throw err
    throw new NetworkError(String(err))
  } finally {
    clearTimeout(timer)
  }
}

function readUrlState(query: URLSearchParams): UrlState {
  const out: UrlState = {}
  const from = query.get('from')
  const to = query.get('to')
  const start = query.get('start')
  const end = query.get('end')
  const sensors = query.get('sensors')
  if (from !== null) out.from = from
  if (to !== null) out.to = to
  if (start !== null) out.start = start
  if (end !== null) out.end = end
  if (sensors !== null) out.sensors = sensors
  return out
}
