import { useCallback, useEffect, useState } from 'react'
import '../styles/account.css'
import { get } from '../api'
import { PageTitle } from '../components/page-title'
import { useLive } from '../live'
import { Link } from '../router'
import { useApp } from '../state'

const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone

interface Message { id: number; at: string; kind: string; property: string; link: string }

/** The inbox: review invitations, newest first. */
export function InboxPage() {
  const app = useApp()
  const [messages, setMessages] = useState<Message[] | null>(null)
  const load = useCallback(() => void get<Message[]>('/api/inbox').then(setMessages), [])
  useEffect(load, [load])
  useLive('clock', load)

  return (
    <div className="plain-page">
      <PageTitle>{app.t('ui.inbox')}</PageTitle>
      <section aria-label={app.t('ui.inbox')} className="inbox">
        {messages && !messages.length && <p className="lead">{app.t('inbox.empty')}</p>}
        <ul>
          {messages?.map((message) => (
            <li key={message.id}>
              <Link to={message.link} className="message-link">{app.t('ui.reviewYourStay', { 'property name': message.property })}</Link>
              <span className="muted">{app.fmt.moment(message.at, browserZone, app.lang)}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
