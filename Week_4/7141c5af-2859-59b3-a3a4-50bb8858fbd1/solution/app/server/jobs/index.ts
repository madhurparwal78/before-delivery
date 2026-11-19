import { startClosureJob } from "./closure.ts";
import { startMailJob } from "./mail.ts";
import { startSearchRebuild } from "./searchRebuild.ts";
import { startSeedFilesJob } from "./seedFiles.ts";
import { startDossierJob } from "./dossier.ts";

export function startJobs(): void {
  startSearchRebuild();
  startClosureJob();
  startMailJob();
  startSeedFilesJob();
  startDossierJob();
}
