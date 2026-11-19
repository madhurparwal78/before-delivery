import { createServer } from "node:http";
import { config } from "./config.ts";
import { migrate } from "./db/migrate.ts";
import { dispatch } from "./http/router.ts";
import { registerAssets } from "./http/assets.ts";
import { registerApi } from "./api/index.ts";
import { registerPages } from "./pages/index.ts";
import { startJobs } from "./jobs/index.ts";

await migrate();
registerAssets();
registerApi();
registerPages();
startJobs();

const server = createServer((req, res) => {
  void dispatch(req, res, config.publicUrl);
});
server.requestTimeout = 0;
// Well past the 5-second refresh, so a screen's next read never meets a connection the server is just closing.
server.keepAliveTimeout = 65_000;
server.listen(config.port, "0.0.0.0", () => console.log(`Semenza Desk listening on ${config.port}`));
