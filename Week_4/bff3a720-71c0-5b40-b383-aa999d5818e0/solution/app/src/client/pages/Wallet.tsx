import { useCallback, useEffect, useState, type ReactElement } from "react";
import type { Wallet } from "../../shared/api";
import { euros, signedEuros } from "../../shared/money";
import { announce } from "../lib/announce";
import { api, errorMessage } from "../lib/http";
import { useLive } from "../lib/live";
import { useRequireMember } from "../lib/useRequireSignIn";
import { Alert, EmptyState, PageHeading, Skeleton, StatusLine } from "../ui/Bits";
import { Plate } from "../ui/Plate";
import { Dialog } from "../ui/Dialog";
import { Stepper } from "../ui/Stepper";

export function WalletPage(): ReactElement | null {
  const member = useRequireMember();
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(5);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [added, setAdded] = useState("");

  const load = useCallback(async () => {
    setWallet(await api<Wallet>("GET", "/api/wallet"));
  }, []);

  useEffect(() => {
    if (member) void load();
  }, [member, load]);

  useLive({
    onEvent: (event) => {
      if (event.type === "hello" || event.type === "wallet" || event.type === "clock") void load();
    },
  });

  if (!member) return null;

  const add = async (): Promise<void> => {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      await api("POST", "/api/wallet/top-ups", { body: { amount_cents: amount * 100 } });
      setOpen(false);
      announce(`${euros(amount * 100)} added to your wallet.`);
      setAdded(`${euros(amount * 100)} added to your wallet.`);
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="wallet-page">
      <PageHeading>Wallet</PageHeading>
      <p className="balance">{wallet ? `Balance ${euros(wallet.balance_cents)}` : "Balance"}</p>
      <div className="actions">
        <button
          type="button"
          onClick={() => {
            setAmount(5);
            setError("");
            setOpen(true);
          }}
        >
          Add money
        </button>
      </div>
      <StatusLine text={added} />
      {wallet === null ? <Skeleton rows={4} /> : null}
      {wallet && wallet.lines.length === 0 ? <EmptyState sentence="No wallet movements yet." seed="wallet-empty" /> : null}
      {wallet && wallet.lines.length > 0 ? (
        <div className="listing listing-wide">
          <Plate seed="wallet-month" ratio={2.4} caption="Brisanne to Tollemarch, the month in one long road" />
          <ul className="wallet-lines" aria-label="Wallet">
            {wallet.lines.map((line) => (
              <li key={line.id} data-id={line.id}>
                <span className="line-label">{line.label}</span> <span className="line-amount">{signedEuros(line.amount_cents)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <Dialog open={open} title="Add money" onClose={() => setOpen(false)}>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void add();
          }}
        >
          <Stepper
            label="Amount in euros"
            value={amount}
            min={5}
            max={200}
            step={5}
            pageStep={25}
            format={String}
            onChange={setAmount}
            topNote="This is the most."
            bottomNote="This is the fewest."
            decreaseLabel="Less money"
            increaseLabel="More money"
          />
          <div className="actions">
            <button type="submit">{pending ? "Working" : "Add to wallet"}</button>
          </div>
          <Alert>{error}</Alert>
        </form>
      </Dialog>
    </div>
  );
}
