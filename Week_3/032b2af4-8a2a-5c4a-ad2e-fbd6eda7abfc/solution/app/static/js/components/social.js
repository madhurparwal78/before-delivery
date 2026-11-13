import { api } from "../core/api.js";
import { h, icon, notice } from "../core/dom.js";
import { dateTime } from "../core/format.js";
import { avatar } from "./charts.js";

/**
 * The kudos toggle. It raises the count at once and plays the pop; when the server refuses, the previous pressed
 * state and count come back and an alert says so. `onChange(count)` lets the page keep other readouts in step.
 */
export function kudosButton(activity, { onChange } = {}) {
  let given = activity.kudos_given;
  let count = activity.kudos_count;
  const countNode = h("span", { class: "kudos-count", text: String(count) });
  const button = h("button", { class: "kudos-btn", type: "button", "aria-pressed": String(given) },
    icon("thumb"), h("span", { class: "sr-only", text: "Give kudos," }), countNode);
  const wrap = h("span", { class: "kudos-wrap" }, button);

  const paint = () => {
    button.setAttribute("aria-pressed", String(given));
    countNode.textContent = String(count);
    onChange?.(count, given);
  };

  button.addEventListener("click", async () => {
    const before = { given, count };
    const adding = !given;
    given = adding;
    count += adding ? 1 : -1;
    paint();
    if (adding) {
      button.classList.remove("pop");
      void button.offsetWidth;
      button.classList.add("pop");
    }
    wrap.querySelector("[role=alert]")?.remove();
    const result = await api(`/api/activities/${activity.id}/kudos`, { method: adding ? "POST" : "DELETE" });
    if (result.ok) {
      count = result.data?.kudos_count ?? count;
      paint();
    } else {
      ({ given, count } = before);
      paint();
      wrap.append(notice("error", "Kudos could not be saved"));
    }
  });
  button.addEventListener("animationend", () => button.classList.remove("pop"));
  return wrap;
}

/** The comment thread with its form. A refused comment never enters the thread and its text stays in the field. */
export function commentThread(activity, me, { onCount } = {}) {
  const list = h("ul", { class: "comment-list", "aria-label": "Comments" });
  const field = h("textarea", { class: "textarea", id: "comment-text", name: "text", rows: "3", maxlength: "500" });
  const alertSlot = h("div", {});
  const post = h("button", { class: "btn btn-primary btn-pill", type: "submit", text: "Post" });
  const form = h("form", { class: "comment-form", novalidate: true },
    h("div", { class: "field" }, h("label", { for: "comment-text", text: "Add a comment" }), field), alertSlot, post);
  const empty = h("p", { class: "muted", text: "No comments yet. Be the first to cheer them on." });
  let total = 0;

  const row = (comment) => {
    const removable = comment.athlete_id === me.id || activity.athlete_id === me.id;
    const item = h("li", { class: "comment" },
      avatar(comment.athlete_name),
      h("div", {}, h("p", {}, h("strong", { text: comment.athlete_name }), " ", h("span", { class: "small muted", text: dateTime(comment.created_at, me.time_zone) })), h("p", { text: comment.text })),
      removable ? h("button", { class: "icon-button", type: "button", "aria-label": `Delete comment by ${comment.athlete_name}` }, icon("close")) : null);
    item.querySelector("button")?.addEventListener("click", async () => {
      const result = await api(`/api/comments/${comment.id}`, { method: "DELETE" });
      if (result.ok) {
        item.remove();
        total -= 1;
        sync();
      }
    });
    return item;
  };
  const sync = () => {
    empty.hidden = total > 0;
    onCount?.(total);
  };

  api(`/api/activities/${activity.id}/comments`).then((result) => {
    if (!result.ok) return;
    for (const comment of result.data.comments) list.append(row(comment));
    total = result.data.comments.length;
    sync();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    alertSlot.replaceChildren();
    post.disabled = true;
    const result = await api(`/api/activities/${activity.id}/comments`, { method: "POST", body: { text: field.value } });
    post.disabled = false;
    if (result.ok) {
      list.append(row(result.data));
      field.value = "";
      total += 1;
      sync();
    } else {
      alertSlot.append(notice("error", "Comment could not be posted"));
    }
  });
  return h("div", { class: "comments" }, h("h3", { text: "Comments" }), list, empty, form);
}
