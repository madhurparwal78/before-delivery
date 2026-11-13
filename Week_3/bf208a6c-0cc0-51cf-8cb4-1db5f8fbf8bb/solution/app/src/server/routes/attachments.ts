import { open, postVisible } from "../access";
import { maybeOne, pool } from "../db";
import { contentDisposition } from "../files";
import { isUuid, notFound, param, serviceDown, type Reply, type Request } from "../http";
import { StorageError, getObject } from "../services/storage";
import { isImageType } from "../../shared/rules";

interface AttachmentRow {
  id: string;
  post_id: string;
  board_id: string;
  author_id: string;
  state: "published" | "awaiting_approval";
  file_name: string;
  content_type: string;
}

export async function read(request: Request): Promise<Reply> {
  const id = param(request, "id");
  const found = isUuid(id)
    ? await maybeOne<AttachmentRow>(
        pool,
        `SELECT a.id, a.post_id, p.board_id, p.author_id, p.state, a.file_name, a.content_type FROM attachments a JOIN posts p ON p.id = a.post_id WHERE a.id = $1`,
        [id],
      )
    : null;
  if (!found) throw notFound();
  const access = await open(request, { boardId: found.board_id });
  if (!postVisible(access, { id: found.post_id, board_id: found.board_id, author_id: found.author_id, state: found.state })) throw notFound();
  let bytes: Buffer;
  try {
    bytes = await getObject(`boards/${found.board_id}/posts/${found.post_id}/${found.id}`);
  } catch (error) {
    if (error instanceof StorageError) throw serviceDown("storage_unavailable");
    throw error;
  }
  const inline = isImageType(found.content_type);
  return {
    status: 200,
    headers: {
      "Content-Type": found.content_type === "text/plain" ? "text/plain; charset=utf-8" : found.content_type,
      "Content-Disposition": contentDisposition(inline, found.file_name),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-cache",
    },
    raw: bytes,
  };
}
