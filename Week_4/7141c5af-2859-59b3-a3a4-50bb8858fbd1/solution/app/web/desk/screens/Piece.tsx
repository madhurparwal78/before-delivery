import type { JSX } from "preact";
import { useState } from "preact/hooks";
import { copy } from "../../../server/domain/copy.ts";
import { dateCopy, datetimeCopy } from "../../../server/domain/time.ts";
import { chairSeed, chairSvg } from "../../shared/dots.ts";
import { Accordion } from "../lib/accordion.tsx";
import { announce } from "../lib/announce.ts";
import { ApiFailure, api, get, post } from "../lib/api.ts";
import { useLive } from "../lib/live.ts";
import { AsyncButton } from "../lib/forms.tsx";
import { PIECE_STATES, type Piece, stateName } from "../lib/names.ts";
import { Heading, Loading, MainAction, MintTile, useSession } from "../lib/screen.tsx";
import type { ScreenProps } from "../routes.tsx";

const DAY_MS = 86_400_000;

const SUB_SCREENS = [
  ["condition", "Condition"],
  ["photographs", "Photographs"],
  ["hide", "Hide"],
  ["estimate", "Estimate"],
  ["collection", "Collection"],
  ["dossier", "Dossier"],
] as const;

interface Hold {
  id: string;
  code: string;
  lot: string;
  quantity: string | number;
  label: string;
}

interface ClientPage {
  address: string | null;
  endsAt: string | null;
  sentAt: string | null;
  state: "live" | "ended";
  answer: { seatHeightCm: string; typed: string; answeredAt: string } | null;
  signOff: { typedName: string; at: string } | null;
}

const when = (at: string): string => datetimeCopy(new Date(at));

function dueFigure(due: string | null, today: string): string {
  if (!due) return "No due date";
  const days = Math.round((Date.parse(due) - Date.parse(today)) / DAY_MS);
  return days === 1 || days === -1 ? `${days} day` : `${days} days`;
}

function sizeCopy(piece: Piece): string {
  const sides = [piece.widthCm, piece.depthCm, piece.heightCm];
  const size = sides.every((side) => side !== null) ? `${sides.join(" x ")} cm` : "";
  const weight = piece.weightKg !== null ? `${piece.weightKg} kg` : "";
  return [size, weight].filter(Boolean).join(", ");
}

