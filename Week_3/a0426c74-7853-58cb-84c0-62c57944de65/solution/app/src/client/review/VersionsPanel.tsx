import { useState } from 'react';
import { NO_VERSIONS, VERSION_STATE_LABEL, replacedBy } from '../../shared/copy.ts';
import { MINIMUM_ROLE, REVIEW_STEP_ROLES, atLeast, pendingStep, stepMinimumRole } from '../../shared/rules.ts';
import type { Role, Sheet, VersionSummary } from '../../shared/types.ts';
import { onRefusal, sendEmpty, sendJson } from '../api.ts';
import { Link } from '../router.tsx';
import { Button } from '../ui/index.ts';
import { useReviewData } from './reviewData.tsx';
import '../styles/drawing/versions.css';

export interface VersionGroup { sheet: Sheet; versions: readonly VersionSummary[] }

interface VersionsPanelProps {
  groups: readonly VersionGroup[];
  /** the version the review controls apply to */
  targetId: string | null;
  /** Drawing: choose another version; Review: undefined, rows are links to the version's screen */
  onSelect?: (versionId: string) => void;
  role: Role;
  /** Restore this version: one `RESTORE` group through the normal operations route */
  onRestore: (version: VersionSummary) => Promise<void>;
  /** Review is the screen where `Approve` is the one sage button; on Drawing that is `Publish sheet` */
  approveIsPrimary?: boolean;
}

function numberOf(groups: readonly VersionGroup[], id: string | null): number | null {
  return groups.flatMap((group) => group.versions).find((version) => version.id === id)?.number ?? null;
}

function VersionRow({ group, version, current, groups, onSelect }: {
  group: VersionGroup; version: VersionSummary; current: boolean; groups: readonly VersionGroup[]; onSelect?: (versionId: string) => void;
}) {
  const replacement = numberOf(groups, version.replaced_by);
  const label = `v${version.number}`;
  return (
    <li className="line" aria-current={current ? 'true' : undefined}>
      {onSelect ? (
        <button type="button" className="row-button" onClick={() => onSelect(version.id)}>{label}</button>
      ) : (
        <Link to={`/versions/${version.id}`} className="row-button">{label}</Link>
      )}
      <span className="muted">{group.sheet.name}</span>
      <span>{VERSION_STATE_LABEL[version.state]}</span>
      {replacement === null ? null : <span className="muted">{replacedBy(replacement)}</span>}
    </li>
  );
}

interface ReviewControlsProps {
  version: VersionSummary;
  role: Role;
  groups: readonly VersionGroup[];
  onRestore: (version: VersionSummary) => Promise<void>;
  approveIsPrimary: boolean;
}

function ReviewControls({ version, role, groups, onRestore, approveIsPrimary }: ReviewControlsProps) {
  const data = useReviewData();
  const [linkId, setLinkId] = useState<string | null>(null);
  const [linkUrl, setLinkUrl] = useState<string | null>(null);
  const sheetId = groups.find((group) => group.versions.some((candidate) => candidate.id === version.id))?.sheet.id;

  async function act(action: () => Promise<void>): Promise<void> {
    await onRefusal(
      async () => {
        await action();
        data.setNote(version.id, null);
      },
      (failure) => data.setNote(version.id, failure.message),
    );
    if (sheetId) data.refreshVersions(sheetId);
  }

  // the step a verdict is for: the one waiting for a decision; with none pending the server refuses the verdict whichever is named
  const step = pendingStep(version.steps)?.role ?? REVIEW_STEP_ROLES[0];
  const startReview = (): Promise<void> => act(() => sendJson('POST', `/api/versions/${version.id}/review`, {}));
  const judge = (verdict: 'approve' | 'reject'): Promise<void> =>
    act(() => sendJson('POST', `/api/versions/${version.id}/review/${step}/${verdict}`, { comment: '' }));
  const createLink = (): Promise<void> =>
    act(async () => {
      const link = await sendJson<{ id: string; url: string }>('POST', `/api/versions/${version.id}/links`, {});
      setLinkId(link.id);
      setLinkUrl(`${window.location.origin}${link.url}`);
    });
  const turnOffLink = (): Promise<void> =>
    act(async () => {
      if (linkId === null) return;
      await sendEmpty('DELETE', `/api/links/${linkId}`);
      setLinkId(null);
      setLinkUrl(null);
    });
  const restore = (): Promise<void> => act(() => onRestore(version));

  return (
    <div className="review-controls">
      <p className="strong">{`Version ${version.number}`}</p>
      {version.stamps.length > 0 ? (
        <ul className="list" role="list" aria-label="Review stamps">
          {version.stamps.map((stamp) => <li key={stamp}>{stamp}</li>)}
        </ul>
      ) : null}
      <div className="line">
        {atLeast(role, MINIMUM_ROLE.startReview) ? <Button onClick={() => void startReview()}>Start review</Button> : null}
        {atLeast(role, stepMinimumRole(step)) ? <Button primary={approveIsPrimary} onClick={() => void judge('approve')}>Approve</Button> : null}
        {atLeast(role, stepMinimumRole(step)) ? <Button onClick={() => void judge('reject')}>Reject</Button> : null}
        {atLeast(role, MINIMUM_ROLE.restoreVersion) ? <Button onClick={() => void restore()}>Restore this version</Button> : null}
        {atLeast(role, MINIMUM_ROLE.createLink) ? <Button onClick={() => void createLink()}>Create view link</Button> : null}
        {atLeast(role, MINIMUM_ROLE.turnOffLink) ? <Button disabled={linkId === null} onClick={() => void turnOffLink()}>Turn off link</Button> : null}
      </div>
      {linkUrl ? <a href={linkUrl}>{linkUrl}</a> : null}
      {data.noteOf(version.id) ? <p className="refusal">{data.noteOf(version.id)}</p> : null}
    </div>
  );
}

/** `region "Versions"` body: the published versions of the shown sheet(s) and the review controls of the chosen one. */
export function VersionsPanel({ groups, targetId, onSelect, role, onRestore, approveIsPrimary = false }: VersionsPanelProps) {
  const all = groups.flatMap((group) => group.versions);
  const target = all.find((version) => version.id === targetId);
  if (all.length === 0) return <p className="empty">{NO_VERSIONS}</p>;
  return (
    <>
      <ul className="list" role="list" aria-label="Version list">
        {groups.flatMap((group) =>
          group.versions.map((version) => (
            <VersionRow key={version.id} group={group} version={version} current={version.id === targetId} groups={groups} onSelect={onSelect} />
          )),
        )}
      </ul>
      {target ? <ReviewControls version={target} role={role} groups={groups} onRestore={onRestore} approveIsPrimary={approveIsPrimary} /> : null}
    </>
  );
}
