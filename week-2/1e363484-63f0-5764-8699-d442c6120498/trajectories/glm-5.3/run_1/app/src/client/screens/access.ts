import { api, ApiError } from '../api.js'
import { el, clear, announce, setAlert } from '../ui.js'

type PersonRow = { id: string; name: string; email: string; org_role: string }
type AccessData = {
  people: PersonRow[]
  projects: { slug: string; name: string }[]
  grants: { person_id: string; project: string; role: string }[]
}

export async function renderAccess(main: HTMLElement): Promise<void> {
  clear(main)
  const wrap = el('div', { class: 'single-column' })
  main.append(wrap)
  wrap.append(el('h1', { text: 'Access' }))
  const alertRegion = el('div', { role: 'alert', class: 'alert', hidden: true })
  const statusRegion = el('p', { class: 'status-live', role: 'status', 'aria-label': 'Access status' })
  wrap.append(alertRegion, statusRegion)

  let data: AccessData
  try {
    data = await api<AccessData>('GET', '/api/access')
  } catch {
    wrap.append(el('p', { text: 'The access grid is unavailable right now. Try again in a few minutes.' }))
    return
  }

  const grantOf = (personId: string, slug: string): string =>
    data.grants.find((g) => g.person_id === personId && g.project === slug)?.role ?? 'none'

  const table = el('table', { 'aria-label': 'Access', class: 'access-table card-table' })
  const thead = el('thead')
  const hr = el('tr')
  hr.append(el('th', { text: 'Person' }))
  for (const p of data.projects) hr.append(el('th', { text: p.name }))
  thead.append(hr)
  const tbody = el('tbody')
  for (const person of data.people) {
    const tr = el('tr')
    const tdName = el('td')
    tdName.append(el('div', { text: person.name }))
    tdName.append(el('div', { class: 'meta', text: `${person.email} · ${person.org_role}` }))
    tr.append(tdName)
    for (const proj of data.projects) {
      const td = el('td')
      const current = grantOf(person.id, proj.slug)
      const sel = el('select', { 'aria-label': `${person.name} on ${proj.name}` }) as HTMLSelectElement
      for (const [value, label] of [
        ['none', 'No access'], ['viewer', 'Viewer'], ['analyst', 'Analyst'], ['sealer', 'Sealer'],
      ] as [string, string][]) {
        const opt = el('option', { value, text: label })
        if (value === current) opt.setAttribute('selected', '')
        sel.append(opt)
      }
      sel.addEventListener('change', async () => {
        const role = sel.value
        try {
          if (role === 'none') {
            await api('DELETE', `/api/projects/${proj.slug}/grants/${person.id}`)
          } else {
            const res = await api<{ role: string }>('PUT', `/api/projects/${proj.slug}/grants/${person.id}`, { role })
            announce(statusRegion, `Saved access for ${person.name} on ${proj.name}: ${labelOf(res.role)}.`)
          }
          // refresh the underlying grant table for later saves
          data = await api<AccessData>('GET', '/api/access')
        } catch (err) {
          sel.value = grantOf(person.id, proj.slug) === 'none' ? 'none' : grantOf(person.id, proj.slug)
          alertRegion.hidden = false
          setAlert(alertRegion, 'Access was not changed. Try again.')
        }
      })
      td.append(sel)
      tr.append(td)
    }
    tbody.append(tr)
  }
  table.append(thead, tbody)
  wrap.append(el('div', { class: 'table-scroll' }, table))
}

function labelOf(role: string): string {
  switch (role) {
    case 'viewer': return 'Viewer'
    case 'analyst': return 'Analyst'
    case 'sealer': return 'Sealer'
    default: return 'No access'
  }
}
