import { createServer } from "node:http";
import { registerAerodromeRoutes } from "./aerodromes.ts";
import { registerAuthRoutes } from "./auth.ts";
import { registerClassroomRoutes } from "./classroom.ts";
import { config, timers, today } from "./config.ts";
import { connectDatabase } from "./db.ts";
import { registerExerciseRoutes } from "./exercise.ts";
import { registerGradingRoutes } from "./grading.ts";
import { handle, route } from "./http.ts";
import { registerRecordRoutes } from "./records.ts";
import { registerReportRoutes } from "./reports.ts";
import { registerScenarioRoutes } from "./scenarios.ts";
import { startTicker } from "./sessions.ts";
import { attachSockets } from "./socket.ts";

route("GET", "/api/health", async () => ({ status: "ok" }), { database: false });
route(
  "GET",
  "/api/config",
  async () => ({ today: today(), timeZone: config.timeZone, simClock: config.simClock, timers: { ...timers, ...publicLimits() } }),
);

function publicLimits(): Record<string, number> {
  return {
    seatGraceSeconds: config.seatGraceSeconds,
    inviteTtlHours: config.inviteTtlHours,
    verifyTtlHours: config.verifyTtlHours,
    commandsPerMinute: config.commandsPerMinute,
    layoutMaxBytes: config.layoutMaxBytes,
  };
}

registerAuthRoutes();
registerClassroomRoutes();
registerAerodromeRoutes();
registerScenarioRoutes();
registerExerciseRoutes();
registerRecordRoutes();
registerReportRoutes();
registerGradingRoutes();

const server = createServer((req, res) => {
  void handle(req, res);
});
attachSockets(server);
server.listen(config.port, "0.0.0.0");

void connectDatabase().then(startTicker);
