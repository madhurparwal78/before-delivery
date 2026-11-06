// Outgoing email content, rendered once when the outbox row is written (brief: Services › Mail).
import type { Role } from "../../shared/api.js";
import { monthLabel } from "../../shared/months.js";

export interface RenderedEmail { subject: string; text: string; html: string }

const escapeHtml = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const ROLE_NAMES: Record<Role, string> = {
  head_of_product: "head of product",
  product_manager: "product manager",
  customer_success: "customer success",
};

function page(paragraphs: string[]): string {
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#F7F3EA;color:#16213E;font-family:Georgia,serif;font-size:16px;line-height:1.6">${paragraphs.join("")}</body></html>`;
}

const featureLine = (f: { name: string; publicDescription: string }): string =>
  f.publicDescription === "" ? f.name : `${f.name} — ${f.publicDescription}`;

/** "You asked, we shipped": only the recipient's own features from the release, in board order, published fields only. */
export function youAskedWeShipped(input: {
  contactName: string; workspaceName: string; releaseName: string; targetMonth: string;
  features: { name: string; publicDescription: string }[];
}): RenderedEmail {
  const live = `You asked for these, and they are now live in ${input.releaseName} (${monthLabel(input.targetMonth)}):`;
  const signOff = `— The ${input.workspaceName} product team`;
  const lines = input.features.map(featureLine);
  return {
    subject: `You asked, we shipped: ${input.releaseName}`,
    text: [`Hi ${input.contactName},`, "", live, "", ...lines, "", signOff, ""].join("\n"),
    html: page([
      `<p>Hi ${escapeHtml(input.contactName)},</p>`,
      `<p>${escapeHtml(live)}</p>`,
      `<ul>${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>`,
      `<p>${escapeHtml(signOff)}</p>`,
    ]),
  };
}

export function invitationEmail(input: { workspaceName: string; role: Role; link: string }): RenderedEmail {
  const intro = `You have been invited to join ${input.workspaceName} on Evidence Desk as a ${ROLE_NAMES[input.role]}.`;
  const action = "Choose your name and password to join:";
  return {
    subject: `You're invited to ${input.workspaceName} on Evidence Desk`,
    text: [intro, "", action, input.link, ""].join("\n"),
    html: page([
      `<p>${escapeHtml(intro)}</p>`,
      `<p>${escapeHtml(action)}<br><a href="${escapeHtml(input.link)}" style="color:#2346C8">${escapeHtml(input.link)}</a></p>`,
    ]),
  };
}
