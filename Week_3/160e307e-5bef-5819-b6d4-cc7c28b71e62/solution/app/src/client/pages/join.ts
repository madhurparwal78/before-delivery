import { ApiFail, get, post } from "../api";
import { app, loadMe } from "../app";
import { h } from "../dom";
import { go } from "../router";
import type { Mount } from "../router";
import { deniedPage, topBar } from "../ui/shell";

interface RoomView {
  status: "open" | "full" | "closed";
  host: { id: string };
  guest: { id: string } | null;
}

const ALPHABET = /[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]/;

export const joinByLink: Mount = async ({ root, params }) => {
  const code = (params[0] ?? "").toUpperCase();
  let view: RoomView;
  try {
    view = await get<RoomView>(`/api/rooms/${code}`);
  } catch (error) {
    root.replaceChildren(deniedPage(error instanceof ApiFail && error.status === 404 ? "Room not found" : "Online play is unavailable right now."));
    return undefined;
  }
  const me = app.me;
  if (!me) return undefined;
  if (view.host.id === me.id || view.guest?.id === me.id) {
    go(`/room/${code}`, true);
    return undefined;
  }
  if (view.status === "closed") {
    root.replaceChildren(deniedPage("This room has closed"));
    return undefined;
  }
  if (view.status === "full") {
    root.replaceChildren(deniedPage("Room full", "This room already has two players."));
    return undefined;
  }
  const input = h("input", { id: "join-name", type: "text", class: "text-input", autocomplete: "off", value: me.name });
  const message = h("p", { class: "field-error-text", role: "alert" });
  const submit = h("button", { type: "submit", class: "btn btn-ink" }, "Join");
  const form = h(
    "form",
    {
      novalidate: true,
      onsubmit: async (event) => {
        event.preventDefault();
        submit.disabled = true;
        message.textContent = "";
        try {
          const name = input.value.trim();
          if (name !== me.name) await post("/api/me/name", { name });
          await post(`/api/rooms/${code}/join`);
          await loadMe();
          go(`/room/${code}`);
        } catch (error) {
          submit.disabled = false;
          if (error instanceof ApiFail && error.code === "ROOM_FULL") root.replaceChildren(deniedPage("Room full", "This room already has two players."));
          else if (error instanceof ApiFail && error.code === "ROOM_CLOSED") root.replaceChildren(deniedPage("This room has closed"));
          else if (error instanceof ApiFail && error.code === "NAME_TAKEN") message.textContent = "That name is taken. Try another.";
          else if (error instanceof ApiFail && (error.code === "NAME_INVALID" || error.code === "NAME_BLOCKED")) message.textContent = "Use 3 to 16 letters, numbers or underscores.";
          else message.textContent = "We couldn't join the room. Try again.";
        }
      },
    },
    h("label", { for: "join-name", class: "label" }, "Your name"),
    input,
    message,
    h("div", { class: "actions" }, submit),
  );
  root.replaceChildren(
    h("div", { class: "working" }, topBar(true), h("div", { class: "working-body" }, h("h1", { class: "page-title", tabindex: -1 }, `Join room ${code}`), form)),
  );
  return undefined;
};

export const joinByCode: Mount = ({ root }) => {
  const boxes = Array.from({ length: 6 }, (_, index) =>
    h("input", {
      type: "text",
      class: "code-box",
      maxlength: 1,
      autocomplete: "off",
      autocapitalize: "characters",
      spellcheck: "false",
      inputmode: "text",
      "aria-label": `Character ${index + 1} of 6`,
    }),
  );
  const message = h("p", { class: "field-error-text", role: "alert" });
  const submit = h("button", { type: "button", class: "btn btn-ink" }, "Join");
  const outage = (): boolean => app.outage;

  const fill = (text: string, from: number): void => {
    const letters = [...text.toUpperCase()].filter((c) => ALPHABET.test(c));
    letters.slice(0, 6 - from).forEach((letter, offset) => {
      (boxes[from + offset] as HTMLInputElement).value = letter;
    });
    boxes[Math.min(5, from + letters.length)]?.focus();
  };

  const join = async (): Promise<void> => {
    const code = boxes.map((b) => b.value).join("");
    if (code.length < 6) {
      message.textContent = "Enter all six characters.";
      return;
    }
    submit.disabled = true;
    message.textContent = "";
    try {
      await post(`/api/rooms/${code}/join`);
      go(`/room/${code}`);
    } catch (error) {
      submit.disabled = false;
      if (error instanceof ApiFail && error.code === "ROOM_FULL") go(`/join/${code}`);
      else if (error instanceof ApiFail && error.code === "ROOM_CLOSED") go(`/join/${code}`);
      else message.textContent = error instanceof ApiFail && error.status === 404 ? "No room has that code." : "We couldn't join the room. Try again.";
    }
  };

  boxes.forEach((box, index) => {
    box.addEventListener("input", () => {
      const value = box.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
      box.value = ALPHABET.test(value.slice(-1)) ? value.slice(-1) : "";
      if (box.value && index < 5) boxes[index + 1]?.focus();
    });
    box.addEventListener("keydown", (event) => {
      if (event.key === "Backspace" && box.value === "" && index > 0) {
        event.preventDefault();
        const previous = boxes[index - 1] as HTMLInputElement;
        previous.value = "";
        previous.focus();
      } else if (event.key === "Enter") {
        event.preventDefault();
        void join();
      }
    });
    box.addEventListener("paste", (event) => {
      event.preventDefault();
      fill(event.clipboardData?.getData("text") ?? "", 0);
    });
  });
  submit.addEventListener("click", () => void join());
  submit.disabled = outage();

  root.replaceChildren(
    h(
      "div",
      { class: "working" },
      topBar(true),
      h(
        "div",
        { class: "working-body" },
        h("h1", { class: "page-title", tabindex: -1 }, "Join with a code"),
        h("div", { role: "group", "aria-label": "Room code", class: "code-boxes" }, ...boxes),
        message,
        h("div", { class: "actions" }, submit),
      ),
    ),
  );
  return undefined;
};
