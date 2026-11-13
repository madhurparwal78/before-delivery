import { applySchema } from "./db/schema";
import { markServing, waitForDatabase } from "./db/pool";
import { startServer } from "./http/server";
import { applicationRoutes } from "./routes/applications";
import { authRoutes } from "./routes/auth";
import { channelRoutes } from "./routes/channels";
import { companyRoutes } from "./routes/companies";
import { employerRoutes } from "./routes/employer";
import { founderRoutes } from "./routes/founder";
import { gradingRoutes } from "./routes/grading";
import { jobRoutes } from "./routes/jobs";
import { liveRoutes } from "./routes/live";
import { moderationRoutes } from "./routes/moderation";
import { postRoutes } from "./routes/posts";
import { startDueJobs, runDueJobs } from "./services/dueJobs";
import { startLiveHub } from "./services/liveHub";
import { seedMissing } from "./services/seed";

process.on("unhandledRejection", (reason) => console.error("unhandled rejection:", reason));

startServer([
  ...authRoutes, ...companyRoutes, ...postRoutes, ...moderationRoutes, ...jobRoutes, ...employerRoutes,
  ...applicationRoutes, ...channelRoutes, ...founderRoutes, ...gradingRoutes, ...liveRoutes,
]);

void (async () => {
  await waitForDatabase();
  await applySchema();
  await seedMissing();
  markServing();
  startLiveHub();
  startDueJobs();
  await runDueJobs();
})().catch((error: unknown) => {
  console.error("startup failed:", error);
  process.exit(1);
});
