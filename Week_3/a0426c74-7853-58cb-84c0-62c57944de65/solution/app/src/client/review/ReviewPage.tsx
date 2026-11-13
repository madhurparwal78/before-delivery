import { NOT_FOUND_PAGE } from '../../shared/copy.ts';
import type { DrawingDocument, VersionDocument } from '../../shared/types.ts';
import { useMe } from '../drawing/me.ts';
import { useJson } from '../pages/useJson.ts';
import { WorkspaceSkeleton } from '../drawing/workspace/WorkspaceSkeleton.tsx';
import { NotAvailable } from '../ui/index.ts';
import { ReviewScreen } from './ReviewScreen.tsx';

function WithDrawing({ version, me }: { version: VersionDocument; me: string }) {
  const drawing = useJson<DrawingDocument>(`/api/drawings/${version.drawing_id}`);
  if (drawing.status === 'failed') return <NotAvailable sentences={[NOT_FOUND_PAGE]} />;
  if (drawing.status === 'loading') return <WorkspaceSkeleton />;
  return <ReviewScreen version={version} drawing={drawing.data} me={me} />;
}

/** `/versions/<id>`: one published version read-only, with the review panels. */
export function ReviewPage({ id }: { id: string }) {
  const version = useJson<VersionDocument>(`/api/versions/${id}`);
  const me = useMe();
  if (version.status === 'failed') return <NotAvailable sentences={[NOT_FOUND_PAGE]} />;
  if (version.status === 'loading' || me === null) return <WorkspaceSkeleton />;
  return <WithDrawing version={version.data} me={me} />;
}
