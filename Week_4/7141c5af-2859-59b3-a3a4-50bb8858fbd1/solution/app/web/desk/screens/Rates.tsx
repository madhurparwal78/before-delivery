import type { JSX } from "preact";
import { copy } from "../../../server/domain/copy.ts";
import { type Currency, minorOfPrice, printAmount } from "../../../server/domain/money.ts";
import { dateCopy } from "../../../server/domain/time.ts";
import { announce } from "../lib/announce.ts";
import { get, post } from "../lib/api.ts";
import { Dialog, useDialog } from "../lib/dialog.tsx";
import { AsyncButton, Field, Problems, useForm } from "../lib/forms.tsx";
import { useLive } from "../lib/live.ts";
import { Heading, Loading, MainAction, MintTile, useSession } from "../lib/screen.tsx";
import type { ScreenProps } from "../routes.tsx";

interface Rate {
  takesEffectOn: string;
  eur: string;
  gbp: string;
  usd: string;
  jpy: string;
  aed: string;
}

const BLANK = { takesEffectOn: "", eur: "", gbp: "", usd: "", jpy: "", aed: "" };
const CURRENCIES = [
  ["eur", "EUR"],
  ["gbp", "GBP"],
  ["usd", "USD"],
  ["jpy", "JPY"],
  ["aed", "AED"],
] as const;

const printed = (price: string, currency: Currency): string => printAmount(minorOfPrice(price, currency), currency);

function NewRate({ control, onSaved }: { control: ReturnType<typeof useDialog>; onSaved: () => Promise<void> }): JSX.Element {
  const form = useForm(BLANK, control);
  return (
    <Dialog control={control} title="New rate">
      <Problems form={form} firstField="takesEffectOn" />
      <Field form={form} name="takesEffectOn" label="Takes effect on" />
      <div class="field-pair">
        {CURRENCIES.map(([key, label]) => (
          <Field key={key} form={form} name={key} label={label} inputMode="decimal" />
        ))}
      </div>
      <AsyncButton
        label="Save rate"
        primary
        onPress={async () => {
          const saved = await form.submit(() => post("/api/rates", form.values));
          if (!saved) return;
          announce(copy("F-57", { date: dateCopy(form.values.takesEffectOn) }));
          form.replace(BLANK);
          control.done();
          await onSaved();
        }}
      />
    </Dialog>
  );
}

export function RatesScreen(_props: ScreenProps): JSX.Element {
  const { today } = useSession();
  const rates = useLive(() => get<{ rates: Rate[] }>("/api/rates"), []);
  const create = useDialog("New rate");
  const rows = rates.data?.rates;
  const current = rows?.filter((rate) => rate.takesEffectOn <= today).sort((a, b) => b.takesEffectOn.localeCompare(a.takesEffectOn))[0];
  return (
    <>
      <Heading text="Labour rates" ready={rows !== undefined}>
        <MainAction>
          <button type="button" class="button button--primary" onClick={(event) => create.show(event.currentTarget)}>
            New rate
          </button>
        </MainAction>
      </Heading>
      <div class="bento">
        {rows === undefined ? (
          <Loading size="t-large" height={260} />
        ) : (
          <section class="tile t-large">
            <div class="frame" role="region" aria-label="Rates table" tabIndex={0}>
              <table class="desk-table">
                <thead>
                  <tr>
                    <th scope="col">Takes effect on</th>
                    {CURRENCIES.map(([key, label]) => (
                      <th key={key} scope="col" class="cell-money">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((rate) => (
                    <tr key={rate.takesEffectOn}>
                      <th scope="row">{dateCopy(rate.takesEffectOn)}</th>
                      {CURRENCIES.map(([key, label]) => (
                        <td key={key} class="cell-money">{printed(rate[key], label)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
        <MintTile label="Today's rate an hour" figure={current ? printed(current.eur, "EUR") : "…"} size="t-medium" />
      </div>
      <NewRate control={create} onSaved={rates.reload} />
    </>
  );
}
