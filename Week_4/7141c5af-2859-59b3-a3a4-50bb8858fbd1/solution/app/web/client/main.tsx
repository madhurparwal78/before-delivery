import type { JSX } from "preact";
import { Fragment, render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { type ClientCopyId, clientCopy, clientDate } from "../../server/domain/copy.ts";
import { parseNote } from "../../server/domain/markup.ts";
import { grainSvg } from "../shared/dots.ts";
import { onFocusTaken } from "../shared/focusView.ts";
import { announce } from "../desk/lib/announce.ts";
import { ApiFailure, get, post } from "../desk/lib/api.ts";
import { Dialog, useDialog } from "../desk/lib/dialog.tsx";
import { AsyncButton, Field, Problems, useForm } from "../desk/lib/forms.tsx";
import { onRefreshState, startRefresh, useLive } from "../desk/lib/live.ts";
import { Slider } from "../desk/lib/slider.tsx";
import type { ClientBoot, ClientPageBody, NoteKind } from "./types.ts";

const boot = JSON.parse((document.getElementById("boot") as HTMLElement).textContent as string) as ClientBoot;
const language = boot.page.language;
const words = (id: ClientCopyId, values?: Record<string, string | number>): string => clientCopy(id, language, values);
const address = `/api/client-pages/${boot.token}`;

const KINDS: Record<NoteKind, ClientCopyId> = { tear: "C43", crack: "C44", stain: "C45", looseJoint: "C46", woodworm: "C47" };

/** An ended or erased page is the server's to print, so a read that finds one goes back to the server. */
async function readPage(): Promise<ClientPageBody> {
  try {
    return (await get<{ page: ClientPageBody }>(address)).page;
  } catch (error) {
    if (error instanceof ApiFailure && (error.status === 404 || error.status === 410)) window.location.reload();
    throw error;
  }
}

function Note({ note }: { note: string }): JSX.Element {
  return (
    <>
      {parseNote(note).map((part, index) => {
        if (part.kind === "bold") return <strong key={index}>{part.text}</strong>;
        if (part.kind === "italic") return <em key={index}>{part.text}</em>;
        if (part.kind === "link") return <a key={index} href={part.address}>{part.text}</a>;
        return part.text;
      })}
    </>
  );
}

function Pictures(): JSX.Element {
  if (!boot.photographs.before || !boot.photographs.after) {
    return <div class="client-picture client-picture--empty">{words("C50")}</div>;
  }
  return (
    <Slider
      name={words("C03")}
      valueText={(share) => words("C29", { n: share })}
      before={{ src: `${address}/photographs/before`, alt: words("C30"), caption: words("C27") }}
      after={{ src: `${address}/photographs/after`, alt: words("C31"), caption: words("C28") }}
    />
  );
}

function Cover({ page }: { page: ClientPageBody }): JSX.Element {
  const material = page.material;
  if (!material) return <p>{words("C40")}</p>;
  return (
    <div class="client-cover">
      <div class="client-grain" role="img" aria-label={words("C32")} dangerouslySetInnerHTML={{ __html: grainSvg(material.code, material.name).replace("<svg ", '<svg preserveAspectRatio="xMidYMid slice" ') }} />
      <dl class="facts">
        <dt>{words("C34")}</dt>
        <dd>
          {material.name} {material.code}
        </dd>
        {material.lot ? (
          <>
            <dt>{words("C33")}</dt>
            <dd>{material.lot}</dd>
          </>
        ) : null}
      </dl>
    </div>
  );
}

function Notes({ page }: { page: ClientPageBody }): JSX.Element {
  if (page.notes.length === 0) return <p>{words("C51")}</p>;
  return (
    <ul class="client-notes">
      {page.notes.map((note, index) => (
        <li key={index}>
          <h3>{words(KINDS[note.kind])}</h3>
          <p>
            <Note note={note.note} />
          </p>
        </li>
      ))}
    </ul>
  );
}

function Estimate({ page }: { page: ClientPageBody }): JSX.Element {
  const estimate = page.estimate;
  if (!estimate) return <p>{words("C41")}</p>;
  return (
    <>
      <span class="mint-label">{words("C38")}</span>
      <span class="mint-figure">{estimate.total}</span>
      <dl class="facts client-lines">
        <dt>{words("C34")}</dt>
        <dd>{estimate.material}</dd>
        <dt>{words("C35")}</dt>
        <dd>{estimate.labour}</dd>
        <dt>{words("C36")}</dt>
        <dd>{estimate.subtotal}</dd>
        <dt>{words("C37")}</dt>
        <dd>{estimate.tax}</dd>
        {estimate.milestones.map((amount, index) => (
          <Fragment key={index}>
            <dt>{words("C39", { n: index + 1 })}</dt>
            <dd>{amount}</dd>
          </Fragment>
        ))}
      </dl>
    </>
  );
}

function AnswerSheet({ control, page, show }: { control: ReturnType<typeof useDialog>; page: ClientPageBody; show: (page: ClientPageBody) => void }): JSX.Element {
  const form = useForm({ seatHeight: "", typedName: "" }, control, words("C52"));
  const [target, setTarget] = useState<"seatHeight" | "typedName">("seatHeight");
  return (
    <Dialog control={control} title={words("C06")} kind="sheet" closeLabel={words("C12")}>
      <Problems form={form} firstField={target} heading={words("C26")} />
      <p>{words("C07")}</p>
      <Field form={form} name="seatHeight" label={words("C08")} autocomplete="off" />
      <AsyncButton
        label={words("C09")}
        busyLabel={words("C22")}
        primary
        onPress={async () => {
          setTarget("seatHeight");
          const sent = await form.submit(async () => {
            await post(`${address}/answer`, { seatHeight: form.values.seatHeight });
          });
          if (!sent) return;
          announce(words("C15"));
          show(await readPage());
        }}
      />
      <Field form={form} name="typedName" label={words("C10")} autocomplete="name" />
      <AsyncButton
        label={words("C11")}
        busyLabel={words("C22")}
        onPress={async () => {
          setTarget("typedName");
          const signed = await form.submit(async () => {
            await post(`${address}/sign-off`, { estimateId: page.estimateId, typedName: form.values.typedName });
          });
          if (!signed) return;
          const fresh = await readPage();
          show(fresh);
          control.done();
          announce(fresh.signOff?.message ?? "");
        }}
      />
    </Dialog>
  );
}

/** A control given focus is scrolled fully into view above the bottom bar (SR6). */
function keepFocusInView(): void {
  onFocusTaken((node) => {
    if (node.closest(".panel,.client-bar") || node.matches("h1")) return;
    const bar = document.querySelector(".client-bar")?.getBoundingClientRect().top ?? innerHeight;
    const box = node.getBoundingClientRect();
    if (box.top < 8) scrollBy({ top: box.top - 8, behavior: "instant" });
    else if (box.bottom > bar - 8) scrollBy({ top: box.bottom - bar + 8, behavior: "instant" });
  });
}

function ClientPage(): JSX.Element {
  const live = useLive(readPage, []);
  const page = live.data ?? boot.page;
  const [failed, setFailed] = useState(false);
  const sheet = useDialog(words("C06"));

  useEffect(() => {
    keepFocusInView();
    return onRefreshState(setFailed);
  }, []);

  return (
    <>
      <main id="main" class="page client-page">
        <h1 tabIndex={-1}>{words("C01")}</h1>
        <p class="client-title">{page.pieceTitle}</p>
        <div role="status" aria-label={words("C25")} class="client-refresh">
          {failed ? words("C21") : ""}
        </div>
        <nav class="client-steps" aria-label={words("C02")} data-print="no">
          <a class="link-row" href="#before-and-after">{words("C03")}</a>
          <a class="link-row" href="#the-cover">{words("C04")}</a>
          <a class="link-row" href="#the-estimate">{words("C05")}</a>
          <a class="link-row" href="#your-answer">{words("C06")}</a>
        </nav>
        <div class="bento client-tiles">
          <section class="tile t-wide" aria-labelledby="before-and-after">
            <h2 id="before-and-after" tabIndex={-1}>{words("C03")}</h2>
            <Pictures />
          </section>
          <section class="tile t-wide" aria-labelledby="the-cover">
            <h2 id="the-cover" tabIndex={-1}>{words("C04")}</h2>
            <Cover page={page} />
          </section>
          <section class="tile t-wide" aria-labelledby="condition-notes">
            <h2 id="condition-notes" tabIndex={-1}>{words("C42")}</h2>
            <Notes page={page} />
          </section>
          <section class="tile tile--mint t-wide" aria-labelledby="the-estimate">
            <h2 id="the-estimate" tabIndex={-1}>{words("C05")}</h2>
            <Estimate page={page} />
            <h3 id="your-answer" class="client-answer" tabIndex={-1}>{words("C06")}</h3>
            <p>{words("C19", { date: clientDate(page.dueDate, language) })}</p>
            {page.answer ? <p>{words("C08")}: {page.answer.typed}</p> : null}
            {page.signOff ? <p>{page.signOff.message}</p> : null}
          </section>
        </div>
      </main>
      <div class="main-action client-bar" role="toolbar" aria-label={words("C48")}>
        <button type="button" class="button button--primary" onClick={(event) => sheet.show(event.currentTarget)}>
          {words("C06")}
        </button>
      </div>
      <AnswerSheet control={sheet} page={page} show={live.set} />
    </>
  );
}

const root = document.getElementById("app") as HTMLElement;
root.replaceChildren();
startRefresh();
render(<ClientPage />, root);
