// A button that runs one write: disabled with aria-busy while it runs, the label kept. A refusal is announced (useAction) and
// handed to `onFailure` so the page can show it in the status strip; `onDone` runs after a success.
import type { ComponentChildren } from "preact";
import { Button, type ButtonVariant } from "../../ui/index.ts";
import { type ApiError, asApiError, useAction } from "../../api.ts";

export function ActionButton({
  run,
  variant = "secondary",
  onFailure,
  onDone,
  children,
}: {
  run: () => Promise<unknown>;
  variant?: ButtonVariant;
  onFailure?: (error: ApiError | null) => void;
  onDone?: () => void;
  children: ComponentChildren;
}) {
  const action = useAction(async () => {
    try {
      await run();
    } catch (cause) {
      onFailure?.(asApiError(cause));
      throw cause;
    }
    return true;
  });
  return (
    <Button
      variant={variant}
      pending={action.pending}
      onClick={() => {
        onFailure?.(null);
        void action.run().then((done) => {
          if (done) onDone?.();
        });
      }}
    >
      {children}
    </Button>
  );
}
