import { useEffect, useState } from 'react';
import { api } from '../../api/client.ts';
import type { Source } from '../../../shared/model.ts';
import { navigate, signInPath, useLocation } from '../../router.ts';
import { creatorProjects, useSession } from '../../shell/session.tsx';
import { LinkButton } from '../../ui/button.tsx';
import { EmptyState } from '../../ui/empty-state.tsx';
import { Select, TextField } from '../../ui/fields.tsx';
import { Status } from '../../ui/live.tsx';
import { CsvUpload } from './csv-upload.tsx';
import './data-pages.css';

export function UploadPage() {
  const { me } = useSession();
  const location = useLocation();
  const projects = creatorProjects(me);
  const wanted = location.query.get('project');
  const [project, setProject] = useState(projects.find((entry) => entry.id === wanted)?.id ?? projects[0]?.id ?? '');
  const [sourceName, setSourceName] = useState('');
  const [tableName, setTableName] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!me) navigate(signInPath(location.href), { replace: true });
  }, [me]);

  if (!me) return null;
  if (projects.length === 0) return <EmptyState level={1} sticker="sum" headline="You do not have access to this." />;

  const send = (bytes: Uint8Array<ArrayBuffer>) => {
    const query = new URLSearchParams({ name: sourceName.trim(), table: tableName.trim() });
    return api.csv<Source>('POST', `/api/projects/${project}/sources?${query.toString()}`, bytes);
  };

  return (
    <div className="data-page upload-page">
      <div className="page-head">
        <h1>Upload a source</h1>
      </div>
      <Status name="Announcements" text="" />
      <section className="card form-grid" aria-label="Source details">
        <Select
          label="Project"
          value={project}
          onChange={setProject}
          options={projects.map((entry) => ({ value: entry.id, label: entry.name }))}
          error={errors.project}
        />
        <TextField label="Source name" value={sourceName} onChange={setSourceName} error={errors.name} />
        <TextField label="Table name" value={tableName} onChange={setTableName} error={errors.table} />
        <CsvUpload
          previewPath={`/api/projects/${project}/sources/preview`}
          tableName={tableName}
          send={send}
          onNameErrors={setErrors}
          done={(source) => <LinkButton to={`/sources/${source.id}`}>Open {source.name}</LinkButton>}
        />
      </section>
    </div>
  );
}
