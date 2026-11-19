import { validation } from './errors.js';

/** What an upload route receives as its body (see `app.ts`): the multipart bytes and their content type. */
export interface UploadBody {
  contentType: string;
  bytes: Buffer;
}

/** The bytes of the multipart part named `file`. */
export async function filePart(body: unknown): Promise<Buffer> {
  const upload = body as Partial<UploadBody> | undefined;
  if (!upload?.bytes || !upload.contentType) throw validation({ file: 'Choose a file.' });
  const form = await new Response(upload.bytes, { headers: { 'content-type': upload.contentType } }).formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) throw validation({ file: 'Choose a file.' });
  return Buffer.from(await file.arrayBuffer());
}
