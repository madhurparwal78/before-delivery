import { extendMessages } from '../../shared/i18n'
import { useApp } from '../state'

extendMessages({
  'x.stars': ['{n} stars', '{n} Sterne', '{n} نجوم'],
  'x.score': ['Score {n}', 'Bewertung {n}', 'التقييم {n}'],
  'x.distance': ['{n} km', '{n} km', '{n} كم'],
})

/** The star count, score and distance of a property as three short facts. */
export function Facts({ stars, score, distanceKm }: { stars: number; score: number; distanceKm: number }) {
  const app = useApp()
  return (
    <>
      <span>{app.t('x.stars', { n: stars })}</span>
      <span>{app.t('x.score', { n: app.fmt.num1(score, app.lang) })}</span>
      <span>{app.t('x.distance', { n: app.fmt.num1(distanceKm, app.lang) })}</span>
    </>
  )
}
