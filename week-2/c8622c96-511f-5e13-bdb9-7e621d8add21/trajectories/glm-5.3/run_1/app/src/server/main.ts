import { boot } from "./app.js";

boot().then(() => {
  // The app is serving; the scheduler runs in the background.
}).catch((err) => {
  console.error("Saltprint Desk failed to start", err);
  process.exit(1);
});
