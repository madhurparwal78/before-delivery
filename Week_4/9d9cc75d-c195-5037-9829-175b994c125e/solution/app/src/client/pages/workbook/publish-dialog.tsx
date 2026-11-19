import { useState } from 'react';
import type { ProjectRef } from '../../api/types.ts';
import { Button } from '../../ui/button.tsx';
import { Dialog } from '../../ui/dialog.tsx';
import { Select } from '../../ui/fields.tsx';

interface Props {
  /** the projects the caller is a creator in */
  projects: readonly ProjectRef[];
  /** the project the workbook is in now */
  current: string;
  onPublish: (project: ProjectRef) => void;
  onClose: () => void;
}

/** `dialog "Publish"`: the project to publish the workbook into. */
export function PublishDialog({ projects, current, onPublish, onClose }: Props) {
  const [project, setProject] = useState(projects.some((entry) => entry.id === current) ? current : (projects[0]?.id ?? ''));
  const chosen = projects.find((entry) => entry.id === project);
  return (
    <Dialog name="Publish" onClose={onClose}>
      <Select label="Project" value={project} onChange={setProject} options={projects.map((entry) => ({ value: entry.id, label: entry.name }))} />
      <div className="dialog-actions">
        <Button variant="primary" disabled={!chosen} onClick={() => chosen && onPublish(chosen)}>
          Publish workbook
        </Button>
      </div>
    </Dialog>
  );
}
