import { Harbour } from '../components/harbour'
import { Link } from '../router'
import { useApp } from '../state'

export function HomePage() {
  const app = useApp()
  return (
    <div className="home">
      <section className="hero" aria-labelledby="hero-word">
        <p id="hero-word" className="hero-word" aria-label={app.t('hero.word')}>{app.t('hero.word')}</p>
        <div className="hero-copy">
          <p className="hero-sentence">{app.t('hero.sentence')}</p>
          <Link to="/search" className="btn btn-accent">{app.t('ui.searchStays')}</Link>
        </div>
      </section>
      <section className="layers">
        {[1, 2, 3, 4, 5].map((n) => <p key={n} className="layer" style={{ marginInlineStart: `${(n % 3) * 9}vw` }}>{app.t(`home.layer${n}`)}</p>)}
      </section>
      <section className="cancel-field">
        <p className="cancel-text">{app.t('home.cancel')}</p>
      </section>
      <section className="numerals">
        <div><p className="numeral">{app.t('home.commission.figure')}</p><p>{app.t('home.commission')}</p></div>
        <div className="numeral-late"><p className="numeral">{app.t('home.reviews.figure')}</p><p>{app.t('home.reviews')}</p></div>
      </section>
      <section className="harbour-band"><Harbour label={app.t('ui.harbour')} /></section>
    </div>
  )
}
