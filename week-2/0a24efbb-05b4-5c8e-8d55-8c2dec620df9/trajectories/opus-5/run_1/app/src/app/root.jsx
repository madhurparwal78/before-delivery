import { feedback, ui } from '../shared/copy.js';
import { BareBanner, Footer, SharedFooter, TopBar } from './components/Chrome.jsx';
import { LiveRegions } from './components/LiveRegions.jsx';
import { useShell } from './deskData.jsx';

function Banner({ shell }) {
  if (shell.variant === 'desk') return <TopBar caller={shell.caller} breadcrumb={shell.breadcrumb} />;
  return <BareBanner />;
}

function FooterFor({ shell }) {
  if (shell.variant === 'shared') return <SharedFooter />;
  return <Footer policyVersion={shell.policyVersion} />;
}

export function Shell({ children }) {
  const shell = useShell();
  return (
    <div className={`page page-${shell.variant}`}>
      <Banner shell={shell} />
      <main id="main" className={`main main-${shell.layout}`}>
        {children}
      </main>
      <FooterFor shell={shell} />
      <LiveRegions initialPolite={shell.announcement} />
    </div>
  );
}

const ANSWERS = {
  notFound: { heading: feedback.notFoundHeading, body: feedback.notFoundBody },
  gone: { heading: feedback.goneHeading, body: feedback.goneBody },
  wrongRole: { heading: feedback.wrongRole },
  badQuery: { heading: feedback.badQuery, link: { href: '/requests', label: ui.clearFilters } },
};

/** The product's own page answers: not found, no longer available, wrong role and bad query. */
export function AnswerPage({ kind, shell }) {
  const answer = ANSWERS[kind];
  return (
    <div className={`page page-${shell.variant}`}>
      <Banner shell={shell} />
      <main id="main" className="main main-single">
        <section className="answer">
          <h1>{answer.heading}</h1>
          {answer.body ? <p>{answer.body}</p> : null}
          {answer.link ? <a href={answer.link.href}>{answer.link.label}</a> : null}
        </section>
      </main>
      <FooterFor shell={shell} />
    </div>
  );
}
