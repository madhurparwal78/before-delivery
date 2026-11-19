import type { DisplayUnits } from './protocol.js';
export declare const MM_PER_INCH = 25.4;
/** Inches rounded to the nearest eighth, printed as a reduced mixed fraction. */
export declare function formatInches(mm: number): string;
export declare function formatMillimetres(mm: number): string;
export declare function formatLength(mm: number, units: DisplayUnits): string;
/** Tenths of a percent printed with exactly one decimal. */
export declare function formatGradeTenths(tenths: number): string;
/** The editable value for a length spinbutton in the workspace's display units. */
export declare function lengthToInput(mm: number, units: DisplayUnits): string;
/** The stored integer millimetres for a length spinbutton value. */
export declare function lengthFromInput(value: number, units: DisplayUnits): number;
/** The editable value for the elevation step, stored in hundredths of a millimetre. */
export declare function elevationStepToInput(hundredths: number, units: DisplayUnits): string;
export declare function elevationStepFromInput(value: number, units: DisplayUnits): number;
export declare function fastClockLabel(seconds: number): string;
