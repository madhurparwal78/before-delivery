import type { WorkspaceDocument, Page, DocumentNode, Role, Breakpoint, StyleValue, Token } from '../shared/domain.js';

export interface UserRow { id: string; name: string; email: string }
export interface MemberRow { workspace_id: string; user_id: string; role: Role }

export type OperationKind =
  | 'insert_node' | 'insert_instance' | 'move_node' | 'delete_node' | 'duplicate_node' | 'rename_node'
  | 'set_prop' | 'set_style' | 'clear_style'
  | 'set_token' | 'rename_token' | 'delete_token'
  | 'create_component' | 'detach_instance' | 'delete_component'
  | 'set_fields' | 'put_entry' | 'move_entry' | 'delete_entry' | 'bind_prop'
  | 'add_page' | 'rename_page'
  | 'undo' | 'redo' | 'restore';

export interface Operation {
  opId: string;
  baseSeq: number;
  kind: OperationKind;
  [key: string]: unknown;
}

export interface StoredOperation {
  seq: number;
  opId: string | null;
  kind: OperationKind;
  author: { id: string; name: string };
  at: string;
  op: Operation;
}

export interface ConflictInfo {
  opId: string;
  property: string;
  value: string;
  winner: { id: string; name: string };
}
