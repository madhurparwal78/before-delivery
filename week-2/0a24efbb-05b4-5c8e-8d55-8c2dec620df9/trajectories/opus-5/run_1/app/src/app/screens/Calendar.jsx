import { useRef, useState } from 'react';
import { usePage } from '../deskData.jsx';
import { addMonths, businessStamp } from '../../shared/businessTime.js';
import { feedback, ui } from '../../shared/copy.js';
import { call, isEndedSession, refusalWording } from '../api.js';
import { announce } from '../announce.js';
import { Icon } from '../components/Icon.jsx';
import { MonthGrid, MonthLegend } from '../components/MonthGrid.jsx';

function monthHref(month, person) {
  const params = new URLSearchParams();
  params.set('month', month);
  if (person) params.set('person', person);
  return `/calendar?${params}`;
}

export function CalendarScreen() {
  const page = usePage();
  const [person, setPerson] = useState(page.person);
  const [link, setLink] = useState(null);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState(null);
  const shareRef = useRef(null);
  const linkRef = useRef(null);

  const narrowed = page.people.find((candidate) => candidate.work_address === page.person) ?? null;

  const mint = async () => {
    setBusy(true);
    setRefusal(null);
    announce.polite(feedback.creatingLink);
    const answer = await call('POST', '/api/share-links', {
      body: { person_id: narrowed.id, month: page.month },
    });
    setBusy(false);
    if (answer.status === 201) {
      setLink(answer.body);
      announce.assertive(feedback.linkCreated(businessStamp(answer.body.expires_at)));
      requestAnimationFrame(() => {
        linkRef.current?.focus();
        linkRef.current?.select();
      });
      return;
    }
    const wording = refusalWording(answer);
    announce.assertive(wording);
    setRefusal({ wording, ended: isEndedSession(answer) });
  };

  const revoke = async () => {
    setBusy(true);
    setRefusal(null);
    announce.polite(feedback.revokingLink);
    const answer = await call('DELETE', `/api/share-links/${link.id}`);
    setBusy(false);
    if (answer.status === 204) {
      setLink(null);
      announce.assertive(feedback.linkRevoked);
      requestAnimationFrame(() => shareRef.current?.focus());
      return;
    }
    const wording = refusalWording(answer);
    announce.assertive(wording);
    setRefusal({ wording, ended: isEndedSession(answer) });
    if (answer.status === 409) setLink(null);
  };

  return (
    <section className="calendar-panel">
      <h1>{ui.calendarHeading}</h1>

      <div className="month-steps">
        <a href={monthHref(addMonths(page.month, -1), page.person)}>{ui.previousMonth}</a>
        <a href={monthHref(addMonths(page.month, 1), page.person)}>{ui.nextMonth}</a>
      </div>

      <form className="calendar-controls" method="get" action="/calendar">
        <input type="hidden" name="month" value={page.month} />
        <div className="field inline">
          <label htmlFor="calendar-person">{ui.personFilter}</label>
          <select
            id="calendar-person"
            name="person"
            value={person}
            onChange={(event) => {
              setPerson(event.target.value);
              setLink(null);
            }}
          >
            <option value="">{ui.everyoneInScope}</option>
            {page.people.map((candidate) => (
              <option key={candidate.work_address} value={candidate.work_address}>
                {candidate.name}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="button primary">
          {ui.show}
        </button>
        {narrowed && page.canShare ? (
          <button type="button" className="button outline" ref={shareRef} disabled={busy} onClick={mint}>
            <Icon name="link" />
            {ui.share}
          </button>
        ) : null}
      </form>

      {link ? (
        <div className="shared-link">
          <div className="field">
            <label htmlFor="shared-link-field">{ui.sharedLink}</label>
            <input
              id="shared-link-field"
              type="text"
              readOnly
              ref={linkRef}
              value={`${page.publicUrl}/share/${link.token}`}
            />
          </div>
          <button type="button" className="button outline" disabled={busy} onClick={revoke}>
            {ui.revoke}
          </button>
        </div>
      ) : null}

      {refusal ? (
        <p className="refusal">
          {refusal.wording}{' '}
          {refusal.ended ? (
            <a href={`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`}>
              {ui.signInAgain}
            </a>
          ) : null}
        </p>
      ) : null}

      <MonthGrid month={page.month} days={page.days} />
      <MonthLegend />
    </section>
  );
}
