/** The contact page: the sales inquiry form that posts to /api/inquiries. */
import { esc, type RenderedPage } from "../layout.js";
import { marketingDocument } from "./chrome.js";
import { hero, pageTitle } from "./parts.js";

const MESSAGE_LIMIT = 5000;

interface InquiryField {
  name: string;
  label: string;
  autocomplete: string;
}

const TEXT_FIELDS = {
  email: { name: "email", label: "Email", autocomplete: "email" },
  firstName: { name: "first_name", label: "First name", autocomplete: "given-name" },
  lastName: { name: "last_name", label: "Last name", autocomplete: "family-name" },
  company: { name: "company", label: "Company", autocomplete: "organization" },
} satisfies Record<string, InquiryField>;

function errorSlot(name: string): string {
  return `<p class="field-error" id="inquiry-${name}-error" data-error-for="${name}" hidden></p>`;
}

function textField(field: InquiryField, type = "text"): string {
  return `<div class="field">
          <label for="inquiry-${field.name}">${esc(field.label)} <span class="required">(Required)</span></label>
          <input class="input" id="inquiry-${field.name}" name="${field.name}" type="${type}" autocomplete="${field.autocomplete}" aria-required="true" data-inquiry-field>
          ${errorSlot(field.name)}
        </div>`;
}

function inquiryForm(): string {
  return `<form class="card inquiry-form" novalidate data-inquiry-form>
        <h2 class="form-title">Send an inquiry</h2>
        ${textField(TEXT_FIELDS.email, "email")}
        <div class="field-pair">
          ${textField(TEXT_FIELDS.firstName)}
          ${textField(TEXT_FIELDS.lastName)}
        </div>
        ${textField(TEXT_FIELDS.company)}
        <div class="field">
          <label for="inquiry-message">Message <span class="required">(Required)</span></label>
          <textarea class="textarea" id="inquiry-message" name="message" rows="6" aria-required="true" aria-describedby="inquiry-message-count" data-inquiry-field></textarea>
          <p class="field-hint mono" id="inquiry-message-count" data-inquiry-count>0 / ${MESSAGE_LIMIT}</p>
          ${errorSlot("message")}
        </div>
        <div class="hp" aria-hidden="true"><input type="text" name="website" tabindex="-1" autocomplete="off"></div>
        <p class="form-message" data-form-message hidden></p>
        <button class="btn btn-primary" type="submit" data-inquiry-submit>Send inquiry</button>
      </form>`;
}

export function contactPage(): RenderedPage {
  return marketingDocument({
    title: pageTitle("Contact sales"),
    description: "Tell us about your company and a person on our team will get back to you shortly.",
    page: "contact",
    main: [
      hero({
        id: "contact-title",
        title: "Talk to our team",
        lede: "Tell us about your company and a person on our team will get back to you shortly.",
        className: "hero-compact",
      }),
      `<section class="band contact-band" aria-label="Contact form">
        <div class="container contact-grid">
          ${inquiryForm()}
          <div class="contact-aside">
            <h2 id="contact-next">What happens next</h2>
            <ol class="steps">
              <li class="step"><span class="step-number mono" aria-hidden="true">1</span><span>You send us a few lines about the company.</span></li>
              <li class="step"><span class="step-number mono" aria-hidden="true">2</span><span>Someone on our team reads it, not a script.</span></li>
              <li class="step"><span class="step-number mono" aria-hidden="true">3</span><span>We reply to the email you give us with next steps.</span></li>
            </ol>
          </div>
        </div>
      </section>`,
    ].join("\n"),
  });
}
