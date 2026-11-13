import { query } from '../db/pool';
import { parseLayoutFile, serialiseLayoutFile } from '../domain/layoutfile';
import { ApiError } from '../errors';
import { Reply, RequestContext, pathParam, requireUser } from '../http';
import { requireVisibleBoard } from './boards';
import { Route, route } from './types';

async function requireMakerBoard(context: RequestContext): Promise<{ tag: string; makerId: string }> {
  const board = await requireVisibleBoard(context, pathParam(context, 'tag'));
  const user = requireUser(context);
  if (user.role !== 'maker') throw new ApiError('forbidden');
  return { tag: board.tag, makerId: user.id };
}

async function importLayout(context: RequestContext): Promise<Reply> {
  const { tag, makerId } = await requireMakerBoard(context);
  const file = parseLayoutFile(context.jsonRaw, tag);
  const text = serialiseLayoutFile(file);
  await query(
    `INSERT INTO layouts (maker_id, board_tag, file_json, updated_at) VALUES ($1, $2, $3, $4)
     ON CONFLICT (maker_id, board_tag) DO UPDATE SET file_json = $3, updated_at = $4`,
    [makerId, tag, text, context.now]
  );
  return { status: 200, rawJson: `{"layout":${text}}` };
}

async function exportLayout(context: RequestContext): Promise<Reply> {
  const { tag, makerId } = await requireMakerBoard(context);
  const found = await query<{ file_json: string }>('SELECT file_json FROM layouts WHERE maker_id = $1 AND board_tag = $2', [
    makerId,
    tag
  ]);
  const stored = found[0]?.file_json;
  if (stored === undefined) throw new ApiError('not_found');
  return {
    status: 200,
    body: Buffer.from(stored, 'utf8'),
    headers: {
      'content-type': 'application/json',
      'content-disposition': `attachment; filename="${tag}.kerf"`
    }
  };
}

export const layoutRoutes: Route[] = [
  route('POST', '/api/boards/:tag/layout', true, importLayout),
  route('GET', '/api/boards/:tag/layout.kerf', true, exportLayout)
];
