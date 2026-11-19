import { startRouter } from "./lib/router.js";
import { primeSession } from "./lib/header.js";

void primeSession().then(() => {
  const root = document.getElementById("app");
  if (root) startRouter(root);
});
