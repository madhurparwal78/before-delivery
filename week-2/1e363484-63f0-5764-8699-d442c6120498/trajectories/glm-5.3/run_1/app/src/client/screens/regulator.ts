import { api, ApiError, NetworkError } from '../api.js'
import { el, clear, announce, setAlert } from '../ui.js'
import { displayChecked, displayExpiry, signedTonnes } from '../format.js'
import { auditTable, type MovedReading } from './audit.js'

type PublicFigure = {
  id: string; project: string; start: string; end: string; sensor_ids: string[]
  status: 'sealed' | 'broken' | 'superseded'
  supersedes: string | null; superseded_by: string | null
  coverage_pct: string; floor_pct: string
  net_tco2e: string; co2_tco2e: string; ch4_tco2e: string
  buffer_pct: string; buffer_tco2e: string; credited_tco2e: string
  readings_count: number; fingerprint: string
  checked_at: string
  contributions: {
    sensor_id: string; kind: 'tower' | 'satellite'; area_m2: number
    qualifying_half_hours: number; half_hours: number
    co2_tco2e: string; ch4_tco2e: string; net_tco2e: string
  }[]
  rederived: { fingerprint: string; coverage_pct: string; net_tco2e: string; matches: boolean }
}

type PublicBody = {
  link: { status: 'live'; expires_at: string }
  project: { name: string; kind: string }
  figure: PublicFigure
}

