import type { Part, Step, Working } from '../../shared/types';

export const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The editor's working copy and the revisions it is based on; fields are addressed by their field path. */
export class EditorState {
  selectedStep: string | null = null;
  selectedPart: string | null = null;
  readonly lastBy = new Map<string, string>();

  constructor(public work: Working) {
    this.selectedStep = work.steps[0]?.id ?? null;
  }

  step(id: string): Step | undefined {
    return this.work.steps.find((s) => s.id === id);
  }

  part(id: string): Part | undefined {
    return this.work.parts.find((p) => p.id === id);
  }

  selected(): Step | undefined {
    return this.selectedStep ? this.step(this.selectedStep) : undefined;
  }

  stepNumber(id: string): number {
    return this.work.steps.findIndex((s) => s.id === id) + 1;
  }

  revision(path: string): number {
    return this.work.field_revisions[path] ?? 0;
  }

  /** The committed value of a field path. */
  read(path: string): unknown {
    const [kind, id, name] = path.split('/');
    if (kind === 'step') return (this.step(id!) as unknown as Record<string, unknown> | undefined)?.[name!];
    if (kind === 'part') return (this.part(id!) as unknown as Record<string, unknown> | undefined)?.[name!];
    if (kind === 'model_scale') return this.work.model?.scale;
    if (kind === 'model_scale_confirmed') return this.work.model?.scale_confirmed;
    return (this.work as unknown as Record<string, unknown>)[kind!];
  }

  write(path: string, value: unknown, revision: number): void {
    const [kind, id, name] = path.split('/');
    this.work.field_revisions[path] = revision;
    if (kind === 'step' || kind === 'part') {
      const target = (kind === 'step' ? this.step(id!) : this.part(id!)) as unknown as Record<string, unknown> | undefined;
      if (!target) return;
      target[name!] = value;
      if (kind === 'part' && name === 'node_path') target.unbound = false;
    } else if (kind === 'model_scale' && this.work.model) this.work.model.scale = value as number;
    else if (kind === 'model_scale_confirmed' && this.work.model) this.work.model.scale_confirmed = value as boolean;
    else (this.work as unknown as Record<string, unknown>)[kind!] = value;
  }
}
