import { apiJson, el, navigate, ApiError } from "./api.js";
import { openDialog, firstFieldError, errorMessage } from "./dialogs.js";

interface Vessel { id: string; name: string; kind: string; current_offset_minutes: number }

/** `/fleet` — the owner-master's vessels, and adding one. */
export async function renderFleet(): Promise<void> {
  document.title = "Your vessels — Sixbell Rest Log";
  const app = document.getElementById("app")!;
  app.textContent = "";

  const feedback = el("p", { class: "status", role: "status", "aria-live": "polite", "aria-label": "Feedback" });
  const heading = el("h1", {}, "Your vessels");
  const signOut = el("button", { type: "button" }, "Sign out");
  signOut.addEventListener("click", async () => {
    await fetch("/api/session", { method: "DELETE" });
    navigate("/");
  });

  const listPane = el("section", { class: "pane", "aria-label": "Your vessels" },
    el("span", { class: "pane-label" }, "Your vessels"));
  const list = el("ul");
  listPane.append(list);

  const addVessel = el("button", { type: "button", class: "primary" }, "Add a vessel");

  app.append(el("header", {}, heading, signOut), feedback, listPane, addVessel);

  const vessels = await apiJson<{ vessels: Vessel[] }>("/api/vessels");
  for (const vessel of vessels.vessels) {
    const link = el("a", { href: `/vessels/${vessel.id}`, class: "button" }, vessel.name);
    const item = el("li", {}, link, el("span", { class: "muted small" }, ` ${vessel.kind}, offset ${vessel.current_offset_minutes} minutes`));
    list.append(item);
  }

  addVessel.addEventListener("click", () => {
    openDialog({
      label: "Add a vessel",
      fields: [
        { name: "vessel-name", type: "text" },
        { name: "kind", type: "select", options: ["workboat", "survey_boat", "coaster", "charter_yacht"] },
        { name: "initial-offset", type: "text" },
      ],
      submitLabel: "Save vessel",
    }, addVessel, async (values) => {
      feedback.textContent = "Saving vessel.";
      try {
        const vessel = await apiJson<{ id: string }>("/api/vessels", {
          method: "POST",
          body: JSON.stringify({
            name: values["vessel-name"] ?? "",
            kind: values.kind,
            initial_offset_minutes: Number(values["initial-offset"]),
          }),
        });
        feedback.textContent = "Vessel saved.";
        navigate(`/vessels/${vessel.id}`);
        return;
      } catch (error) {
        feedback.textContent = dialogVesselError(error);
        return firstFieldError(error);
      }
    });
  });
}

function dialogVesselError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 409 && error.code === "vessel_limit") return "You already run four vessels.";
    if (error.fieldErrors) return Object.values(error.fieldErrors)[0] ?? "Something went wrong. Try again.";
  }
  return errorMessage(error);
}