export async function renderRegulatorFigure(app: HTMLElement, token: string, audit: boolean): Promise<void> {
  clear(app)
  const page = el('div', { class: 'public-page' })
  app.append(page)

  if (audit) {
    try {
      const res = await api<{ figure_id: string; moved: MovedReading[] }>('GET', `/api/public/links/${encodeURIComponent(token)}/audit`)
      page.append(el('h1', { class: 'public-heading', text: `Readings audit trail for ${res.figure_id}` }))
      const { wrap } = auditTable(res.moved)
      page.append(wrap)
    } catch (err) {
      renderEndedPage(page, err)
    }
    return
  }

  const alertRegion = el('div', { role: 'alert', class: 'alert', hidden: true })
  const statusRegion = el('p', { class: 'status-live', role: 'status', 'aria-label': 'Re-derivation status' })
  const body = el('div')

  async function load(): Promise<PublicBody | null> {
    try {
      return await api<PublicBody>('GET', `/api/public/links/${encodeURIComponent(token)}`)
    } catch (err) {
      renderEndedPage(page, err, alertRegion)
      return null
    }
  }

  const data = await load()
  if (data) {
    page.append(alertRegion, statusRegion, body)
    paint(data)
  }

  function paint(d: PublicBody): void {
    clear(body)
    const f = d.figure
    body.append(el('h1', { class: 'public-heading', text: `Sealed figure ${f.id}` }))

    const statusLine = el('p')
    const statusText = f.status === 'superseded'
      ? `Status: Superseded by ${f.superseded_by}`
      : f.status === 'broken' ? 'Status: Broken' : 'Status: Intact'
    statusLine.append(el('strong', { text: statusText }))
    statusLine.append(document.createTextNode(` · Checked at ${displayChecked(f.checked_at)}`))
    body.append(statusLine)

    const expiryLine = el('p', { class: 'meta', text: `Link expires ${displayExpiry(d.link.expires_at)}` })
    body.append(expiryLine)

    const facts = el('dl', { class: 'public-facts' })
    const row = (t: string, v: string): void => {
      facts.append(el('dt', { text: t }), el('dd', { text: v }))
    }
    row('Project', `${d.project.name} (${d.project.kind})`)
    row('Interval', `${f.start} to ${f.end}`)
    row('Sensors', f.sensor_ids.join(', '))
    row('Coverage', `${f.coverage_pct}% (floor ${f.floor_pct}%)`)
    row('Net tCO2e', signedTonnes(f.net_tco2e))
    row('CO2 tCO2e', f.co2_tco2e)
    row('CH4 tCO2e', f.ch4_tco2e)
    row('Buffer tCO2e', f.buffer_tco2e)
    row('Credited tCO2e', f.credited_tco2e)
    row('Readings', String(f.readings_count))
    row('Fingerprint', f.fingerprint)
    row('Re-derived', `${f.rederived.matches ? 'matches the sealed fingerprint' : 'does not match the sealed fingerprint'} · net ${signedTonnes(f.rederived.net_tco2e)} · coverage ${f.rederived.coverage_pct}%`)
    body.append(facts)

    body.append(el('h2', { text: 'Unit breakdown' }))
    const table = el('table', { 'aria-label': 'Unit breakdown' })
    const thead = el('thead')
    const hr = el('tr')
    for (const c of ['Sensor', 'Kind', 'Area m²', 'Qualifying half-hours', 'CO2 tCO2e', 'CH4 tCO2e', 'Net tCO2e']) {
      hr.append(el('th', { text: c }))
    }
    thead.append(hr)
    const tbody = el('tbody')
    for (const c of f.contributions) {
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
      el('td', { text: 'Total' }), el('td', {}), el('td', {}), el('td', {}),
      el('td', { class: 'num', text: f.co2_tco2e }),
      el('td', { class: 'num', text: f.ch4_tco2e }),
      el('td', { class: 'num', text: f.net_tco2e }),
    )
    tbody.append(total)
    table.append(thead, tbody)
    body.append(el('div', { class: 'table-scroll card-table' }, table))

    const actions = el('div', { class: 'public-actions' })
    const rederive = el('button', {
      text: 'Re-derive',
      onclick: async () => {
        rederive.disabled = true
        announce(statusRegion, 'Re-deriving from the stored readings.')
        try {
          const fresh = await api<PublicBody>('POST', `/api/public/links/${encodeURIComponent(token)}/rederive`, {})
          paint(fresh)
          announce(statusRegion, `Re-derived at ${displayChecked(fresh.figure.checked_at)}: ${verdict(fresh)}.`)
        } catch (err) {
          if (err instanceof ApiError && (err.status === 410 || err.status === 404)) {
            renderEndedPage(page, err)
            return
          }
          announce(statusRegion, 'Could not re-derive right now. Try again in a few minutes.')
        } finally {
          rederive.disabled = false
        }
      },
    }) as HTMLButtonElement
    const auditLink = el('a', { class: 'btn', href: `/r/${encodeURIComponent(token)}/audit`, text: 'Readings audit trail' })
    const download = el('button', {
      text: 'Download readings file',
      onclick: async () => {
        download.disabled = true
        try {
          const res = await fetch(`/api/public/links/${encodeURIComponent(token)}/evidence`)
          if (!res.ok) {
            const data = await res.json().catch(() => ({ error: 'unknown' }))
            if (res.status === 410 || res.status === 404) {
              renderEndedPage(page, new ApiError(res.status, String(data.error), data))
              return
            }
            if (res.status === 503) {
              alertRegion.hidden = false
              setAlert(alertRegion, 'The readings file is unavailable while evidence storage is unreachable. Try again in a few minutes.')
              return
            }
            if (res.status === 409) {
              alertRegion.hidden = false
              setAlert(alertRegion, 'The stored readings file does not match this figure\'s fingerprint.')
              return
            }
            alertRegion.hidden = false
            setAlert(alertRegion, 'The readings file is unavailable right now. Try again in a few minutes.')
            return
          }
          const blob = await res.blob()
          const disposition = res.headers.get('Content-Disposition') ?? ''
          const nameMatch = /filename="([^"]+)"/.exec(disposition)
          const name = nameMatch ? nameMatch[1]! : `${f.id}-readings.csv`
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = name
          document.body.append(a)
          a.click()
          a.remove()
          URL.revokeObjectURL(url)
        } catch {
          alertRegion.hidden = false
          setAlert(alertRegion, 'The readings file is unavailable right now. Try again in a few minutes.')
        } finally {
          download.disabled = false
        }
      },
    }) as HTMLButtonElement
    actions.append(rederive, auditLink, download)
    body.append(actions)
  }

  function verdict(d: PublicBody): string {
    const f = d.figure
    if (f.status === 'superseded') return 'Superseded.'
    if (f.status === 'broken') return 'Broken.'
    return 'Intact.'
  }
}

function renderEndedPage(page: HTMLElement, err: unknown, alertRegion?: HTMLElement): void {
  clear(page)
  if (err instanceof ApiError) {
    if (err.code === 'link_expired') {
      page.append(el('h1', { class: 'public-heading', text: 'This link has expired' }))
      page.append(el('p', { text: 'Ask the project team for a new link.' }))
      return
    }
    if (err.code === 'link_revoked') {
      page.append(el('h1', { class: 'public-heading', text: 'This link was revoked' }))
      page.append(el('p', { text: 'The project team withdrew this link.' }))
      return
    }
  }
  page.append(el('h1', { class: 'public-heading', text: 'No sealed figure is published at this link' }))
  page.append(el('p', { text: 'Check the address you were given.' }))
}
