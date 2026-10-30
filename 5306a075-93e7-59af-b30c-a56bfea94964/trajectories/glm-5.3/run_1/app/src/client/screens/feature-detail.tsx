import type { FeatureDetail } from "../../shared/types.js";
import { api, ApiFailure } from "../api.js";

import { currentApp } from "../main.js";
import { feedback, statusLabel } from "../ui.js";
import { h, twoDecimals } from "../dom.js";
import { announceUnlink } from "./noteview.js";

/** The feature detail screen: details, scores, history, requests (DP-20). */
export async function renderFeatureDetail(
  _screen: HTMLElement,
  featureId: string,
  fail: (err: unknown) => void,
): Promise<HTMLElement> {
  const root = h("div", null);
  const app = currentApp()!;
  let detail: FeatureDetail;

  const load = async (): Promise<void> => {
    const result = await api.feature(featureId);
    detail = result.feature;
    render();
  };

  const render = (): void => {
    root.replaceChildren();
    root.appendChild(h("h2", null, detail.name));
    root.appendChild(h("p", { class: "status-chip" },
      `${statusLabel(detail.status)} · ${detail.rankTotal > 0 ? `rank ${detail.rank} of ${detail.rankTotal}` : "not ranked"} · priority ${twoDecimals(detail.priority)}`,
    ));

    const left = h("div", null);

    // Feature details form.
    if (app.user.role === "head_of_product" || app.user.role === "product_manager") {
      const nameInput = h("input", { type: "text", "aria-label": "Feature name", value: detail.name }) as HTMLInputElement;
      const descriptionInput = h("textarea", { "aria-label": "Public description" }) as HTMLTextAreaElement;
      descriptionInput.value = detail.publicDescription;
      const nameError = h("span", { class: "field-error" });
      const detailsForm = h(
        "form",
        {
          onsubmit: async (event: SubmitEvent) => {
            event.preventDefault();
            nameError.replaceChildren();
            feedback?.saveStatus("Saving details…");
            try {
              await api.saveDetails(detail.id, {
                name: nameInput.value,
                publicDescription: descriptionInput.value,
              });
              feedback?.saveStatus("Feature details saved.");
              history.replaceState(null, "", `/features/${detail.id}`);
              await load();
            } catch (err) {
              feedback?.saveStatus("");
              if (err instanceof ApiFailure) {
                nameError.replaceChildren(err.error.error.fields?.name ?? err.error.error.message);
              }
            }
          },
        },
        h("fieldset", { class: "panel" },
          h("legend", null, h("h3", null, "Feature details")),
          h("label", null, "Feature name"),
          nameInput,
          nameError,
          h("label", null, "Public description"),
          descriptionInput,
          h("div", { class: "dialog-actions" }, h("button", { type: "submit", class: "primary" }, "Save details")),
        ),
      );
      left.appendChild(detailsForm);
    }

    // Scores form.
    const effortInput = h("input", {
      type: "number",
      role: "spinbutton",
      "aria-label": "Effort",
      min: "1",
      max: "100",
      value: String(detail.effort),
    }) as HTMLInputElement;
    const confidenceInput = h("input", {
      type: "number",
      role: "spinbutton",
      "aria-label": "Confidence",
      min: "10",
      max: "100",
      value: String(detail.confidence),
    }) as HTMLInputElement;
    const effortError = h("span", { class: "field-error" });
    const confidenceError = h("span", { class: "field-error" });
    void api.objectives().then((objectives) => {
      const group = root.querySelector('[data-scores="fits"]');
      if (group === null) return;
      for (const objective of objectives.objectives) {
        const select = h("select", { "aria-label": `${objective.name} fit` });
        for (const [value, label] of [
          ["0", "None"],
          ["1", "Low"],
          ["2", "Medium"],
          ["3", "High"],
        ] as const) {
          const option = h("option", { value }, label);
          if (String(detail.fits[objective.id] ?? 0) === value) {
            (option as HTMLOptionElement).selected = true;
          }
          select.appendChild(option);
        }
        select.dataset.objectiveId = objective.id;
        group.appendChild(h("label", null, `${objective.name} fit`));
        group.appendChild(select);
      }
    });

    const scoresForm = h(
      "form",
      {
        onsubmit: async (event: SubmitEvent) => {
          event.preventDefault();
          effortError.replaceChildren();
          confidenceError.replaceChildren();
          feedback?.saveStatus("Saving scores…");
          const fits: Record<string, number> = {};
          for (const select of root.querySelectorAll<HTMLSelectElement>('[data-objective-id]')) {
            fits[select.dataset.objectiveId!] = Number.parseInt(select.value, 10);
          }
          try {
            await api.saveScores(detail.id, {
              version: detail.version,
              effort: Number.parseInt(effortInput.value, 10),
              confidence: Number.parseInt(confidenceInput.value, 10),
              fits,
            });
            feedback?.saveStatus(`Scores saved. Priority ${twoDecimals(detail.priority)}.`);
            await load();
          } catch (err) {
            if (err instanceof ApiFailure) {
              const failure = err.error.error as { message: string; current?: { version: number; effort: number; confidence: number; fits: Record<string, number> } };
              if (failure.current !== undefined) {
                effortInput.value = String(failure.current.effort);
                confidenceInput.value = String(failure.current.confidence);
                for (const select of root.querySelectorAll<HTMLSelectElement>('[data-objective-id]')) {
                  const level = failure.current.fits[select.dataset.objectiveId!];
                  if (level !== undefined) select.value = String(level);
                }
                detail.version = failure.current.version;
                feedback?.saveStatus("");
                feedback?.alert(
                  `Someone else saved these scores first. Current values: effort ${failure.current.effort}, confidence ${failure.current.confidence}%. The form now shows them; review and save again.`,
                );
              } else {
                const fields = err.error.error.fields ?? {};
                if (fields.effort !== undefined) effortError.replaceChildren(fields.effort);
                if (fields.confidence !== undefined) {
                  confidenceError.replaceChildren(fields.confidence);
                }
                feedback?.saveStatus("");
              }
            }
          }
        },
      },
      h("fieldset", { class: "panel" },
        h("legend", null, h("h3", null, "Scores")),
        h("div", { class: "form-row" },
          h("div", null, h("label", null, "Effort"), effortInput, effortError),
          h("div", null, h("label", null, "Confidence"), confidenceInput, confidenceError),
        ),
        h("div", { "data-scores": "fits" }),
        h("div", { class: "dialog-actions" },
          h("button", { type: "submit", class: "primary" }, "Save scores"),
        ),
      ),
    );
    left.appendChild(scoresForm);

    // Status buttons: only legal ones are shown (DP-24).
    const statusButtons = h("div", { class: "toolbar-actions" });
    if (app.user.role === "head_of_product" || app.user.role === "product_manager") {
      if (detail.status === "candidate") {
        statusButtons.appendChild(statusButton("Move to planned", "planned"));
      }
      if (detail.status === "planned") {
        statusButtons.appendChild(statusButton("Start work", "in_progress"));
      }
      if (detail.status !== "archived") {
        statusButtons.appendChild(statusButton("Archive", "archived"));
      } else {
        statusButtons.appendChild(statusButton("Restore", "restore"));
      }
    }
    left.appendChild(statusButtons);

    // Linked quotes.
    const quotes = h("ul", { class: "evidence-list", "aria-label": "Linked quotes" });
    for (const insight of detail.insights) {
      quotes.appendChild(
        h("li", null,
          h("a", { href: `/inbox/${insight.noteId}`, "data-nav": true }, `“${insight.quote}”`),
          ` · ${statusLabel(insight.importance)}`,
          h("button", {
            onclick: async () => {
              try {
                const result = await api.unlinkInsight(insight.id);
                announceUnlink(result.feature, result.before);
                await load();
              } catch (err) {
                fail(err);
              }
            },
          }, `Unlink ${detail.name}`),
        ),
      );
    }
    left.appendChild(h("h3", null, "Linked quotes"));
    left.appendChild(quotes);

    const right = h("div", null);
    // Derived numbers.
    right.appendChild(h("div", { class: "panel" },
      h("h3", null, "Derived numbers"),
      h("dl", null,
        h("dt", null, "Insights"), h("dd", { class: "num" }, String(detail.insightCount)),
        h("dt", null, "Companies"), h("dd", { class: "num" }, String(detail.companyCount)),
        h("dt", null, "Impact"), h("dd", { class: "num" }, String(detail.impact)),
        h("dt", null, "Objective fit"), h("dd", { class: "num" }, twoDecimals(detail.objectiveFit)),
        h("dt", null, "Priority"), h("dd", { class: "num" }, twoDecimals(detail.priority)),
        h("dt", null, "Rank"), h("dd", { class: "num" }, `${detail.rank} of ${detail.rankTotal}`),
      ),
    ));

    // Score history, newest first (DP-19).
    const historyList = h("ul", { class: "score-history", "aria-label": "Score history" });
    for (const version of detail.scoreVersions) {
      historyList.appendChild(
        h("li", { class: "num" },
          `v${version.version} · effort ${version.effort} · confidence ${version.confidence}% · priority ${twoDecimals(version.priority)}`,
        ),
      );
    }
    right.appendChild(h("div", { class: "panel" },
      h("h3", null, "Score history"),
      historyList,
    ));

    // Requested by.
    const requestedBy = h("ul", { "aria-label": "Requested by" });
    for (const request of detail.requestedBy) {
      requestedBy.appendChild(
        h("li", null,
          h("a", { href: `/companies/${request.companyId}`, "data-nav": true }, request.companyName),
          ` · ${request.insightCount} insights`,
        ),
      );
    }
    right.appendChild(h("div", { class: "panel" },
      h("h3", null, "Requested by"),
      requestedBy,
    ));

    root.appendChild(h("div", { class: "detail-layout" }, left, right));
  };

  const statusButton = (label: string, to: string): HTMLElement =>
    h("button", {
      onclick: async () => {
        try {
          await api.featureStatus(detail.id, to);
          feedback?.saveStatus(`Status changed to ${statusLabel(to === "restore" ? detailBeforeArchive() : to)}.`);
          await load();
        } catch (err) {
          if (err instanceof ApiFailure) {
            const message = err.error.error.message;
            feedback?.alert(message === "That change is not allowed."
              ? `${detail.name} can't move to that status.`
              : message);
          }
        }
      },
    }, label);

  const detailBeforeArchive = (): string => {
    return "planned";
  };

  try {
    await load();
  } catch (err) {
    fail(err);
  }
  return root;
}
