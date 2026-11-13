import { useState } from 'react';
import { EXPORT_STARTED, PUBLISHING, imported, publishedVersion } from '../../shared/copy.ts';
import type { ExportFormat, ExportJob, Sheet } from '../../shared/types.ts';
import { onRefusal, sendJson } from '../api.ts';
import type { ApiFailure } from '../api.ts';
import { useReviewData } from '../review/reviewData.tsx';
import type { DrawingStore } from '../store/index.ts';
import { editAndSettle } from './editAndSettle.ts';

interface StorageActions {
  publishing: boolean;
  /** Publish sheet: the shown layout becomes a new version */
  publish: () => Promise<void>;
  startExport: (format: ExportFormat) => Promise<void>;
  retryExport: () => Promise<void>;
  /** Merge: one `import_merge` group; resolves when the group is confirmed */
  merge: (importId: string, entities: number) => Promise<void>;
}

/**
 * The actions of the Drawing screen that go through storage. Each says what it does in `status "Storage notice"`; a refusal (storage
 * unavailable among them) is the notice's sentence.
 */
export function useStorageActions(store: DrawingStore, drawingId: string, sheet: Sheet | null, exportJob: ExportJob | null): StorageActions {
  const data = useReviewData();
  const [publishing, setPublishing] = useState(false);
  const refused = (failure: ApiFailure): void => store.setStorageNotice(failure.message);

  async function publish(): Promise<void> {
    if (!sheet) return;
    setPublishing(true);
    store.setStorageNotice(PUBLISHING);
    try {
      await onRefusal(
        async () => {
          const version = await sendJson<{ number: number }>('POST', `/api/sheets/${sheet.id}/versions`, {});
          store.setStorageNotice(publishedVersion(version.number));
          data.refreshVersions(sheet.id);
        },
        refused,
      );
    } finally {
      setPublishing(false);
    }
  }

  async function startExport(format: ExportFormat): Promise<void> {
    store.setStorageNotice(EXPORT_STARTED);
    await onRefusal(async () => store.trackExport(await sendJson<ExportJob>('POST', `/api/drawings/${drawingId}/exports`, { format })), refused);
  }

  async function retryExport(): Promise<void> {
    if (!exportJob) return;
    await onRefusal(async () => store.trackExport(await sendJson<ExportJob>('POST', `/api/exports/${exportJob.id}/retry`)), refused);
  }

  async function merge(importId: string, entities: number): Promise<void> {
    if (await editAndSettle(store, 'IMPORT', [{ type: 'import_merge', import_id: importId }])) store.setStorageNotice(imported(entities));
  }

  return { publishing, publish, startExport, retryExport, merge };
}
