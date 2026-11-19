import { Link } from '../router';
import { useClassroom } from './context';

export function EndedNotice() {
  const { snapshot, canRun } = useClassroom();
  if (snapshot.state !== 'ended') return null;
  return (
    <div className="ended-notice">
      <p>This class has ended.</p>
      {canRun ? <Link href={`/sessions/${snapshot.id}/summary`}>Session summary</Link> : <Link href={`/review/${snapshot.id}`}>Review the slides</Link>}
    </div>
  );
}
