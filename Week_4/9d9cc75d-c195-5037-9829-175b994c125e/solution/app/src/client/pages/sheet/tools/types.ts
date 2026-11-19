// Props of the sheet page's tool dialogs, fixed by the lead so the sheet page (SH1) and the tools (SH2) can be written in
// parallel. SH2 implements and exports each from `tools/index.ts`; SH1 renders one only while it is open (`{open && <X />}`),
// announces `Saved {name}.` itself in each `onSaved`/`onSave`, and refreshes its own state. Every dialog is built on
// `client/ui/dialog.tsx` (focus on its first control, Tab wraps, Escape and any close or save returns focus to the opener).
import type { Cell, CalculationDef, MeasurePill, ParameterDef, ReferenceLine, SetDef } from '../../../../shared/model.ts';

export interface CalculationDialogProps {
  sheetId: string;
  /** null for a new calculation */
  calculation: CalculationDef | null;
  /** names a formula may use: fields (dimensions and measures, hidden ones left out), the sheet's other calculations, `[@name]` parameters and set names */
  fieldNames: string[];
  parameters: ParameterDef[];
  setNames: string[];
  onSaved: (saved: CalculationDef) => void;
  onClose: () => void;
}

export interface SetDialogProps {
  workbookId: string;
  /** null for a new set */
  existing: SetDef | null;
  /** dimension field names offered by `combobox "Field"` */
  dimensions: string[];
  /** measure pills of the view offered by `combobox "By"` */
  measures: MeasurePill[];
  /** the number parameters offered by `combobox "Use parameter"` */
  numberParameters: ParameterDef[];
  /** the field's members from `POST /api/sheets/<id>/members`, supplied by the page (it knows the filters and parameters) */
  loadMembers: (field: string) => Promise<Cell[]>;
  onSaved: (saved: SetDef) => void;
  onClose: () => void;
}

export interface ReferenceLineDialogProps {
  numberParameters: ParameterDef[];
  onSave: (line: ReferenceLine) => void;
  onClose: () => void;
}

export interface AlertDialogProps {
  sheetId: string;
  /** the measures a subscriber may watch: the measure pills of the view */
  measures: MeasurePill[];
  /** the alert's name, returned for the announcement */
  onSaved: (name: string) => void;
  onClose: () => void;
}
