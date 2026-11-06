import {
  api, type Person, type Figure, type LinkRow, ApiError,
} from '../api.js'
import { el, clear, announce, setAlert } from '../ui.js'
import { displayInterval, displayChecked, displayExpiry, signedTonnes } from '../format.js'

export async function renderFigure(
  main: HTMLElement, figureId: string, slug: string, me: Person,
): Promise<void> {
  clear(main)
  const wrap = el('div', { class: 'single-column' })
  main.append(wrap)

  const banner = el('div', { class: 'broken-banner', role: 'alert', hidden: true })
  wrap.append(banner)

  const alertRegion = el('div', { role: 'alert', class: 'alert', hidden: true })
  const statusRegion = el('p', { class: 'status-live', role: 'status', 'aria-label': 'Figure status' })
  wrap.append(alertRegion, statusRegion)

  let figure: Figure | null = null
  let lastStatus: string | null = null
  let sheetBroken = false

  async function load(): Promise<void> {
    try {
      figure = await api<Figure>('GET', `/api/figures/${figureId}`)
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        wrap.textContent = ''
        wrap.append(el('p', { text: 'This figure is no longer available.' }))
        return
      }
      throw err
    }
    paint()
  }

  async function paint(): Promise<void> {
    const f = figure!
    const heading = el('h1', { text: `Figure ${f.id}` })
    const statusLine = el('p', { class: 'meta' })
    const statusText = f.status.charAt(0).toUpperCase() + f.status.slice(1)
    statusLine.append(`Status: ${statusText}`)
    if (f.status === 'superseded' && f.superseded_by) {
      statusLine.append(document.createTextNode(' · Superseded by '))
      statusLine.append(el('a', { href: `/projects/${slug}/figures/${f.superseded_by}`, text: f.superseded_by }))
    }
    const facts = el('dl', { class: 'figure-facts' })
    const row = (t: string, v: string): void => {
      facts.append(el('dt', { text: t }), el('dd', { text: v }))
    }
    row('Checked at', displayChecked(f.checked_at))
    row('Interval', `${displayInterval(f.start)} to ${displayInterval(f.end)}`)
    row('Sensors', f.sensor_ids.join(', '))
    row('Coverage', `${f.coverage_pct}% (floor ${f.floor_pct}%)`)
    row('Net tCO2e', signedTonnes(f.net_tco2e))
    row('CO2 tCO2e', f.co2_tco2e)
    row('CH4 tCO2e', f.ch4_tco2e)
    row('Buffer tCO2e', f.buffer_tco2e)
    row('Credited tCO2e', f.credited_tco2e)
    row('Readings', String(f.readings_count))
    row('Fingerprint', f.fingerprint)

    const breakdown = el('table', { 'aria-label': 'Unit breakdown' })
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
    breakdown.append(thead, tbody)

    const workspaceUrl = `/projects/${slug}?from=${f.start.slice(0, 10)}&to=${f.end.slice(0, 10)}`
    const links = el('p', { class: 'figure-actions' })
    links.append(
      el('a', { class: 'btn', href: workspaceUrl, text: 'Open interval in workspace' }),
      el('a', { class: 'btn', href: `/projects/${slug}/figures/${f.id}/audit`, text: 'Readings audit trail' }),
    )

    const body = el('div')
    body.append(heading, statusLine, facts, el('h2', { text: 'Unit breakdown' }), el('div', { class: 'table-scroll card-table' }, breakdown), links)

    if (f.status === 'broken' && !sheetBroken) {
      sheetBroken = true
      try {
        const moved = await api<{ moved: unknown[] }>('GET', `/api/figures/${f.id}/audit`)
        banner.hidden = false
        setAlert(banner, `Seal broken. Readings moved since sealing: ${moved.moved.length}. Its tonnes have been reversed in the ledger.`)
      } catch { /* banner without the count */ }
    }
    if (f.status !== 'broken') banner.hidden = true

    clear(wrap)
    wrap.append(banner, alertRegion, statusRegion, body)

    // regulator links for sealers
    if (f.status === 'sealed') {
      const canIssue = f.status === 'sealed'
      const section = el('section', { class: 'panel' })
      section.append(el('h2', { text: 'Regulator links' }))
      const issueRow = el('div', { class: 'figure-actions' })
      const issueBtn = el('button', {
        text: 'Issue regulator link', disabled: !canIssue,
        onclick: async () => {
          issueBtn.disabled = true
          try {
            const link = await api<LinkRow>('POST', `/api/figures/${f.id}/links`, {})
            announce(statusRegion, `Regulator link issued. It expires ${displayExpiry(link.expires_at)}.`)
            linkBox.value = link.url
            linkBox.hidden = false
            copyBtn.hidden = false
            copyBtn.focus()
            await refreshLinks()
          } catch (err) {
            if (err instanceof ApiError && err.status === 409) {
              announce(statusRegion, 'Only an intact sealed figure can have a regulator link.')
            } else {
              announce(statusRegion, 'Could not issue a link right now. Try again in a few minutes.')
            }
          } finally {
            issueBtn.disabled = false
          }
        },
      }) as HTMLButtonElement
      const linkBox = el('input', {
        type: 'text', readonly: true, 'aria-label': 'Regulator link', hidden: true,
        class: 'num',
      }) as HTMLInputElement
      const copyBtn = el('button', {
        text: 'Copy link', hidden: true,
        onclick: async () => {
          await navigator.clipboard.writeText(linkBox.value)
        },
      }) as HTMLButtonElement
      issueRow.append(issueBtn, linkBox, copyBtn)
      const linksHost = el('div', { class: 'table-scroll' })
      section.append(issueRow, linksHost)
      wrap.append(section)

      async function refreshLinks(): Promise<void> {
        try {
          const res = await api<{ links: (LinkRow & { revoked_at?: string | null })[] }>('GET', `/api/figures/${f.id}/links`)
          clear(linksHost)
          if (res.links.length === 0) return
          const table = el('table', { 'aria-label': 'Regulator links' })
          const thead2 = el('thead')
          const hr2 = el('tr')
          for (const c of ['Link', 'Status', 'Issued', 'Expires']) hr2.append(el('th', { text: c }))
          thead2.append(hr2)
          const tbody2 = el('tbody')
          for (const l of res.links) {
            const tr = el('tr')
            const tdLink = el('td', { class: 'num' })
            tdLink.textContent = `…${l.token.slice(-6)}`
            tr.append(
              tdLink,
              el('td', { text: l.status.charAt(0).toUpperCase() + l.status.slice(1) }),
              el('td', { class: 'num', text: displayExpiry(l.issued_at) }),
              el('td', { class: 'num', text: displayExpiry(l.expires_at) }),
            )
            if (l.status === 'live') {
              const tdAction = el('td')
              const revoke = el('button', {
                text: `Revoke link ending ${l.token.slice(-6)}`,
                onclick: async () => {
                  revoke.disabled = true
                  try {
                    await api('POST', `/api/figures/${f.id}/links/${l.id}/revoke`, {})
                    announce(statusRegion, 'Link revoked.')
                    await refreshLinks()
                  } catch (err) {
                    revoke.disabled = false
                    if (err instanceof ApiError && err.code === 'link_expired') {
                      announce(statusRegion, 'This link has already expired.')
                    } else if (err instanceof ApiError && err.code === 'link_revoked') {
                      announce(statusRegion, 'Link revoked.')
                    } else {
                      announce(statusRegion, 'Could not revoke the link right now. Try again.')
                    }
                    await refreshLinks()
                  }
                },
              }) as HTMLButtonElement
              tdAction.append(revoke)
              tr.append(tdAction)
            }
            tbody2.append(tr)
          }
          table.append(thead2, tbody2)
          linksHost.append(table)
        } catch { /* keep previous table */ }
      }
      await refreshLinks()
    }
    // announcements for status changes seen on refresh
    if (lastStatus !== null && lastStatus !== f.status) {
      if (f.status === 'superseded' && f.superseded_by) {
        announce(statusRegion, `Superseded by ${f.superseded_by}.`)
      } else if (f.status === 'broken') {
        // banner already shown
      }
    }
    lastStatus = f.status
  }

  await load()

  const timer = setInterval(() => {
    if (document.visibilityState === 'hidden') return
    if (!main.isConnected) { clearInterval(timer); return }
    void load()
  }, 15000)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && main.isConnected) void load()
  })
}
