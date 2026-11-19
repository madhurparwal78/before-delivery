import { announce, toast } from "./feedback";
import type { OperationView } from "../../shared/types";

/** A bulk operation is announced and shown as a toast with an Undo button and the server's deadline. */
export function reportOperation(operation: OperationView, text: string): void {
  announce(`${text} · Undo`);
  toast(text, { operationId: operation.id, deadline: operation.deadline });
}
