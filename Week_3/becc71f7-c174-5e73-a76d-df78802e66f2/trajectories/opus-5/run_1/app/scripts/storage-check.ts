/** Checks the signed MinIO client against a running MinIO. */
import { readConfig } from '../src/server/config.js';
import { Storage, photoOriginalKey } from '../src/server/services/storage.js';

const config = readConfig();
const storage = new Storage({ ...config.s3, bucket: `${config.s3.bucket}-check` });

await storage.ensureBucket();
console.log('ok   ensureBucket');
await storage.ensureBucket();
console.log('ok   ensureBucket twice');

const key = photoOriginalKey('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222');
const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 250]);
await storage.putObject(key, bytes, 'image/jpeg');
console.log('ok   putObject');

const fetched = await storage.getObject(key);
console.log(
  fetched !== null && fetched.body.equals(bytes) && fetched.contentType === 'image/jpeg'
    ? 'ok   getObject byte for byte'
    : `FAIL getObject ${String(fetched?.contentType)} ${String(fetched?.body.length)}`,
);

console.log((await storage.objectExists(key)) ? 'ok   objectExists' : 'FAIL objectExists');
const keys = await storage.listKeys('pieces/11111111-1111-1111-1111-111111111111/photos/');
console.log(keys.length === 1 && keys[0] === key ? 'ok   listKeys' : `FAIL listKeys ${JSON.stringify(keys)}`);

await storage.deleteObject(key);
console.log((await storage.getObject(key)) === null ? 'ok   deleteObject' : 'FAIL deleteObject');
console.log((await storage.objectExists(key)) === false ? 'ok   gone' : 'FAIL still there');

const down = new Storage({ ...config.s3, endpoint: 'http://127.0.0.1:9' });
await down
  .putObject('x', new Uint8Array([1]), 'text/plain')
  .then(() => console.log('FAIL outage not raised'))
  .catch((error: Error) => console.log(`ok   outage raised ${error.name}`));
