import { render } from "preact";
import "./styles.css";
import { Account } from "./account/Account.js";
import { Checkin } from "./checkin/Checkin.js";
import { ContentDesk } from "./desk/ContentDesk.js";
import { Desk } from "./desk/Desk.js";
import { Site } from "./public/Site.js";
import { Page } from "./ui/kit.js";

function NotFound() {
  return (
    <Page title="Not found">
      <div class="notfound">
        <p class="eyebrow mono">404</p>
        <h1 class="headline">
          <span class="headline__line">This page is not</span> <em class="headline__line">on the programme</em>
        </h1>
        <a class="button button--primary" href="/">
          Back to Opaline Bench Days
        </a>
      </div>
    </Page>
  );
}

const PAGES: Record<string, () => preact.JSX.Element> = {
  "/": Site,
  "/account": Account,
  "/desk": Desk,
  "/desk/content": ContentDesk,
  "/checkin": Checkin,
};

const Screen = PAGES[location.pathname.replace(/\/+$/, "") || "/"] ?? NotFound;
const root = document.getElementById("app");
if (root) render(<Screen />, root);
