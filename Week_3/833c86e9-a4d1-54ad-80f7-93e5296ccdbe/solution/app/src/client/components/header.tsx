import { useEffect, useState } from 'react'
import { CURRENCIES, LANGS, type Lang } from '../../shared/i18n'
import { useApp } from '../state'
import { Link } from '../router'

const NAMES: Record<Lang, string> = { en: 'English', de: 'Deutsch', ar: 'العربية' }

/** A header select, named in the page's language. */
function Preference<T extends string>({ id, label, value, options, names, choose }: { id: string; label: string; value: T; options: readonly T[]; names?: Record<T, string>; choose: (next: T) => Promise<void> }) {
  /* The picked option stays shown while the server stores it. */
  const [picked, setPicked] = useState(value)
  useEffect(() => setPicked(value), [value])
  return (
    <select
      aria-label={label} data-focus-key={id} className="select" value={picked}
      onChange={(event) => {
        const next = event.target.value as T
        setPicked(next)
        choose(next).catch(() => setPicked(value))
      }}
    >
      {options.map((option) => <option key={option} value={option}>{names?.[option] ?? option}</option>)}
    </select>
  )
}

export function Header() {
  const app = useApp()
  const manage = app.me?.user?.manages[0]
  return (
    <header className="site-header">
      <Link to="/" className="wordmark" data-focus-key="wordmark">KIPWELL</Link>
      <nav className="header-links">
        <Link to="/search" data-focus-key="destinations">{app.t('ui.destinations')}</Link>
        <Link to={manage ? `/manage/${manage}/calendar` : '/signin'} data-focus-key="properties">{app.t('ui.forProperties')}</Link>
        <Link to="/inbox" data-focus-key="inbox">{app.t('ui.inbox')}</Link>
      </nav>
      <div className="header-selects">
        <Preference id="language" label={app.t('ui.language')} value={app.lang} options={LANGS} names={NAMES} choose={app.chooseLang} />
        <Preference id="currency" label={app.t('ui.currency')} value={app.cur} options={CURRENCIES} choose={app.chooseCur} />
      </div>
      {app.me?.user ? <Link to="/account" className="account-link" data-focus-key="account">{app.me.user.username}</Link> : <Link to="/signin" className="account-link" data-focus-key="account">{app.t('ui.signIn')}</Link>}
    </header>
  )
}
