import { useState } from 'react';
import { api } from '../../api/client.ts';
import type { Me, ProjectDetail } from '../../api/types.ts';
import { useLoad } from '../../api/use-load.ts';
import type { Role, Source } from '../../../shared/model.ts';
import type { Params } from '../../router.ts';
import { ErrorPage } from '../../shell/error-page.tsx';
import { useSession } from '../../shell/session.tsx';
import { Status } from '../../ui/live.tsx';
import '../upload/data-pages.css';
import { EntitlementsCard } from './entitlements-card.tsx';
import { ExtractCard } from './extract-card.tsx';
import { FieldsCard } from './fields-card.tsx';
import { TablesCard } from './tables-card.tsx';
import './source.css';

interface Access {
  project: string;
  role: Role;
  explorersSchedule: boolean;
}

/** The source answers do not name their project, so the caller's own projects say which one lists it. */
async function loadAccess(sourceId: string, me: Me | null): Promise<Access | null> {
  const projects = (me?.projects ?? []).filter((project) => project.role !== 'viewer');
  const details = await Promise.all(projects.map((project) => api.get<ProjectDetail>(`/api/projects/${project.id}`)));
  const home = details.find((detail) => detail.sources.some((entry) => entry.id === sourceId));
  return home ? { project: home.id, role: home.role, explorersSchedule: home.explorers_schedule } : null;
}

interface Note {
  text: string;
  error: boolean;
}

function Skeleton() {
  return (
    <div className="data-page" aria-hidden="true">
      <div className="card skeleton">
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}

export function SourcePage({ params }: { params: Params }) {
  const { me } = useSession();
  const id = params.id ?? '';
  const source = useLoad(() => api.get<Source>(`/api/sources/${id}`), [id]);
  const access = useLoad(() => loadAccess(id, me), [id]);
  const [note, setNote] = useState<Note>({ text: '', error: false });

  if (source.error) return <ErrorPage error={source.error} />;
  const detail = source.data;
  if (!detail || access.data === undefined) return <Skeleton />;

  const role = access.data?.role ?? 'explorer';
  const creator = role === 'creator';
  const canSchedule = creator || (role === 'explorer' && (access.data?.explorersSchedule ?? false));
  const card = {
    source: detail,
    reload: source.reload,
    say: (text: string) => setNote({ text, error: false }),
    warn: (text: string) => setNote({ text, error: true }),
  };

  return (
    <div className="data-page source-page">
      <div className="page-head">
        <h1>{detail.name}</h1>
      </div>
      <Status name="Announcements" text={note.text} ok={!note.error} />
      <div className="data-columns">
        <div className="card-stack">
          <TablesCard {...card} project={access.data?.project ?? ''} creator={creator} />
          <FieldsCard {...card} creator={creator} />
        </div>
        <div className="card-stack">
          <ExtractCard {...card} canSchedule={canSchedule} />
          <EntitlementsCard {...card} creator={creator} />
        </div>
      </div>
    </div>
  );
}
