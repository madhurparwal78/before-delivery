// The claim page: redeems the postbox key in its own address, says how it went and offers the
// one way back the server stored with the key. It never leads to another origin.
import "../styles/claim.css";
import { errorCode, send } from "../lib/api";
import { h } from "../lib/dom";
import { Notices } from "../lib/notices";
import { paper } from "../lib/paper";

const REFUSALS: Record<string, string> = {
  link_expired: "This postbox key has expired. Ask for a new one.",
  link_used: "This postbox key was already used.",
  link_invalid: "This postbox key doesn't fit any postbox.",
};

/** Only a same-origin path from the server's answer is ever followed. */
const ownPath = (value: unknown): string =>
  typeof value === "string" && value.startsWith("/") && !value.startsWith("//") && !value.includes("\\") ? value : "/";

async function claim(): Promise<void> {
  const root = document.getElementById("claim")!;
  const notices = new Notices();
  const message = h("p", { class: "claim-message" }, "Opening your postbox…");
  const card = paper(h("section", { class: "claim-card", "aria-labelledby": "claim-title" }, h("h1", { id: "claim-title" }, "Your postbox"), message));
  root.replaceChildren(notices.el, card);
  notices.say("Opening your postbox…", true);
  const token = new URLSearchParams(location.search).get("token") ?? "";
  const answer = await send<{ return_to: string; display_name: string; balance: number }>({
    method: "POST",
    path: "/api/auth/redeem",
    body: { token },
  }).catch(() => null);
  let destination = "/";
  let label = "Walk on Bramble";
  if (answer?.status === 200) {
    destination = ownPath(answer.data.return_to);
    if (destination !== "/") label = "Open the console";
    message.textContent = "Save claimed. Your stamps travel with you now.";
    card.append(h("p", { class: "claim-detail" }, `Signed in as ${answer.data.display_name} · ${answer.data.balance} stamps`));
  } else {
    message.textContent = (answer && REFUSALS[errorCode(answer)]) ?? "Something went wrong on Bramble.";
  }
  notices.say(message.textContent);
  const go = h("button", { type: "button", class: "button button-primary" }, label);
  go.addEventListener("click", () => location.assign(new URL(destination, location.origin).href));
  card.append(go);
  go.focus();
}

void claim();
