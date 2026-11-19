import { startServer } from "./app.js";
import { configureTypes } from "./dates.js";

configureTypes()
  .then(() => startServer())
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
