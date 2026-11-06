// The job detail dialog, shared by every screen.
import type { Job } from "./types.js";
import { api, h, notice, alertNotice, openDialog } from "./lib.js";

export function openJobDialog(jobId: string): void {
  let handle: { close(): void } | null = null;
  void api<{ job: Job }>("GET", `/api/jobs/${jobId}`).then((res) => {
    if (res.status !== 200) return;
    const job = res.body.job;
    handle = openDialog({
      label: `Job ${job.id}`,
      onClose: undefined,
      build(root) {
        const cancellable = job.status === "queued" || job.status === "leased" || job.status === "running";
        root.append(
          h("header", {},
            h("h2", { text: `Job ${job.id}` }),
            h("button", { class: "btn btn-ghost", text: "Close", onclick: () => handle?.close() }),
          ),
          h("div", { class: "dialog-body" }, jobRows(job),
            cancellable
              ? h("div", { class: "dialog-actions" },
                  h("button", {
                    class: "btn",
                    text: `Cancel job ${job.id}`,
                    "aria-label": `Cancel job ${job.id}`,
                    onclick: async (e: Event) => {
                      const btn = e.target as HTMLButtonElement;
                      btn.textContent = "Cancelling…";
                      btn.disabled = true;
                      const r = await api<{ job: Job }>("POST", `/api/jobs/${job.id}/cancel`);
                      if (r.status === 200) {
                        notice(`Job ${job.id} cancelled; ${(r.body.job.released_micro / 1_000_000).toFixed(2)} credits released.`);
                        handle?.close();
                      } else if (r.status === 409) {
                        alertNotice(r.body.error?.message ?? "Nothing to cancel.");
                        handle?.close();
                      } else {
                        alertNotice(r.body.error?.message ?? "Something went wrong.");
                        btn.disabled = false;
                        btn.textContent = `Cancel job ${job.id}`;
                      }
                    },
                  }),
                )
              : null,
          ),
        );
      },
    });
  });
}

function jobRows(job: Job): HTMLElement {
  const dl = h("dl");
  const row = (k: string, v: unknown) => {
    dl.append(h("dt", { text: k }), h("dd", { text: v === null || v === undefined || v === "" ? "—" : String(v) }));
  };
  row("Model", job.model);
  row("Status", job.status);
  row("Priority", job.priority);
  row("Submitted by", job.submitted_by.name);
  row("Submitted", job.submitted_at);
  row("Started", job.started_at);
  row("Finished", job.finished_at);
  row("Attempts", job.attempts);
  row("Rate", (job.rate.micro_per_unit / 1_000_000).toFixed(6));
  row("Units", job.billed_units ?? job.estimated_units);
  row("Reserved", `${(job.reserved_micro / 1_000_000).toFixed(2)} credits`);
  row("Charged", job.charged_micro === null ? "—" : `${(job.charged_micro / 1_000_000).toFixed(2)} credits`);
  row("Released", `${(job.released_micro / 1_000_000).toFixed(2)} credits`);
  row("Outputs", job.outputs.join(", ") || "—");
  if (job.payload_visible) {
    row("Input", JSON.stringify(job.input ?? {}));
  } else {
    dl.append(h("dt", { text: "Input" }), h("dd", { text: "Hidden — restricted payload" }));
  }
  if (job.failure_reason) row("Failure", job.failure_reason);
  if (job.waiting_reason) row("Waiting", "Waiting for storage");
  if (job.queue_position !== null) row("Queue position", job.queue_position);
  return dl;
}
