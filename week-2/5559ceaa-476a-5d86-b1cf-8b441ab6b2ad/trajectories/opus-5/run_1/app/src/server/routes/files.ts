import { pool } from '../db.js';
import type { Route } from '../http/router.js';
import { textField, wholeNumberField } from '../http/validate.js';
import { assertMentor, fileView } from '../repository.js';
import {
  createFile,
  deleteFile,
  listFiles,
  loadFile,
  renameFile,
  renameFolder,
  saveFile,
} from '../services/fileWrites.js';

export const fileRoutes: Route[] = [
  {
    method: 'GET',
    pattern: '/api/projects/:project_id/files',
    scope: 'project',
    body: 'none',
    handler: async (ctx) => ({
      status: 200,
      payload: { files: (await listFiles(pool, ctx.project.id)).map(fileView) },
    }),
  },
  {
    method: 'GET',
    pattern: '/api/projects/:project_id/files/:file_id',
    scope: 'project',
    body: 'none',
    handler: async (ctx) => {
      const row = await loadFile(pool, ctx.project.id, ctx.params['file_id'] ?? '');
      return {
        status: 200,
        payload: { file: { ...fileView(row), content: row.content.toString('utf8') } },
      };
    },
  },
  {
    method: 'POST',
    pattern: '/api/projects/:project_id/files',
    scope: 'project',
    body: 'json',
    handler: async (ctx) => {
      const fields = ctx.fields();
      const path = textField(fields, 'path', 'Give the file a path.');
      const content = textField(fields, 'content', 'Send the file contents as text.');
      return {
        status: 201,
        payload: { file: await createFile(ctx.project.id, ctx.user, path, content) },
      };
    },
  },
  {
    method: 'PUT',
    pattern: '/api/projects/:project_id/files/:file_id',
    scope: 'project',
    body: 'json',
    handler: async (ctx) => {
      const fields = ctx.fields();
      const content = textField(fields, 'content', 'Send the file contents as text.');
      const baseRevision = wholeNumberField(
        fields,
        'base_revision',
        1,
        Number.MAX_SAFE_INTEGER,
        'Send the revision your change is based on.',
      );
      return {
        status: 200,
        payload: {
          file: await saveFile(
            ctx.project.id,
            ctx.user,
            ctx.params['file_id'] ?? '',
            baseRevision,
            content,
          ),
        },
      };
    },
  },
  {
    method: 'PATCH',
    pattern: '/api/projects/:project_id/files/:file_id',
    scope: 'project',
    body: 'json',
    handler: async (ctx) => {
      assertMentor(ctx.role);
      const path = textField(ctx.fields(), 'path', 'Give the file a path.');
      return {
        status: 200,
        payload: {
          file: await renameFile(ctx.project.id, ctx.user, ctx.params['file_id'] ?? '', path),
        },
      };
    },
  },
  {
    method: 'POST',
    pattern: '/api/projects/:project_id/folders/rename',
    scope: 'project',
    body: 'json',
    handler: async (ctx) => {
      assertMentor(ctx.role);
      const fields = ctx.fields();
      const from = textField(fields, 'from', 'Name the folder to rename.');
      const to = textField(fields, 'to', 'Give the folder a new name.');
      return {
        status: 200,
        payload: { files: await renameFolder(ctx.project.id, ctx.user, from, to) },
      };
    },
  },
  {
    method: 'DELETE',
    pattern: '/api/projects/:project_id/files/:file_id',
    scope: 'project',
    body: 'none',
    handler: async (ctx) => {
      await deleteFile(ctx.project.id, ctx.user, ctx.params['file_id'] ?? '');
      return { status: 204 };
    },
  },
];
