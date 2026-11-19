import { createServer } from "node:http";
import path from "node:path";
import { handleRequest, type AppContext } from "./app.js";
import { readConfig } from "./config.js";
import { MediaLibrary } from "./media-library.js";
import { ObjectStore } from "./object-store.js";
import { SERVER_ERROR, sendError } from "./http.js";
import { loadStaticFiles } from "./static-files.js";

const config = readConfig(process.env);
const root = path.resolve(import.meta.dirname, "../../..");
const library = new MediaLibrary(new ObjectStore(config.storage), config.mediaProbeSeconds);

const files = await loadStaticFiles([
  { urlPrefix: "/assets/", directory: path.join(root, "public") },
  { urlPrefix: "/assets/js/", directory: path.join(root, "dist/web") },
]);
const context: AppContext = { config, library, files };

const server = createServer((request, response) => {
  handleRequest(context, request, response).catch((error: unknown) => {
    console.error(error);
    if (!response.headersSent) sendError(response, 500, SERVER_ERROR);
    else response.end();
  });
});

library.start();
server.listen(config.port, "0.0.0.0", () => {
  console.log(`Ottoline Rask Selected Builds listening on ${config.port}`);
});
