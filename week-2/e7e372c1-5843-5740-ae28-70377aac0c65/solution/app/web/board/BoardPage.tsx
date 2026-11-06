import { Figures } from "./Figures.tsx";
import { History } from "./History.tsx";
import { Masthead } from "./Masthead.tsx";
import { Rail } from "./Rail.tsx";
import { useBoardFeed } from "./useBoard.ts";
import { FOOTER, VAULT_NOTICE } from "../copy.ts";

export function BoardPage() {
  const { board, message } = useBoardFeed();
  return (
    <>
      <Masthead />
      <main className="page has-rail">
        <section className="notices" aria-label="Notices">
          {board?.vault === "unavailable" ? VAULT_NOTICE : ""}
        </section>
        <p className="board-updates" role="status" aria-label="Board updates">
          {message}
        </p>
        <Rail board={board} />
        <Figures figures={board?.figures ?? null} marketDate={board?.market_date ?? null} />
        <History rows={board?.history ?? null} />
        <footer className="footer">
          <p>{FOOTER}</p>
        </footer>
      </main>
    </>
  );
}
