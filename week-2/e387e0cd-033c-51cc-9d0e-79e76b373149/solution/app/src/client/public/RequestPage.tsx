// The private data request page a counterparty's compliance contact opens from the mail, often on a phone. Every
// state (live, answered, ended) and the countdown come from the server; the device clock is never read.
import type { ComponentChildren } from "preact";
import { useRef, useState } from "preact/hooks";
import { api } from "../api";
import { usePoll, useResource } from "../hooks";
import { Heading } from "../router";
import { feedback, say, useStore } from "../store";
import { ActionNote, ChoiceGroup, Field, FieldError, Problems, Refusal, submit, useForm } from "../ui/forms";
import { Icon } from "../ui/Icon";
import { Fig } from "../ui/Table";
import { formatCountdown, formatCrypto } from "../../shared/format";
import { NotFoundContent } from "./NotFound";
import { PublicPage } from "./chrome";

interface RequestPageBody {
  caseReference: string;
  asset: string;
  amount: string;
  fromAddressMasked: string;
  toAddressMasked: string;
  requestingExchange: string;
  status: "live" | "answered";
  endsAt: string;
  remainingSeconds: number;
  now: string;
}

function RequestStatus() {
  const current = useStore(feedback);
  return <p role="status" aria-label="Request status" class="sr-only">{current?.text ?? ""}</p>;
}

function Shell({ children }: { children: ComponentChildren }) {
  return (
    <main class="request-page">
      <div class="request-column">
        <p class="request-brand">
          <svg class="wordmark-mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.5" />
            <circle cx="12" cy="12" r="3" fill="currentColor" />
          </svg>
          <span>Lanternline Handshake Desk</span>
        </p>
        <Heading>Travel Rule data request</Heading>
        {children}
        <RequestStatus />
      </div>
    </main>
  );
}

export function RequestPage({ token }: { token: string }) {
  const path = `/api/request-pages/${encodeURIComponent(token)}`;
  const [loaded, reload] = useResource<{ page: RequestPageBody }>(path);
  usePoll(() => reload(), 1000, loaded.state === "ready");
  if (loaded.state === "failed") {
    if (loaded.status !== 410) return <PublicPage><NotFoundContent /></PublicPage>;
    return (
      <Shell>
        <p class="request-ended"><Icon name="info" size={20} /><span>{loaded.error.message}</span></p>
      </Shell>
    );
  }
  if (loaded.state === "loading") return <Shell><div class="skeleton" aria-busy="true"><span /><span /><span /></div></Shell>;
  const page = loaded.data.page;
  return (
    <Shell>
      <p class="muted">{page.requestingExchange} asks your compliance team to confirm the Travel Rule data of a withdrawal to your exchange.</p>
      <dl class="facts request-facts">
        <dt>Case reference</dt>
        <dd><Fig>{page.caseReference}</Fig></dd>
        <dt>Asset and amount</dt>
        <dd><Fig>{formatCrypto(page.asset, page.amount)}</Fig></dd>
        <dt>From address</dt>
        <dd><Fig>{page.fromAddressMasked}</Fig></dd>
        <dt>To address</dt>
        <dd><Fig>{page.toAddressMasked}</Fig></dd>
        <dt>Requesting exchange</dt>
        <dd>{page.requestingExchange}</dd>
      </dl>
      {page.status === "answered" ? (
        <>
          <ActionNote action="send-answer" />
          <p class="note note-success request-answered"><Icon name="check" size={20} /><span>Answer received. Thank you.</span></p>
        </>
      ) : (
        <>
          <p role="timer" aria-label="Page countdown" class="request-countdown">
            This page ends in <Fig>{formatCountdown(page.remainingSeconds)}</Fig>.
          </p>
          <AnswerForm path={path} onAnswered={() => reload()} />
        </>
      )}
    </Shell>
  );
}

function AnswerForm({ path, onAnswered }: { path: string; onAnswered: () => void }) {
  const form = useForm({ answer: "accepted", note: "" });
  const [file, setFile] = useState<File | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const certificateId = form.fieldId("certificate");
  const onSubmit = (event: Event) => {
    event.preventDefault();
    const body = new FormData();
    body.set("answer", form.values.answer);
    body.set("note", form.values.note);
    if (file) body.set("certificate", file, file.name);
    void submit(form, {
      action: "send-answer",
      pending: "Sending answer…",
      call: () => api<unknown>("POST", `${path}/answer`, { body }),
      done: () => {
        say("send-answer", "Answer sent. Thank you.", "success");
        onAnswered();
      },
    });
  };
  return (
    <form class="form request-form" noValidate onSubmit={onSubmit}>
      <Problems form={form} order={["answer", "certificate", "note"]} />
      <Refusal form={form} />
      <ChoiceGroup name="answer" label="Answer" value={form.values.answer} idBase={form.fieldId("answer")}
        options={[{ value: "accepted", label: "Accepted" }, { value: "rejected", label: "Rejected" }]}
        onChange={(v) => form.set("answer", v)} error={form.errors.answer} />
      <div class="field">
        <span class="field-label" id={`${certificateId}-label`}>Licence certificate</span>
        <div class="certificate">
          <button type="button" id={certificateId} class="button button-quiet button-icon-text"
            aria-describedby={form.errors.certificate ? `${certificateId}-error` : undefined}
            onClick={() => input.current?.click()}>
            <Icon name="upload" />
            <span>Choose certificate</span>
          </button>
          <span class={file ? "certificate-name" : "certificate-name muted"}>{file ? file.name : "PNG, JPEG or WebP, up to 5,000,000 bytes"}</span>
          <input ref={input} type="file" class="sr-only" tabIndex={-1} aria-label="Licence certificate" accept="image/png,image/jpeg,image/webp"
            onChange={(e) => setFile(e.currentTarget.files?.[0] ?? null)} />
        </div>
        {form.errors.certificate && <FieldError id={`${certificateId}-error`} text={form.errors.certificate} />}
      </div>
      <Field form={form} name="note" label="Note" multiline rows={4} />
      <div class="request-bar" data-sticky-bar>
        <ActionNote action="send-answer" />
        <button type="submit" class="button button-primary request-send" disabled={form.busy}>Send answer</button>
      </div>
    </form>
  );
}
