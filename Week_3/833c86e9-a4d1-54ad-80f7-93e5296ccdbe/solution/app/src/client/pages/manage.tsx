import { useCallback, useEffect, useState } from 'react'
import '../styles/manage.css'
import { ApiFailure, get } from '../api'
import { CalendarGrid } from '../components/calendar-grid'
import { useSignedIn } from '../components/guard'
import { ImportForm } from '../components/import-form'
import { Reservations, Statements } from '../components/manage-tables'
import { PageTitle } from '../components/page-title'
import { Link } from '../router'
import { useApp } from '../state'
import { NotFound } from '../app'

const TABS = [['calendar', 'ui.manageCalendar'], ['reservations', 'ui.manageReservations'], ['import', 'ui.manageImport'], ['statements', 'ui.manageStatements']] as const

/** Manager pages: a navigation row, then the calendar, reservations, import or statements for one property. */
export function ManagePage({ params }: { params: string[] }) {
  const app = useApp()
  const signedIn = useSignedIn()
  const [code, tab] = params
  const [property, setProperty] = useState<{ name: string; zone: string } | null>(null)
  const [missing, setMissing] = useState(false)
  const onMissing = useCallback(() => setMissing(true), [])

  useEffect(() => {
    if (!signedIn) return
    get<{ name: string; zone: string }>(`/api/properties/${code}`).then(setProperty, (error) => {
      if (error instanceof ApiFailure && error.status === 404) onMissing()
      else throw error
    })
  }, [signedIn, code, onMissing])

  if (!signedIn) return null
  if (missing) return <NotFound />
  if (!property) return null

  const view = { code, zone: property.zone, onMissing }
  return (
    <div className="manage">
      <header className="manage-head">
        <PageTitle>{property.name}</PageTitle>
        <nav aria-label={app.t('ui.manageNav')} className="manage-nav">
          {TABS.map(([name, label]) => <Link key={name} to={`/manage/${code}/${name}`} aria-current={name === tab ? 'page' : undefined}>{app.t(label)}</Link>)}
        </nav>
      </header>
      {tab === 'calendar' && <CalendarGrid {...view} />}
      {tab === 'reservations' && <Reservations {...view} />}
      {tab === 'import' && <ImportForm code={code} onMissing={onMissing} />}
      {tab === 'statements' && <Statements {...view} />}
    </div>
  )
}
