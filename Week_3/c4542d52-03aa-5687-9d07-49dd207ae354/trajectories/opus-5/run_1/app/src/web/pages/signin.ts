import { formatCount } from "../../shared/format.js";
import { api, ApiFailure } from "../api.js";
import { announce, navigate, setPerson, startLiveSocket, type Page, type PageContext } from "../app.js";
import { clear, el } from "../dom.js";
import type { Person } from "../../shared/types.js";

let titleRevealed = false;

const PHOTOS = [
  ["/photos/robot-arms.jpg", "Robot arm in a Tidecraft cell"],
  ["/photos/workbench.jpg", "A Tidecraft workbench"],
  ["/photos/hands-at-a-desk.jpg", "Hands at a desk"],
  ["/photos/machine-shop.jpg", "Parts on a bench"],
] as const;

export function signInPage(context: PageContext): Page {
  return {
    async render(): Promise<void> {
      const masthead = await api<{ company: string; fully_diluted_total: number }>("/api/masthead").catch(() => ({
        company: "Tidecraft Robotics",
        fully_diluted_total: 0,
      }));
      clear(context.main);

      const mosaic = el("div", { class: "mosaic", "aria-hidden": "true" }, [
        el("img", { src: PHOTOS[0][0], alt: "", class: "mosaic-photo" }),
        el("div", { class: "mosaic-tile tile-red" }),
        el("img", { src: PHOTOS[1][0], alt: "", class: "mosaic-photo" }),
        el("div", { class: "mosaic-tile tile-grey" }),
        el("img", { src: PHOTOS[2][0], alt: "", class: "mosaic-photo" }),
        el("img", { src: PHOTOS[3][0], alt: "", class: "mosaic-photo" }),
      ]);
      const blackTile = el("div", { class: "mosaic-black" }, [
        el("span", { class: "display-figure" }, [formatCount(masthead.fully_diluted_total)]),
        el("span", { class: "display-caption" }, ["shares, fully diluted"]),
      ]);
      mosaic.append(blackTile);

      const title = el("h1", { class: titleRevealed ? "masthead-title" : "masthead-title reveal" }, [
        el("span", {}, ["Your shares,"]),
        " ",
        el("span", {}, ["on the record."]),
      ]);
      titleRevealed = true;

      const email = el("input", { type: "email", id: "signin-email", name: "email", autocomplete: "username" });
      const password = el("input", {
        type: "password",
        id: "signin-password",
        name: "password",
        autocomplete: "current-password",
      });
      const submit = el("button", { type: "submit", class: "primary" }, ["Sign in"]) as HTMLButtonElement;
      const failure = el("p", { class: "field-error", hidden: true });

      const form = el("form", { class: "column form", novalidate: true }, [
        el("div", { class: "field" }, [el("label", { for: "signin-email" }, ["Email"]), email]),
        el("div", { class: "field" }, [el("label", { for: "signin-password" }, ["Password"]), password]),
        failure,
        submit,
      ]) as HTMLFormElement;

      form.addEventListener("submit", (event) => {
        event.preventDefault();
        void submitForm();
      });

      async function submitForm(): Promise<void> {
        submit.textContent = "Signing in";
        submit.disabled = true;
        failure.hidden = true;
        try {
          const result = await api<{ person: Person }>("/api/session", {
            method: "POST",
            body: {
              email: (email as HTMLInputElement).value,
              password: (password as HTMLInputElement).value,
            },
          });
          setPerson(result.person);
          startLiveSocket();
          navigate("/");
          window.setTimeout(() => {
            const nameHeading = document.querySelector<HTMLElement>(".name-tile h1");
            if (nameHeading !== null) {
              nameHeading.tabIndex = -1;
              nameHeading.focus();
            }
          }, 50);
        } catch (error) {
          const message =
            error instanceof ApiFailure
              ? error.message
              : "That email and password don't match a Tidecraft register account.";
          failure.hidden = false;
          failure.textContent = message;
          announce(message);
          submit.textContent = "Sign in";
          submit.disabled = false;
        }
      }

      context.main.append(
        mosaic,
        el("div", { class: "axis-grid signin-body" }, [
          el("p", { class: "side-note standfirst" }, [
            "Tidecraft Robotics keeps its register here. Sign in to see what you own, what vests next and every deadline that applies to you.",
          ]),
          el("div", { class: "column" }, [title, form]),
        ]),
      );
    },
  };
}
