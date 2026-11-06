import { api, type Person, type ProjectListEntry } from '../api.js'
import { el, clear, setAlert } from '../ui.js'

export type ProjectsMessage = { kind: 'lost-access' } | null

export async function renderProjects(
  main: HTMLElement, me: Person, message: ProjectsMessage,
): Promise<void> {
  clear(main)
  const alert = el('div', { role: 'alert', class: 'alert', hidden: true })
  if (message?.kind === 'lost-access') {
    alert.hidden = false
    setAlert(alert, 'You no longer have access to this project.')
  }

  const list = await api<{ projects: ProjectListEntry[] }>('GET', '/api/projects')

  const h = el('h1', { text: 'Projects' })
  const table = el('table', { 'aria-label': 'Projects' })
  const thead = el('thead')
  const headRow = el('tr')
  for (const c of ['Project', 'Kind', 'Sealed net tCO2e', 'Buffer tCO2e', 'Intact', 'Broken', 'Superseded']) {
    headRow.append(el('th', { text: c }))
  }
  thead.append(headRow)
  const tbody = el('tbody')
  for (const p of list.projects) {
    const tr = el('tr')
    const nameTd = el('td')
    nameTd.append(el('a', { href: `/projects/${p.slug}`, text: p.name }))
    tr.append(
      nameTd,
      el('td', { text: p.kind }),
      el('td', { class: 'num', text: p.summary.sealed_net_tco2e }),
      el('td', { class: 'num', text: p.summary.buffer_tco2e }),
      el('td', { class: 'num', text: String(p.summary.intact_count) }),
      el('td', { class: 'num', text: String(p.summary.broken_count) }),
      el('td', { class: 'num', text: String(p.summary.superseded_count) }),
    )
    tbody.append(tr)
  }
  table.append(thead, tbody)

  const wrap = el('div', { class: 'panel' })
  wrap.append(h, el('div', { class: 'table-scroll card-table' }, table))
  main.append(alert, wrap)

  // refresh the list while the tab is visible
  const timer = setInterval(() => {
    if (document.visibilityState === 'hidden') return
    void refresh()
  }, 15000)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void refresh()
  }, { once: false })
  const refresh = async (): Promise<void> => {
    if (!main.isConnected) { clearInterval(timer); return }
    try {
      const fresh = await api<{ projects: ProjectListEntry[] }>('GET', '/api/projects')
      if (!main.isConnected) return
      const freshTable = el('table', { 'aria-label': 'Projects' })
      const thead2 = el('thead')
      const headRow2 = el('tr')
      for (const c of ['Project', 'Kind', 'Sealed net tCO2e', 'Buffer tCO2e', 'Intact', 'Broken', 'Superseded']) {
        headRow2.append(el('th', { text: c }))
      }
      thead2.append(headRow2)
      const tbody2 = el('tbody')
      for (const p of fresh.projects) {
        const tr = el('tr')
        const nameTd = el('td')
        nameTd.append(el('a', { href: `/projects/${p.slug}`, text: p.name }))
        tr.append(
          nameTd,
          el('td', { text: p.kind }),
          el('td', { class: 'num', text: p.summary.sealed_net_tco2e }),
          el('td', { class: 'num', text: p.summary.buffer_tco2e }),
          el('td', { class: 'num', text: String(p.summary.intact_count) }),
          el('td', { class: 'num', text: String(p.summary.broken_count) }),
          el('td', { class: 'num', text: String(p.summary.superseded_count) }),
        )
        tbody2.append(tr)
      }
      freshTable.append(thead2, tbody2)
      const holder = wrap.querySelector('.table-scroll')!
      clear(holder)
      holder.append(freshTable)
    } catch { /* keep the previous list */ }
  }
}
