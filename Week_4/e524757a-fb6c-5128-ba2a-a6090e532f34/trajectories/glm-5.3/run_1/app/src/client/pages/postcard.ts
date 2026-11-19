// The public read-only postcard page.

import { el, api, ApiCallError } from "../ui/core";

interface PostcardAnswer { postcard: { id: string; image_url: string; creature_name: string; total: number; island_name: string; line: string; sender_name: string } }

export function mountPostcard(): void {
  const main = document.getElementById("main");
  if (!main) return;
  main.innerHTML = "";
  void build(main);
}

async function build(main: HTMLElement): Promise<void> {
  const id = location.pathname.split("/").pop() ?? "";
  const page = el("div", { class: "postcard-page" });
  const answer = await api<PostcardAnswer>("GET", `/api/postcards/${encodeURIComponent(id)}`).catch(err => err);
  if (answer instanceof ApiCallError) {
    page.append(el("h1", {}, "No postcard here"));
    main.append(page);
    return;
  }
  const postcard = answer.postcard;
  page.append(el("h1", {}, "A postcard"));
  const frame = el("div", { class: "postcard-frame" });
  frame.append(el("img", { src: postcard.image_url, alt: `${postcard.creature_name} photo` }));
  const fields = el("div", { class: "postcard-fields" });
  fields.append(fieldLine("Creature", postcard.creature_name));
  fields.append(fieldLine("Score", `${postcard.total} points`));
  fields.append(fieldLine("Island", postcard.island_name));
  frame.append(fields);
  const line = el("p", { class: "postcard-line", text: postcard.line });
  frame.append(line);
  frame.append(el("p", {}, `Sent by ${postcard.sender_name}`));
  page.append(frame);
  main.append(page);
}

function fieldLine(name: string, value: string): HTMLElement {
  const div = el("div", {});
  div.append(el("span", {}, name));
  div.append(el("span", {}, value));
  return div;
}