export function PieceScreen({ id }: ScreenProps): JSX.Element {
  const { today } = useSession();
  const live = useLive(async () => {
    const [{ piece }, { holds }, { clientPage }] = await Promise.all([
      get<{ piece: Piece }>(`/api/pieces/${id}`),
      get<{ holds: Hold[] }>(`/api/pieces/${id}/holds`),
      get<{ clientPage: ClientPage }>(`/api/pieces/${id}/client-page`),
    ]);
    return { piece, holds, clientPage };
  }, [id]);
  const [notice, setNotice] = useState<string | null>(null);
  const data = live.data;
  if (!data) return <Loading height={420} />;
  const { piece, holds, clientPage } = data;

  const refused = (error: unknown): void => {
    if (!(error instanceof ApiFailure)) throw error;
    setNotice(error.message);
    announce(error.message);
  };

  const setState = async (state: string): Promise<void> => {
    try {
      const saved = (await api<{ piece: Piece }>("PATCH", `/api/pieces/${id}`, { state })).piece;
      live.set({ ...data, piece: saved });
      setNotice(null);
      announce(state === "archived" ? copy("F-16", { title: piece.title }) : copy("F-105", { title: piece.title, state: stateName(state) }));
    } catch (error) {
      refused(error);
    }
  };

  const facts: [string, string][] = [
    ["Client", piece.clientName],
    ["Maker", piece.maker ?? ""],
    ["Year", piece.year ?? ""],
    ["Stamp number", piece.stampNumber ?? ""],
    ["Size", sizeCopy(piece)],
    ["Due", piece.dueDate ? dateCopy(piece.dueDate) : ""],
    ["Notes", piece.notes ?? ""],
  ];

  return (
    <>
      <Heading text={piece.title}>
        <MainAction>
          <AsyncButton
            label="Send client page"
            primary
            onPress={async () => {
              try {
                await post(`/api/pieces/${id}/client-page`);
                setNotice(null);
                await live.reload();
                const email = (await get<{ client: { email: string } }>(`/api/clients/${piece.clientId}`)).client.email;
                announce(copy("F-60", { email }));
              } catch (error) {
                refused(error);
              }
            }}
          />
        </MainAction>
      </Heading>
      <div class="bento">
        <section class="tile t-large piece-facts" aria-label="Facts">
          <span class="piece-drawing" dangerouslySetInnerHTML={{ __html: chairSvg(chairSeed(piece.title)) }} />
          <div class="stack">
            <dl class="facts">
              {facts
                .filter(([, value]) => value !== "")
                .map(([label, value]) => (
                  <div class="facts-row" key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
            </dl>
            <label class="field">
              <span class="field-label">State</span>
              <select class="input" value={piece.state} onChange={(event) => void setState(event.currentTarget.value)}>
                {PIECE_STATES.map((choice) => (
                  <option key={choice.value} value={choice.value}>
                    {choice.label}
                  </option>
                ))}
              </select>
            </label>
            {notice ? <p class="notice">{notice}</p> : null}
          </div>
        </section>
        <MintTile label="Days to due" figure={dueFigure(piece.dueDate, today)} size="t-medium" />
        <nav class="tile t-full sub-screens" aria-label="This piece">
          {SUB_SCREENS.map(([path, label]) => (
            <a key={path} class="sub-screen tile--link" href={`/pieces/${id}/${path}`}>
              {label}
            </a>
          ))}
        </nav>
        <section class="tile t-full accordions" aria-label="Records">
          <Accordion title="Holds">
            {holds.length === 0 ? (
              <p>No holds yet.</p>
            ) : (
              <ul class="plain-list">
                {holds.map((hold) => (
                  <li key={hold.id}>
                    <span>
                      {hold.code}, {hold.lot}
                    </span>
                    <span class="muted">{hold.label}</span>
                  </li>
                ))}
              </ul>
            )}
          </Accordion>
          <Accordion title="Client page">
            {clientPage.address && clientPage.state === "live" ? (
              <div class="stack">
                <a class="link-row" href={clientPage.address}>
                  {clientPage.address}
                </a>
                {clientPage.sentAt ? <p class="muted">Sent {when(clientPage.sentAt)}</p> : null}
                {clientPage.endsAt ? <p class="muted">Ends {when(clientPage.endsAt)}</p> : null}
                <div class="actions">
                  <AsyncButton
                    label="End this page"
                    onPress={async (button) => {
                      try {
                        await api("DELETE", `/api/pieces/${id}/client-page`);
                        announce(copy("F-61"));
                        await live.reload();
                        if (!button.isConnected) document.querySelector<HTMLElement>("main h1")?.focus();
                      } catch (error) {
                        refused(error);
                      }
                    }}
                  />
                </div>
              </div>
            ) : (
              <p>{clientPage.sentAt ? "This page has ended." : "No client page yet."}</p>
            )}
          </Accordion>
          <Accordion title="Answers">
            {clientPage.answer || clientPage.signOff ? (
              <dl class="facts">
                {clientPage.answer ? (
                  <div class="facts-row">
                    <dt>Seat height</dt>
                    <dd>
                      {clientPage.answer.seatHeightCm} cm, answered {when(clientPage.answer.answeredAt)}
                    </dd>
                  </div>
                ) : null}
                {clientPage.signOff ? (
                  <div class="facts-row">
                    <dt>Signed off</dt>
                    <dd>
                      {clientPage.signOff.typedName}, {when(clientPage.signOff.at)}
                    </dd>
                  </div>
                ) : null}
              </dl>
            ) : (
              <p>No answers yet.</p>
            )}
          </Accordion>
        </section>
      </div>
    </>
  );
}
