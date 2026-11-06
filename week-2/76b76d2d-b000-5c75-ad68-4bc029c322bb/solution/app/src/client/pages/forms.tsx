import { useState } from "preact/hooks";
import { api } from "../api.ts";
import { useApp } from "../context.tsx";
import { Feedback, Field, useAction } from "../ui.tsx";

export function BookingLinkPage() {
  const { t } = useApp();
  const [ref, setRef] = useState("");
  const [email, setEmail] = useState("");
  const action = useAction();
  const submit = (event: Event) => {
    event.preventDefault();
    void action.run(() => api<{ status: "accepted" }>("POST", "/api/guest/booking-links", { booking_ref: ref.trim(), email: email.trim() }), () => t.bookingLinkDone);
  };
  return (
    <section class="page narrow">
      <h1 tabIndex={-1} class="page-title">{t.bookingLinkHeading}</h1>
      <p class="lede">{t.bookingLinkIntro}</p>
      <form class="stack-form" noValidate onSubmit={submit}>
        <Field label={t.bookingReference} value={ref} onInput={setRef} error={action.fields["booking_ref"]} />
        <Field label={t.email} type="email" value={email} onInput={setEmail} autocomplete="email" error={action.fields["email"]} />
        <button type="submit" class="button primary" disabled={action.busy}>{action.busy ? t.working : t.emailLink}</button>
        <Feedback statusName={t.formStatus} alertName={t.formError} status={action.status} error={action.error} />
      </form>
    </section>
  );
}

export function ContactPage() {
  const { t } = useApp();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const action = useAction();
  const submit = (event: Event) => {
    event.preventDefault();
    void action.run(
      () => api<{ enquiry: { ref: string; state: "open" } }>("POST", "/api/enquiries", { name, email, subject, message }),
      (data) => t.enquiryDone(data.enquiry.ref),
    );
  };
  return (
    <section class="page narrow">
      <h1 tabIndex={-1} class="page-title">{t.contactHeading}</h1>
      <form class="stack-form" noValidate onSubmit={submit}>
        <Field label={t.fullName} value={name} onInput={setName} autocomplete="name" error={action.fields["name"]} />
        <Field label={t.email} type="email" value={email} onInput={setEmail} autocomplete="email" error={action.fields["email"]} />
        <Field label={t.subject} value={subject} onInput={setSubject} error={action.fields["subject"]} />
        <Field label={t.messageField} value={message} onInput={setMessage} multiline error={action.fields["message"]} />
        <button type="submit" class="button primary" disabled={action.busy}>{action.busy ? t.working : t.sendEnquiry}</button>
        <Feedback statusName={t.formStatus} alertName={t.formError} status={action.status} error={action.error} />
      </form>
    </section>
  );
}
