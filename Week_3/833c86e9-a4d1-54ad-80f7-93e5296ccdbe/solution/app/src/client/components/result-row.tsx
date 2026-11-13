import type { SearchResult } from '../../shared/types'
import { Link } from '../router'
import { useApp } from '../state'
import { Money, Tag } from '../ui'
import { Facts } from './facts'

/** One result: name on the start side, the all-in total on the end side, small facts under the name. No picture. */
export function ResultRow({ result, href, selected, perNight, onShow }: { result: SearchResult; href: string; selected: boolean; perNight: boolean; onShow: () => void }) {
  const app = useApp()
  const score = app.fmt.num1(result.score, app.lang)
  const distance = app.fmt.num1(result.distance_km, app.lang)
  const label = app.t('ui.rowLabel', {
    name: result.name, stars: result.stars, score, distance, amount: app.money(result.display_minor, result.display_currency),
  })
  return (
    <article id={`row-${result.code}`} className="row" aria-label={label} aria-current={selected ? 'true' : undefined}>
      <div className="row-main">
        <Link to={href} className="row-name" data-focus-key={`row-${result.code}`}>{result.name}</Link>
        <p className="row-facts muted">
          <Facts stars={result.stars} score={result.score} distanceKm={result.distance_km} />
        </p>
        <div className="row-actions">
          {result.refundable && <Tag kind="sage">{app.t('ui.refundable')}</Tag>}
          <button type="button" className="row-map" aria-label={app.t('ui.showOnMap', { name: result.name })} data-focus-key={`show-${result.code}`} onClick={onShow}>
            {app.t('ui.map')}
          </button>
        </div>
      </div>
      <p className="row-total">
        <Money minor={result.display_minor} currency={result.display_currency} className="total" />
        {perNight && <span className="muted">{app.t('ui.perNightShort')}</span>}
      </p>
    </article>
  )
}
