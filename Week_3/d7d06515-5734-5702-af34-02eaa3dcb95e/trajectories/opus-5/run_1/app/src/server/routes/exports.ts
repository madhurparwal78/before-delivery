import {
  assertExportAllowed,
  assertWorkspaceOwner,
  resolveDrawingCaller,
  resolveWorkspaceCaller,
} from '../access';
import { fail, ValidationError } from '../errors';
import { loadDrawingState } from '../drawings';
import {
  addRevision,
  createExport,
  findExport,
  listExports,
  listRevisions,
  renderAndStore,
  serializeExport,
} from '../exports';
import { getObject, StorageUnavailable } from '../storage';
import { attachment, json, type Router } from '../http';

export function registerExportRoutes(router: Router): void {
  router.add('POST', '/api/drawings/:id/exports', async (context) => {
    const caller = await resolveDrawingCaller(context, context.params.id!);
    const body = await context.json();
    assertExportAllowed(caller);
    const format = body.format;
    if (format !== 'pdf' && format !== 'dxf') throw new ValidationError({ format: 'Choose PDF or DXF.' });
    const state = await loadDrawingState(caller.drawing.id);
    if (state === null) fail('not_found');
    const layout = typeof body.layout === 'string' ? body.layout : 'Model';
    if (format === 'pdf' && !state.layouts.some((candidate) => candidate.name === layout)) {
      throw new ValidationError({ layout: 'Choose a layout from the list.' });
    }
    const record = await createExport({
      state,
      workspace: caller.workspace,
      format,
      layout,
      now: caller.now,
    });
    void renderAndStore(record, caller.workspace);
    return json(202, { export: { id: record.id, state: 'rendering', file: record.file } });
  });

  router.add('GET', '/api/drawings/:id/exports', async (context) => {
    const caller = await resolveDrawingCaller(context, context.params.id!);
    const records = await listExports(caller.drawing.id);
    return json(200, { exports: records.map(serializeExport) });
  });

  router.add('GET', '/api/exports/:id', async (context) => {
    const record = await findExport(context.params.id!);
    if (record === null) fail('not_found');
    await resolveDrawingCaller(context, record.drawing_id);
    return json(200, { export: serializeExport(record) });
  });

  router.add('GET', '/api/exports/:id/download', async (context) => {
    const record = await findExport(context.params.id!);
    if (record === null) fail('not_found');
    await resolveDrawingCaller(context, record.drawing_id);
    if (record.state !== 'stored' || record.object_key === null) fail('export_not_ready');
    try {
      const body = await getObject(record.object_key);
      return attachment(body, record.format === 'pdf' ? 'application/pdf' : 'application/dxf', record.file);
    } catch (error) {
      if (error instanceof StorageUnavailable) fail('storage_unavailable');
      throw error;
    }
  });

  router.add('GET', '/api/templates/title-block-a3/revisions', async (context) => {
    const caller = await resolveWorkspaceCaller(context);
    return json(200, { revisions: await listRevisions(caller.workspace.id) });
  });

  router.add('POST', '/api/templates/title-block-a3/revisions', async (context) => {
    const caller = await resolveWorkspaceCaller(context);
    const body = await context.json();
    assertWorkspaceOwner(caller);
    const revision = await addRevision(
      caller.workspace,
      typeof body.footer_note === 'string' ? body.footer_note.trim() : '',
      typeof body.effective_date === 'string' ? body.effective_date : '',
      caller.now,
    );
    return json(201, { revision });
  });
}
