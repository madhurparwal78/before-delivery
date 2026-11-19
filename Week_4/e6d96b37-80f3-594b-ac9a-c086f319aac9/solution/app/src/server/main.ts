// Flan desk server: binds 0.0.0.0 on APP_PUBLIC_PORT and serves health at once; the schema, bucket,
// realm and default desk are applied in the background and retried by the requests that need them.

import { createServer } from "node:http";
import { config } from "./config.js";
import { ensureSchema } from "./db.js";
import { ensureDefaultDesk, warmPictures } from "./fixtures/seed.js";
import { router } from "./http.js";
import { configureRealm } from "./keycloakSetup.js";
import { startListening } from "./live.js";
import { ensureBucket } from "./minio.js";
import { routes } from "./routes.js";

const server = createServer(router(routes));
server.requestTimeout = 0;
server.listen(config.port, "0.0.0.0", () => {
  startListening();
  setImmediate(() => {
    warmPictures();
    void ensureSchema()
      .then(() => Promise.allSettled([ensureBucket(), configureRealm()]))
      .then(() => ensureDefaultDesk())
      .catch(() => undefined);
  });
});
