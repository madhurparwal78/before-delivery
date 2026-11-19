import type { JSX } from "preact";
import { useState } from "preact/hooks";
import { copy } from "../../../server/domain/copy.ts";
import { dateCopy } from "../../../server/domain/time.ts";
import { glyph } from "../../shared/dots.ts";
import { announce } from "../lib/announce.ts";
import { ApiFailure, get, post } from "../lib/api.ts";
import { Dialog, type DialogControl, useDialog } from "../lib/dialog.tsx";
import { AsyncButton, Field, Problems, useForm } from "../lib/forms.tsx";
import { useLive } from "../lib/live.ts";
import { BackToPiece, Empty, Heading, Loading, MainAction, MintTile, useSession } from "../lib/screen.tsx";
import type { ScreenProps } from "../routes.tsx";

interface Quote {
  quoteId: string;
  display: string;
}

interface CollectionRow {
  id: string;
  state: "booked" | "collected" | "delivered" | "waiting";
  localDate: string;
  localTime: string;
  display: string;
  labelSha256: string | null;
}

const STATE_NAMES: Record<CollectionRow["state"], string> = { booked: copy("F-75"), collected: "Collected", delivered: "Delivered", waiting: "Waiting" };

function BookDialog({ control, pieceId, quote, reload }: { control: DialogControl; pieceId: string; quote: Quote | null; reload: () => Promise<void> }): JSX.Element {
  const form = useForm({ localDate: "", localTime: "" }, control);
  return (
    <Dialog control={control} title="Book a collection">
      <Problems form={form} firstField="localDate" />
      <Field form={form} name="localDate" label="Date" />
      <Field form={form} name="localTime" label="Time" />
      <AsyncButton
        label="Book"
        primary
        onPress={async () => {
          const saved = await form.submit(() => post(`/api/pieces/${pieceId}/collections`, { quoteId: quote?.quoteId, ...form.values }).then(reload));
          if (!saved) return;
          form.replace({ localDate: "", localTime: "" });
          control.done();
          announce(copy("F-75"));
        }}
      />
    </Dialog>
  );
}

export function CollectionScreen({ id }: ScreenProps): JSX.Element {
  const session = useSession();
  const live = useLive(
    async () => {
      const [piece, list] = await Promise.all([get<{ piece: { title: string } }>(`/api/pieces/${id}`), get<{ collections: CollectionRow[] }>(`/api/pieces/${id}/collections`)]);
      return { title: piece.piece.title, collections: list.collections };
    },
    [id],
  );
  const [quote, setQuote] = useState<Quote | null>(null);
  const book = useDialog("Book a collection");
  const data = live.data;
  const next = data?.collections.filter((row) => row.state === "booked" && row.localDate >= session.today).sort((a, b) => a.localDate.localeCompare(b.localDate))[0];

  return (
    <>
      <BackToPiece id={id} />
      {data ? (
        <Heading text={`Collection of ${data.title}`}>
          <MainAction>
            <button
              type="button"
              class="button button--primary"
              aria-disabled={quote ? undefined : "true"}
              onClick={(event) => {
                if (quote) book.show(event.currentTarget);
              }}
            >
              Book a collection
            </button>
          </MainAction>
        </Heading>
      ) : null}
      {data ? (
        <div class="bento collection-grid">
          <section class="tile t-large collection-list" aria-label="Collections">
            <h2>Collections</h2>
            {data.collections.length === 0 ? <Empty text="No collections yet." /> : null}
            <ul class="stack">
              {data.collections.map((row) => (
                <li key={row.id} class="collection-row">
                  <strong class="state-mark">
                    {row.state === "waiting" ? null : <span dangerouslySetInnerHTML={{ __html: glyph("check", 16) }} />}
                    {STATE_NAMES[row.state]}
                  </strong>
                  <span>{row.display}</span>
                  {row.labelSha256 ? (
                    <a class="link-row" href={`/api/pieces/${id}/collections/${row.id}/label`} download>
                      Label for {row.id}
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
          <MintTile label="Next collection" figure={next ? dateCopy(next.localDate) : "None"} size="t-medium" />
          <section class="tile t-medium" aria-label="Quote">
            <h2>Quote</h2>
            {quote ? <p class="quote-figure">{quote.display}</p> : <Empty text="No quote yet." />}
            <AsyncButton
              label="Get a quote"
              onPress={async () => {
                try {
                  const answer = await post<{ quote: Quote }>(`/api/pieces/${id}/collections/quote`);
                  setQuote(answer.quote);
                  announce(copy("F-76", { amount: answer.quote.display }));
                } catch (error) {
                  if (error instanceof ApiFailure) announce(error.message);
                }
              }}
            />
          </section>
        </div>
      ) : (
        <Loading height={320} />
      )}
      <BookDialog control={book} pieceId={id} quote={quote} reload={live.reload} />
    </>
  );
}
