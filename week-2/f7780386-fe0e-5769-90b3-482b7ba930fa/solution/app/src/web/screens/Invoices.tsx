// Invoices (member): the member's Kill Bill invoices with their line items, and the billing business name.

import { useState } from "preact/hooks";
import type { Invoice } from "../../shared/api.js";
import type { Session } from "../App.js";
import { ApiFailure, call, get } from "../api.js";
import { announce, complain, perform } from "../feedback.js";
import { Cell, EmptyRow, ScreenHead, useData } from "./shared.js";

export function InvoicesScreen({ session }: { session: Session }) {
  const invoices = useData(async () => {
    announce("Loading invoices…");
    try {
      const result = await get<{ invoices: Invoice[] }>("/api/invoices");
      announce("");
      return result;
    } catch (error) {
      if (error instanceof ApiFailure && error.body.error === "billing_unavailable") complain("Invoices are unavailable while billing is unreachable.");
      throw error;
    }
  }, []);
  const [name, setName] = useState(session.user.business_name ?? "");
  const [busy, setBusy] = useState(false);

  const save = async (event: Event) => {
    event.preventDefault();
    setBusy(true);
    await perform(
      "Saving…",
      () => call<{ member: { business_name: string } }>("PATCH", "/api/members/me", { business_name: name }),
      () => "Business name saved.",
      (failure) => (failure.body.errors?.business_name === "length" ? { text: "Business names are 1 to 80 characters." } : null),
    );
    setBusy(false);
  };

  const rows = invoices.data?.invoices ?? [];
  return (
    <section class="screen">
      <ScreenHead title="Invoices">
        <p class="screen-head__note">Charges, payments and credits recorded on your kitchen billing account.</p>
      </ScreenHead>
      <table class="table">
        <caption>Invoices</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Items</th>
            <th scope="col" class="num">
              Amount
            </th>
            <th scope="col" class="num">
              Balance
            </th>
          </tr>
        </thead>
        <tbody>
          {!invoices.data && !invoices.failed && <EmptyRow columns={4}>Loading…</EmptyRow>}
          {invoices.failed !== null && <EmptyRow columns={4}>Invoices are unavailable while billing is unreachable.</EmptyRow>}
          {invoices.data && rows.length === 0 && <EmptyRow columns={4}>No invoices yet.</EmptyRow>}
          {rows.map((invoice) => (
            <tr key={invoice.id}>
              <Cell label="Date">
                {invoice.date}
              </Cell>
              <Cell label="Items">
                <ul class="items">
                  {invoice.items.map((item, index) => (
                    <li key={index}>
                      <span>{item.description}</span>
                      <span class="num">${item.amount}</span>
                    </li>
                  ))}
                </ul>
              </Cell>
              <Cell label="Amount" numeric>
                ${invoice.amount}
              </Cell>
              <Cell label="Balance" numeric>
                ${invoice.balance}
              </Cell>
            </tr>
          ))}
        </tbody>
      </table>
      <form class="panel form-inline" aria-label="Business name" onSubmit={save} noValidate>
        <label class="field">
          <span class="field__label">Business name on invoices</span>
          <input type="text" maxLength={120} value={name} onInput={(e) => setName(e.currentTarget.value)} />
        </label>
        <button type="submit" class="button" disabled={busy} aria-busy={busy ? "true" : "false"}>
          Save business name
        </button>
      </form>
    </section>
  );
}
