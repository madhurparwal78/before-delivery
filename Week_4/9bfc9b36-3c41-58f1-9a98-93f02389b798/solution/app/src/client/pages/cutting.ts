/** Confirm cut: one key per hold for the life of the tab, so a retry after a refresh posts nothing twice. */
import { useCallback, useRef, useState } from "react";
import { ApiError, sendJson } from "../api.js";
import { useLive } from "../live.js";
import { useRouter } from "../router.js";
import { useAccount } from "../session.js";
import { PENDING, SUCCESS } from "../../shared/copy.js";
import { lengthText } from "../../shared/units.js";
import type { CutResult } from "../../shared/types.js";

function keyFor(claimId: string): string {
  const name = `boltrope-cut-key:${claimId}`;
  const stored = window.sessionStorage.getItem(name);
  if (stored) return stored;
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const fresh = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  window.sessionStorage.setItem(name, fresh);
  return fresh;
}

export function useConfirmCut(drawingCode: string, onCut: (result: CutResult) => void) {
  const { say, refuse } = useLive();
  const { navigate } = useRouter();
  const account = useAccount();
  const gate = useRef(false);
  const [busy, setBusy] = useState(false);
  const confirm = useCallback(
    async (claimId: string) => {
      if (gate.current) return;
      gate.current = true;
      setBusy(true);
      refuse(null);
      say(PENDING.cut);
      try {
        const { data } = await sendJson<CutResult>("POST", `/api/claims/${claimId}/cut`, undefined, { "idempotency-key": keyFor(claimId) });
        say(SUCCESS.cut(data.stock.kind, data.stock.code, lengthText(data.stock.remaining_mm), data.offcut?.code ?? null));
        if (data.drawing_status === "cut") {
          navigate(account.role === "loft-hand" ? "/floor" : `/drawings/${drawingCode}`, { state: { focus: true } });
        }
        onCut(data);
      } catch (failure) {
        if (!(failure instanceof ApiError)) throw failure;
        if (failure.code !== "unauthenticated") refuse(failure.body.message);
      } finally {
        gate.current = false;
        setBusy(false);
      }
    },
    [account.role, drawingCode, navigate, onCut, refuse, say],
  );
  return { busy, confirm };
}
