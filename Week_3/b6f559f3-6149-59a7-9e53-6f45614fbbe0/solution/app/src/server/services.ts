import { config } from './config';
import { Storage } from './s3';

/** The one storage client of this copy of the app. */
export const storage = new Storage({
  endpoint: config.s3.endpoint,
  region: config.s3.region,
  bucket: config.s3.bucket,
  accessKeyId: config.s3.accessKeyId,
  secretAccessKey: config.s3.secretAccessKey,
});
