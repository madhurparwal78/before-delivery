import { type ReactNode } from 'react'
import type { Currency } from '../../shared/i18n'
import { useApp } from '../state'
import { Money } from '../ui'

/** A published sentence whose `{amount}` is a Money element (so the figure carries data-minor and data-currency). */
export function AmountSentence({ id, minor, currency = 'EUR', className }: { id: string; minor: number; currency?: Currency; className?: string }): ReactNode {
  const app = useApp()
  const [before, after] = app.t(id).split('{amount}')
  return <p className={className}>{before}<Money minor={minor} currency={currency} />{after}</p>
}
