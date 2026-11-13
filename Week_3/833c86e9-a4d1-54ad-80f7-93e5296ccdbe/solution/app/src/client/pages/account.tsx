import { useState } from 'react'
import '../styles/account.css'
import { post } from '../api'
import { useSignedIn } from '../components/guard'
import { PageTitle } from '../components/page-title'
import { announce } from '../live'
import { Link, navigate } from '../router'
import { useApp } from '../state'
import { Button } from '../ui'

/** The account page: loyalty tier and perks (live), the properties the user manages, and sign-out everywhere. */
export function AccountPage() {
  const app = useApp()
  const signedIn = useSignedIn()
  const [busy, setBusy] = useState(false)
  if (!signedIn || !app.me?.user) return null
  const { user } = app.me

  const leave = async (): Promise<void> => {
    setBusy(true)
    await post('/api/signout-everywhere')
    await app.refreshMe()
    announce('toast', app.t('signed.out'))
    navigate('/signin', { replace: true })
  }

  return (
    <div className="plain-page account">
      <PageTitle>{user.username}</PageTitle>
      <section aria-label={app.t('ui.loyalty')} className="loyalty sage-field">
        <h2>{app.t('ui.loyalty')}</h2>
        <p className="loyalty-line">{app.t('loyalty.line', { tier: app.me.tier, 'count:stay': app.me.completed_stays })}</p>
        <ul className="perks">
          {app.me.perks.map((perk) => <li key={perk}>{app.t(perk)}</li>)}
        </ul>
      </section>
      {user.manages.length > 0 && (
        <section className="properties" aria-label={app.t('ui.forProperties')}>
          <h2>{app.t('ui.forProperties')}</h2>
          <ul>
            {user.manages.map((code) => <li key={code}><Link to={`/manage/${code}/calendar`}>{code}</Link></li>)}
          </ul>
        </section>
      )}
      <div className="btn-row">
        <Button busy={busy} onClick={() => void leave()}>{app.t('ui.signOutEverywhere')}</Button>
      </div>
    </div>
  )
}
