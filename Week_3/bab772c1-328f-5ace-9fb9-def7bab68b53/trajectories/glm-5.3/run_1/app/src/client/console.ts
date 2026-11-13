// The browser entry point: the Missions page or one of the two consoles.

import { missionsMain } from "./missionsPage.js";
import { consoleMain } from "./consoleApp.js";

const page = document.body.dataset.page ?? "missions";

if (page === "missions") {
  void missionsMain();
} else if (page === "console" || page === "share") {
  void consoleMain(page === "share");
}
