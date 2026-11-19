// The client entry: chooses the page controller from data-page.

import { mountTitle } from "./pages/title";
import { mountPlay } from "./pages/play";
import { mountAuth } from "./pages/auth";
import { mountHallEdit } from "./pages/hall-edit";
import { mountHallVisit } from "./pages/hall-visit";
import { mountBoard } from "./pages/board";
import { mountRanger } from "./pages/ranger";
import { mountBoards } from "./pages/boards";
import { mountPostcard } from "./pages/postcard";
import { mountTextWorld } from "./pages/text-world";
import { initLive } from "./live";

const page = document.body.dataset.page ?? "";

document.addEventListener("DOMContentLoaded", () => {
  initLive();
  switch (page) {
    case "title": mountTitle(); break;
    case "play": mountPlay(); break;
    case "signup": case "signin": case "confirm": mountAuth(page); break;
    case "hall-edit": mountHallEdit(); break;
    case "hall-visit": mountHallVisit(); break;
    case "board": mountBoard(); break;
    case "ranger": mountRanger(); break;
    case "boards": mountBoards(); break;
    case "postcard": mountPostcard(); break;
    case "text-world": void mountTextWorld(); break;
    default: break;
  }
});
