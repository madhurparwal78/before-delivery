import { config } from './config.js';
import { db } from './db.js';
import { json, route } from './http.js';
import { mailer } from './mail.js';
import { store } from './s3.js';
import { valkey } from './valkey.js';

const state = (up: boolean): 'up' | 'down' => (up ? 'up' : 'down');

/** Each service reports its availability from its one client; the same flags drive the banners and the 503s. */
export function healthRoutes(): void {
  route('GET', '/api/health', {
    auth: 'none',
    run: async () =>
      json(200, {
        status: 'ok',
        instance: config.instance,
        services: { postgres: state(db.available), valkey: state(valkey.available), minio: state(store.available), mail: state(mailer.available) },
      }),
  });
}
