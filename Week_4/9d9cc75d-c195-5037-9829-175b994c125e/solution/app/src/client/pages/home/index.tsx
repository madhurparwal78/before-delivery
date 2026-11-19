import { LinkButton } from '../../ui/button.tsx';
import { Sticker } from '../../ui/sticker.tsx';
import { SampleView } from './sample-view.tsx';
import './home.css';

export function HomePage() {
  return (
    <div className="home">
      <Sticker kind="pill" className="home-sticker home-sticker-a" />
      <Sticker kind="sum" className="home-sticker home-sticker-b" />
      <Sticker kind="blob" className="home-sticker home-sticker-c" />
      <Sticker kind="at" className="home-sticker home-sticker-d" />
      <h1 className="hero">
        <span className="hero-grey">Charts you</span> <span className="hero-ink">can explain.</span>
      </h1>
      <section className="card sample-sheet" aria-label="Sample sheet">
        <p className="sample-caption">SUM(Sales) by Region, Fernhollow Tea</p>
        <SampleView />
      </section>
      <LinkButton to="/workbooks" big>
        Open a workbook
      </LinkButton>
    </div>
  );
}
