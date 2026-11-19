// Uploads judged by content: a figure record and its stored object exist together or not at all.
import { createHash } from "node:crypto";
import { membership, requireRole } from "./access.ts";
import { signedIn } from "./auth.ts";
import { pool, transaction } from "./db.ts";
import { fail, ok, type Context, type Reply } from "./http.ts";
import { commitRevision, currentFile, fileShape, lockProject, newId } from "./projects.ts";
import { assetKey, deleteObject, putObject } from "./storage.ts";
import { safeSvg } from "./svg.ts";
import { extensionOf, PATH_MESSAGE, TEXT_LIMIT_BYTES, validPath } from "./validate.ts";

const FIGURE_LIMIT_BYTES = 10_000_000;

interface Part {
  name: string;
  filename: string | null;
  data: Buffer;
}

function parseMultipart(contentType: string, body: Buffer): Part[] {
  const boundary = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
  const marker = boundary?.[1] ?? boundary?.[2];
  if (!marker) throw fail.invalid({ file: "Choose a file to upload." });
  const delimiter = Buffer.from(`--${marker}`);
  const parts: Part[] = [];
  let at = body.indexOf(delimiter);
  while (at >= 0) {
    const start = at + delimiter.length;
    if (body.subarray(start, start + 2).toString() === "--") break;
    const next = body.indexOf(delimiter, start);
    if (next < 0) break;
    const chunk = body.subarray(start + 2, next - 2);
    const split = chunk.indexOf("\r\n\r\n");
    if (split >= 0) {
      const head = chunk.subarray(0, split).toString("utf8");
      const disposition = /content-disposition:[^\r\n]*/i.exec(head)?.[0] ?? "";
      const name = /\bname="([^"]*)"/i.exec(disposition)?.[1];
      const filename = /\bfilename="([^"]*)"/i.exec(disposition)?.[1] ?? null;
      if (name !== undefined) parts.push({ name, filename, data: chunk.subarray(split + 4) });
    }
    at = next;
  }
  return parts;
}

type Kind = "png" | "jpeg" | "pdf" | "svg" | "bib";

const CONTENT_TYPES: Record<Exclude<Kind, "bib">, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  pdf: "application/pdf",
  svg: "image/svg+xml",
};

const EXTENSIONS: Record<Kind, readonly string[]> = {
  png: [".png"],
  jpeg: [".jpg", ".jpeg"],
  pdf: [".pdf"],
  svg: [".svg"],
  bib: [".bib"],
};

/** The type comes from the bytes; the extension must then match it. */
function judge(data: Buffer, extension: string): { kind: Kind; text: string | null } {
  const starts = (signature: number[]): boolean => signature.every((byte, index) => data[index] === byte);
  let kind: Kind | null = null;
  let text: string | null = null;
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) kind = "png";
  else if (starts([0xff, 0xd8, 0xff])) kind = "jpeg";
  else if (data.subarray(0, 5).toString("latin1") === "%PDF-") kind = "pdf";
  else {
    try {
      text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(data);
    } catch {
      throw fail.unsupportedFileType();
    }
    if (extension === ".svg") {
      if (!safeSvg(text)) throw fail.unsupportedFileType();
      kind = "svg";
    } else if (!text.includes("\u0000")) {
      kind = "bib";
    }
  }
  if (!kind || !EXTENSIONS[kind].includes(extension)) throw fail.unsupportedFileType();
  return { kind, text: kind === "bib" ? text : null };
}

const NAME = /^[A-Za-z0-9_\-][A-Za-z0-9._\-]{0,99}$/;

export async function uploadFile(ctx: Context): Promise<Reply> {
  const user = await signedIn(ctx);
  const access = await membership(pool, user.id, ctx.params.pid ?? "");
  requireRole(access, "write");
  const parts = parseMultipart(String(ctx.req.headers["content-type"] ?? ""), ctx.raw);
  const file = parts.find((part) => part.name === "file" && part.filename !== null);
  const folderPart = parts.find((part) => part.name === "folder");
  const name = file?.filename ?? "";
  const extension = extensionOf(name);
  const folder = folderPart ? folderPart.data.toString("utf8") : "";
  const chosenFolder = folder !== "" ? folder : extension === ".bib" ? "" : "figures";
  const path = chosenFolder ? `${chosenFolder}/${name}` : name;
  const nameValid = NAME.test(name);
  const folderValid = chosenFolder === "" || validPath(chosenFolder);
  const objectId = newId();
  return transaction(async (client) => {
    const project = await lockProject(client, access.project.id);
    if (nameValid && folderValid && validPath(path)) {
      const taken = await client.query("SELECT 1 FROM tree WHERE project_id = $1 AND project_revision = $2 AND path = $3", [
        project.id,
        project.revision,
        path,
      ]);
      if (taken.rowCount) throw fail.conflict("path_taken");
    }
    const errors: Record<string, string> = {};
    for (const part of parts) if (part.name !== "file" && part.name !== "folder") errors[part.name] = "This field is not accepted here.";
    if (!file || !nameValid) errors.file = "Use a file name of letters, digits, dots, hyphens and underscores.";
    if (!folderValid || !validPath(path)) errors.folder = PATH_MESSAGE;
    if (Object.keys(errors).length > 0) throw fail.invalid(errors);
    const data = (file as Part).data;
    if (data.length > (extension === ".bib" ? TEXT_LIMIT_BYTES : FIGURE_LIMIT_BYTES)) throw fail.tooLarge();
    const { kind, text } = judge(data, extension);
    const sha256 = createHash("sha256").update(data).digest("hex");
    const key = assetKey(project.id, objectId);
    await putObject(key, data, kind === "bib" ? "text/plain; charset=utf-8" : CONTENT_TYPES[kind]);
    try {
      if (text !== null) {
        await client.query("INSERT INTO files (id, project_id, kind) VALUES ($1, $2, 'text')", [objectId, project.id]);
        await client.query("INSERT INTO text_revisions (file_id, revision, content) VALUES ($1, 1, $2)", [objectId, text]);
      } else {
        await client.query("INSERT INTO files (id, project_id, kind, content_type, size, sha256) VALUES ($1, $2, 'asset', $3, $4, $5)", [
          objectId,
          project.id,
          CONTENT_TYPES[kind as Exclude<Kind, "bib">],
          data.length,
          sha256,
        ]);
      }
      const revision = await commitRevision(client, project, { kind: "upload", summary: `Uploaded ${path}` }, user, [
        { kind: "add", fileId: objectId, path, textRevision: text !== null ? 1 : null },
      ]);
      const stored = await currentFile(client, project.id, revision, objectId);
      return ok({ file: fileShape(stored, text ?? undefined), projectRevision: revision }, 201);
    } catch (error) {
      await deleteObject(key).catch(() => undefined);
      throw error;
    }
  });
}
