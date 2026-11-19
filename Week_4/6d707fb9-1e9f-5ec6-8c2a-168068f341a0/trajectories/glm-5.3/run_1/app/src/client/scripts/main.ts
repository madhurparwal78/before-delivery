// The main script: boot the router and register every screen.

import { startApp } from "./app.js";
import { registerHome } from "./home.js";
import { registerMethod } from "./method.js";
import { registerQuestions } from "./questions.js";
import { registerSignIn, registerSignUp } from "./auth.js";
import { registerStylesScreen } from "./styles.js";
import { registerStyleScreen } from "./style.js";
import { registerMaterialsScreen } from "./materials.js";
import { registerScenariosScreen } from "./scenarios.js";
import { registerLabelsScreen, registerLabelScreen } from "./labels.js";
import { registerRequestsScreen } from "./requests.js";
import { registerVisitsScreen, registerVisitScreen } from "./visits.js";
import { registerPassportsScreen, registerPassportScreen } from "./passports.js";
import { registerAnswerScreen } from "./answer.js";
import { registerSignOffScreen } from "./signoff.js";
import { route } from "./app.js";

route("/", false, registerHome);
route("/method", false, registerMethod);
route("/questions", false, registerQuestions);
route("/sign-in", false, registerSignIn);
route("/sign-up", false, registerSignUp);
route("/styles", true, registerStylesScreen);
route("/styles/[^/]+", true, registerStyleScreen);
route("/styles/[^/]+/materials", true, registerMaterialsScreen);
route("/styles/[^/]+/scenarios", true, registerScenariosScreen);
route("/labels", true, registerLabelsScreen);
route("/labels/[^/]+", true, registerLabelScreen);
route("/requests", true, registerRequestsScreen);
route("/visits", true, registerVisitsScreen);
route("/visits/[^/]+", true, registerVisitScreen);
route("/passports", true, registerPassportsScreen);
route("/p/[^/]+", false, registerPassportScreen);
route("/p/[^/]+/e/\\d+", false, registerPassportScreen);
route("/a/[^/]+", false, registerAnswerScreen);
route("/s/[^/]+", false, registerSignOffScreen);

startApp();
