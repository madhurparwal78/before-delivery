import { useState } from 'react';
import { NO_ISSUES, withUser } from '../../shared/copy.ts';
import { MINIMUM_ROLE, atLeast } from '../../shared/rules.ts';
import type { Issue, IssueState, Rfi, RfiState, Role } from '../../shared/types.ts';
import { sendJson } from '../api.ts';
import { toastRefusal } from '../toastRefusal.ts';
import { Button } from '../ui/index.ts';
import { useReviewData } from './reviewData.tsx';

const ISSUE_STATE_LABEL: Record<IssueState, string> = { open: 'Open', answered: 'Answered', closed: 'Closed' };
const RFI_STATE_LABEL: Record<RfiState, string> = { draft: 'Draft', sent: 'Sent', answered: 'Answered', closed: 'Closed' };

/** Posts a transition; a refusal is shown as a toast with the server's sentence. */
function transition<T>(path: string, body: Record<string, string>, accept: (result: T) => void): Promise<void> {
  return toastRefusal(async () => accept(await sendJson<T>('POST', path, body)));
}

/** The RFI with its four transition buttons, in every state: only the ball in court moves it, and the server says who that is. */
function RfiArticle({ rfi }: { rfi: Rfi }) {
  const data = useReviewData();
  const [answer, setAnswer] = useState('');
  const move = (to: RfiState, extra: Record<string, string> = {}): Promise<void> =>
    transition<Rfi>(`/api/rfis/${rfi.id}/transitions`, { to, ...extra }, (changed) => data.addRfi(changed));
  return (
    <article className="rfi" aria-label={`RFI: ${rfi.question}`}>
      <p className="line">
        <span className="strong">{RFI_STATE_LABEL[rfi.state]}</span>
        <span>{withUser(rfi.ball_in_court)}</span>
      </p>
      {rfi.answer ? <p className="muted">{rfi.answer}</p> : null}
      <input className="field" type="text" aria-label="RFI answer" autoComplete="off" value={answer} onChange={(event) => setAnswer(event.target.value)} />
      <div className="line">
        <Button onClick={() => void move('sent')}>Send RFI</Button>
        <Button onClick={() => void move('answered', { answer })}>Answer RFI</Button>
        <Button onClick={() => void move('closed')}>Close RFI</Button>
        <Button onClick={() => void move('sent')}>Reopen RFI</Button>
      </div>
    </article>
  );
}

interface IssuesPanelProps {
  /** Review: only the issues pinned to this version; Drawing: every issue of the drawing */
  versionId: string | null;
  role: Role;
  /** Create RFI: the screen asks for the question and addressee */
  onCreateRfi: (issue: Issue) => void;
}

/** `region "Issues"` body: `list "Issue list"` with the transition buttons of every issue and its RFIs. */
export function IssuesPanel({ versionId, role, onCreateRfi }: IssuesPanelProps) {
  const data = useReviewData();
  const numberOfVersion = (id: string): number | undefined => data.allVersions().find((version) => version.id === id)?.number;
  const issues = data.issues.filter((issue) => versionId === null || issue.version_id === versionId);
  const mayRaise = atLeast(role, MINIMUM_ROLE.raiseIssue);
  const mayAskRfi = atLeast(role, MINIMUM_ROLE.askRfi);
  if (issues.length === 0) return <p className="empty">{NO_ISSUES}</p>;

  const move = (issue: Issue, to: IssueState): Promise<void> =>
    transition<Issue>(`/api/issues/${issue.id}/transitions`, { to }, (changed) => data.addIssue(changed));

  return (
    <ul className="list" role="list" aria-label="Issue list">
      {issues.map((issue) => (
        <li key={issue.id}>
          <p className="line">
            <span className="strong">{issue.title}</span>
            <span>{ISSUE_STATE_LABEL[issue.state]}</span>
            <span className="muted">{versionId === null && numberOfVersion(issue.version_id) !== undefined ? `v${numberOfVersion(issue.version_id)}` : ''}</span>
          </p>
          <div className="line">
            {mayAskRfi ? <Button onClick={() => onCreateRfi(issue)}>Create RFI</Button> : null}
            {mayRaise ? <Button onClick={() => void move(issue, 'answered')}>Answer issue</Button> : null}
            {mayRaise ? <Button onClick={() => void move(issue, 'closed')}>Close issue</Button> : null}
            {mayRaise ? <Button onClick={() => void move(issue, 'open')}>Reopen issue</Button> : null}
          </div>
          {data.rfis.filter((rfi) => rfi.issue_id === issue.id).map((rfi) => <RfiArticle key={rfi.id} rfi={rfi} />)}
        </li>
      ))}
    </ul>
  );
}
