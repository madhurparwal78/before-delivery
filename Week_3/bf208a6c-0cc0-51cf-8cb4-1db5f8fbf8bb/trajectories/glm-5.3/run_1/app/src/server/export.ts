import type { App } from './app.js';
import type { RequestContext } from './http.js';
import { sendJson } from './http.js';
import { forbidden } from './errors.js';
import { openBoardOr404, roleAtLeast } from './access.js';
import { boardPostsListing } from './listings.js';
import { csvFileName, csvHeader, csvField } from './rules.js';

export async function handleExportCsv(app: App, ctx: RequestContext): Promise<void> {
  const { board, role } = await openBoardOr404(app.db, ctx.params.id, {
    userId: ctx.userId,
    passUnlocks: app.passUnlocks(ctx),
  });
  if (!roleAtLeast(role, 'moderator')) throw forbidden();
  const listing = await boardPostsListing(app.db, board, ctx.userId, role);
  const lines: string[] = [csvHeader];
  for (const section of listing.sections) {
    for (const [index, post] of section.posts.entries()) {
      lines.push(
        [post.id, section.title, String(index + 1), post.title, post.body, post.author.display_name,
         String(post.likes), String(post.score), String(post.comments), post.attachment?.file_name ?? '',
         post.created_at]
          .map(csvField)
          .join(','),
      );
    }
  }
  const csv = `${lines.join('\r\n')}\r\n`;
  ctx.res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${csvFileName(board.title)}.csv"`,
  });
  ctx.res.end(csv);
}
