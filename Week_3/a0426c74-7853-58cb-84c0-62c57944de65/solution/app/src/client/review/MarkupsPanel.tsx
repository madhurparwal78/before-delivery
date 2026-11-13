import { useState } from 'react';
import { GEOMETRY_CHANGED_LABEL, NO_MARKUPS } from '../../shared/copy.ts';
import { MINIMUM_ROLE, atLeast } from '../../shared/rules.ts';
import { MARKUP_KINDS } from '../../shared/types.ts';
import type { MarkupKind, Role } from '../../shared/types.ts';
import { Button } from '../ui/index.ts';
import { MarkupDialog } from './MarkupDialog.tsx';
import { useReviewData } from './reviewData.tsx';

const toolLabel = (kind: MarkupKind): string => kind.charAt(0).toUpperCase() + kind.slice(1);

/** `region "Markups"` body: the Cloud, Arrow and Text tools and the markups of the chosen version, with the carry-forward flag. */
export function MarkupsPanel({ versionId, role }: { versionId: string | null; role: Role }) {
  const data = useReviewData();
  const [tool, setTool] = useState<MarkupKind | null>(null);
  const markups = versionId ? data.markupsOf(versionId) : [];
  return (
    <>
      {atLeast(role, MINIMUM_ROLE.addMarkup) ? (
        <div className="line">
          {MARKUP_KINDS.map((kind) => (
            <Button key={kind} disabled={versionId === null} data-active-tool={tool === kind ? '' : undefined} onClick={() => setTool(kind)}>{toolLabel(kind)}</Button>
          ))}
        </div>
      ) : null}
      {markups.length === 0 ? <p className="empty">{NO_MARKUPS}</p> : (
        <ul className="list" role="list" aria-label="Markup list">
          {markups.map((markup) => (
            <li key={markup.id} data-flag={markup.flag ?? undefined}>
              <p className="line">
                <span className="strong">{markup.kind}</span>
                <span>{markup.text}</span>
              </p>
              {markup.flag ? <p className="muted">{GEOMETRY_CHANGED_LABEL}</p> : null}
            </li>
          ))}
        </ul>
      )}
      {tool && versionId ? <MarkupDialog kind={tool} versionId={versionId} onPlaced={data.addMarkup} onClose={() => setTool(null)} /> : null}
    </>
  );
}
