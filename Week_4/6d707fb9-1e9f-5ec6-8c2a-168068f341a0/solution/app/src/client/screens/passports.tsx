import type { JSX } from "preact";
import { useState } from "preact/hooks";
import type { Language } from "../../shared/catalog";
import type { PassportRow, PublicPassport } from "../../shared/api";
import { PASSPORT_COPY } from "../../shared/copy";
import { shownDate } from "../../shared/time";
import { announce, focusHeading, post, useResource, useTitle } from "../lib";
import { Button, Hidden, Modal, TableFrame, useDialog } from "../ui";
import { RefreshLine } from "../frame";
import { ConfirmForm } from "./labels";
import { Heading } from "./public";

export function Passports(): JSX.Element {
  useTitle("Passports");
  const passports = useResource<{ passports: PassportRow[] }>("/api/passports");
  const dialog = useDialog();
  const [target, setTarget] = useState<PassportRow | null>(null);
  const rows = passports.data?.passports ?? [];
  const newest = new Map<string, number>();
  for (const row of rows) newest.set(row.gtin, Math.max(newest.get(row.gtin) ?? 0, row.edition));
  return (
    <main class="desk-main">
      <Heading>Passports</Heading>
      <RefreshLine />
      <TableFrame name="Passports table">
        <table>
          <thead>
            <tr>
              <th scope="col">Style</th>
              <th scope="col">GTIN</th>
              <th scope="col" class="figure">
                Edition
              </th>
              <th scope="col">State</th>
              <th scope="col">Published</th>
              <th scope="col">Passport</th>
              <th scope="col">Controls</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.gtin}-${row.edition}`}>
                <td>{row.styleName}</td>
                <td class="figure">{row.gtin}</td>
                <td class="figure">{row.edition}</td>
                <td>{row.state === "published" ? "Published" : "Withdrawn"}</td>
                <td>{shownDate(row.publishedAt)}</td>
                <td>
                  <a class="cell-link" href={`/p/${row.gtin}/e/${row.edition}`}>
                    {row.styleName} edition {row.edition}
                  </a>
                </td>
                <td>
                  {row.state === "published" && newest.get(row.gtin) === row.edition ? (
                    <Button
                      class="button-small"
                      onPress={(event) => {
                        setTarget(row);
                        dialog.show(event);
                      }}
                    >
                      Withdraw<Hidden> {row.styleName}</Hidden>
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableFrame>
      {passports.data && !rows.length ? (
        <div class="empty-state">
          <div class="fragment fragment-empty" aria-hidden="true">
            <span class="fake-button">Publish passport</span>
          </div>
          <p>No passports yet. Publish one from a style.</p>
        </div>
      ) : null}
      <Modal name="Withdraw passport" control={dialog}>
        {target ? (
          <ConfirmForm
            title="Withdraw passport"
            text={`Withdraw every edition of the passport for ${target.styleName}? Its addresses will say it has been withdrawn.`}
            yes="Withdraw"
            no="Keep"
            control={dialog}
            action={async () => {
              await post(`/api/styles/${target.styleId}/passport/withdraw`);
              await passports.reload();
              dialog.opener.current = null;
              dialog.hide();
              focusHeading();
              announce(`Passport for ${target.styleName} withdrawn.`);
            }}
          />
        ) : null}
      </Modal>
    </main>
  );
}

const LANGUAGE_LINKS: { language: Language; name: string }[] = [
  { language: "en", name: "English" },
  { language: "fr", name: "Français" },
  { language: "tr", name: "Türkçe" },
  { language: "ar", name: "العربية" },
];

function LanguageLinks({ path, current }: { path: string; current: Language }): JSX.Element {
  return (
    <nav class="language-links" aria-label="Language">
      <ul>
        {LANGUAGE_LINKS.map(({ language, name }) => (
          <li key={language}>
            <a class="cell-link" href={`${path}?lang=${language}`} lang={language} aria-current={language === current ? "true" : undefined}>
              {name}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function PassportPage({ passport, path }: { passport: PublicPassport; path: string }): JSX.Element {
  const copy = PASSPORT_COPY[passport.lang];
  return (
    <main class="one-column passport">
      <p class="brand-line">Fio Contado Desk</p>
      <Heading>{passport.styleName}</Heading>
      <LanguageLinks path={path} current={passport.lang} />
      <dl class="facts">
        <div>
          <dt>{copy.label}</dt>
          <dd>{passport.labelName}</dd>
        </div>
        <div>
          <dt>{copy.garment}</dt>
          <dd>{copy.garments[passport.garment]}</dd>
        </div>
      </dl>
      <h2>{copy.footprint}</h2>
      <dl class="facts measures-facts">
        {passport.measures.map((entry) => (
          <div key={entry.measure}>
            <dt>{copy.measures[entry.measure]}</dt>
            <dd class="figure" dir="ltr">
              {entry.totalShown}
            </dd>
          </div>
        ))}
      </dl>
      <p>{passport.scoreShown}</p>
      <p>{copy.factorEdition(passport.factorEdition)}</p>
      <p>{copy.dataQuality(passport.dataQualityGrade, passport.dataQualityPercent)}</p>
      <p>
        {copy.edition(passport.edition)}
        {passport.correctedOn ? ` · ${copy.corrected(passport.correctedOn)}` : ""}
      </p>
      <p class="claim">{copy.claim}</p>
    </main>
  );
}

export function PassportEnded({ language, path }: { language: Language; path: string }): JSX.Element {
  return (
    <main class="one-column passport">
      <p class="brand-line">Fio Contado Desk</p>
      <Heading>{PASSPORT_COPY[language].withdrawn}</Heading>
      <LanguageLinks path={path} current={language} />
    </main>
  );
}
