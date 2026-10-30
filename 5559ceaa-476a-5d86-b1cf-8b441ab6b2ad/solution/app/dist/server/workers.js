import { advanceCheckpoint, pendingCheckpoints } from "./checkpoints.js";
import { deleteListed } from "./deletions.js";
import { sweepQuarantine } from "./imports.js";
import { retryQueued } from "./outbox.js";
function every(seconds, name, work) {
    let running = false;
    setInterval(() => {
        if (running)
            return;
        running = true;
        work()
            .catch((error) => console.error(`${name} failed:`, error instanceof Error ? error.message : error))
            .finally(() => (running = false));
    }, seconds * 1000).unref();
}
/** Background work that needs no request and no restart; every item is claimed so instances never repeat it. */
export function startWorkers() {
    every(2, "quarantine sweep", sweepQuarantine);
    every(3, "checkpoint uploads", async () => {
        for (const id of await pendingCheckpoints())
            await advanceCheckpoint(id);
    });
    every(5, "mail retry", retryQueued);
    every(5, "storage deletions", deleteListed);
}
