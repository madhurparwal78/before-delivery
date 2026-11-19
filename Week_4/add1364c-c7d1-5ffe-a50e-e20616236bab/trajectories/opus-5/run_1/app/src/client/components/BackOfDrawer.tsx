import { useCallback, useEffect, useState } from 'react';
import type { AuditPage, Clock } from '../api.js';
import { call } from '../guard.js';
import { officeStamp } from '../format.js';
import { useLive } from '../live.js';
import { DrawerLink } from '../router.js';

export function AuditRows(props: { entries: AuditPage['entries'] }): React.ReactElement {
  return (
    <div className="audit-sheet">
      {props.entries.map((entry) => (
        <div className="audit-row" key={entry.id}>
          <span className="stamp">{officeStamp(entry.office_day, entry.office_time, entry.offset)}</span>
          <span>{'system' in entry.actor ? entry.actor.system : entry.actor.name}</span>
          <span>{entry.action}</span>
          <span>{entry.subject.name}</span>
        </div>
      ))}
    </div>
  );
}

/** The newest ten entries of the office day, uncovered as the page scrolls to its end. */
export function BackOfDrawer(props: {
  clock: Clock;
  nodeRef: React.RefObject<HTMLElement | null>;
}): React.ReactElement {
  const [entries, setEntries] = useState<AuditPage['entries']>([]);
  const day = props.clock.office_date;

  const load = useCallback(() => {
    void call<AuditPage>(`/api/audit?day=${day}&order=newest&limit=10`)
      .then((page) => setEntries(page.entries))
      .catch(() => undefined);
  }, [day]);

  useEffect(load, [load]);
  useLive('rule-in-force', load);
  useLive('billing-changed', load);
  useLive('review-changed', load);
  useLive('access-changed', load);

  return (
    <footer
      className="back-of-drawer"
      ref={props.nodeRef}
      style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 0 }}
    >
      <h2>Back of the drawer</h2>
      <AuditRows entries={entries} />
      <p>
        <DrawerLink to={`/audit?day=${day}`}>Audit trail</DrawerLink>
      </p>
    </footer>
  );
}
