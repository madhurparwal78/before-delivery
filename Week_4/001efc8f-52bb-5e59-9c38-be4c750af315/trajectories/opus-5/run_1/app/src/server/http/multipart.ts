import busboy from 'busboy';
import { ApiError } from '../errors';
import { LIMITS } from '../config';
import type { RequestContext } from './context';
import type { UploadedPart } from '../domain/photos';

export interface MultipartBody {
  fields: Record<string, string>;
  files: UploadedPart[];
  /** Part names in request order, so unaccepted ones are reported in order. */
  order: string[];
}

export async function readMultipartBody(ctx: RequestContext): Promise<MultipartBody> {
  return new Promise<MultipartBody>((resolve, reject) => {
    const parser = busboy({ headers: ctx.req.headers });
    const body: MultipartBody = { fields: {}, files: [], order: [] };
    let total = 0;
    let failed = false;

    const fail = (error: Error): void => {
      if (failed) return;
      failed = true;
      ctx.req.unpipe(parser);
      ctx.req.resume();
      reject(error);
    };

    parser.on('field', (name, value) => {
      total += Buffer.byteLength(value);
      if (total > LIMITS.multipartBodyBytes) {
        fail(new ApiError('payload_too_large'));
        return;
      }
      body.order.push(name);
      body.fields[name] = value;
    });

    parser.on('file', (name, stream, info) => {
      body.order.push(name);
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => {
        total += chunk.length;
        if (total > LIMITS.multipartBodyBytes) {
          fail(new ApiError('payload_too_large'));
          return;
        }
        chunks.push(chunk);
      });
      stream.on('end', () => {
        body.files.push({ filename: info.filename, buffer: Buffer.concat(chunks) });
      });
    });

    parser.on('error', () => fail(new ApiError('validation', { errors: {} })));
    parser.on('close', () => {
      if (!failed) resolve(body);
    });

    ctx.req.pipe(parser);
  });
}
