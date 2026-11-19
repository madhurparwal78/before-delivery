import type { Language, MeasureId, StageId } from "./catalog";

export interface Assessor {
  id: string;
  name: string;
  email: string;
}

export interface Label {
  id: string;
  name: string;
  contactName: string | null;
  contactEmail: string | null;
  state: "open" | "closed" | "erased";
  closedAt: string | null;
  eraseAt: string | null;
}

export interface Supplier {
  id: string;
  name: string;
  town: string;
  townName: string;
  language: Language;
  contactName: string | null;
  contactEmail: string | null;
}

export type LabelWithSuppliers = Label & { suppliers: Supplier[] };

export interface StyleRow {
  id: string;
  labelId: string;
  labelName: string;
  styleCode: string | null;
  name: string;
  season: string;
  gtin: string;
  garment: string;
  state: "draft" | "worked" | "published" | "archived";
  suppliers: string[];
  climateShown: string | null;
}

export interface StageFigure {
  stage: StageId;
  value: string;
  shown: string;
  share: string;
}

export interface Measure {
  measure: MeasureId;
  unit: string;
  total: string;
  totalShown: string;
  hotspot: StageId;
  stages: StageFigure[];
}

export interface Result {
  id: string;
  styleId: string;
  edition: string;
  workedOutAt: string;
  dataQualityPercent: number;
  dataQualityGrade: string;
  measures: Measure[];
  current: boolean;
}

export interface Score {
  state: "none" | "current" | "outdated" | "busy";
  score: number | null;
  per100g: number | null;
  runId: string | null;
  shown: string | null;
  worstCaseFacts: string[];
  busyUntil: string | null;
}

export interface Leg {
  id: string;
  mode: string;
  km: string;
}

export type Style = StyleRow & {
  washes: number;
  repairService: boolean | null;
  rangeSize: number | null;
  notes: string | null;
  legs: Leg[];
  version: number;
  changedAt: string;
  changedBy: string | null;
  latestResult: Result | null;
  newerFactors: string | null;
  score: Score;
};

export interface Tier {
  factory: string;
  town: string;
  country: string | null;
}

export interface Fibre {
  name: string;
  sharePercent: string;
}

export interface Line {
  id: string;
  position: number;
  materialId: string;
  materialName: string;
  fabricWeightGsm: string | null;
  areaM2: string | null;
  massGrams: string;
  massShown: string;
  fibres: Fibre[];
  tier1: Tier | null;
  tier2: Tier | null;
  tier3: Tier | null;
  answeredFacts: { energyMjPerKg: string | null; waterLitresPerKg: string | null; fibreOrigin: string | null };
}

export interface Answer {
  energyValue: string | null;
  energyUnit: string | null;
  energyMjPerKg: string | null;
  waterLitresPerKg: string | null;
  fibreOrigin: string | null;
  evidenceIds: string[];
  answeredAt: string;
  state: "answered";
}

export interface SupplierRequest {
  id: string;
  styleId: string;
  lineId: string | null;
  styleName: string;
  supplierName: string;
  contactName: string;
  contactEmail: string;
  town: string;
  townName: string;
  language: Language;
  questions: string[];
  dueDate: string;
  state: "sent" | "reminded" | "answered" | "ended";
  sentAt: string;
  endsAt: string;
  remindedAt: string | null;
  answeredAt: string | null;
  answer: Answer | null;
  answerAddress: string;
}

export interface AnswerPage {
  language: Language;
  supplierName: string;
  labelName: string;
  styleName: string;
  town: string;
  townName: string;
  questions: string[];
  dueDate: string;
  endsAt: string;
  state: "sent" | "reminded" | "answered";
  answeredAt: string | null;
}

export interface Reading {
  id: string;
  meter: number;
  value: string;
  unit: string;
  takenAt: string;
}

export interface Visit {
  id: string;
  labelId: string;
  factoryName: string;
  town: string;
  townName: string;
  localDate: string;
  localTime: string;
  at: string;
  lisbonDate: string;
  lisbonDayHours: number;
  shown: string;
  readings?: Reading[];
}

export interface FactorRow {
  id: string;
  kind: string;
  value: string;
  unit: string;
}

export interface ScenarioChanges {
  recycled: { lineId: string; percent: number }[];
  materialSwaps: { lineId: string; materialId: string }[];
  factorySwaps: { lineId: string; country: string }[];
  legModes: { legIndex: number; mode: string }[];
}

export interface ScenarioPreview {
  measures: Measure[];
  differences: { measure: MeasureId; shown: string }[];
}

export type Scenario = ScenarioChanges &
  ScenarioPreview & {
    id: string;
    name: string;
    resultId: string;
    savedAt: string;
  };

export interface PassportRow {
  styleId: string;
  styleName: string;
  gtin: string;
  edition: number;
  state: "published" | "withdrawn";
  publishedAt: string;
  address: string;
}

export interface PublicPassport {
  gtin: string;
  edition: number;
  lang: Language;
  styleName: string;
  labelName: string;
  garment: string;
  publishedAt: string;
  correctedOn: string | null;
  factorEdition: string;
  dataQualityPercent: number;
  dataQualityGrade: string;
  scoreShown: string;
  measures: { measure: MeasureId; totalShown: string }[];
}

export interface Dossier {
  id: string;
  styleId: string;
  resultId: string;
  edition: string;
  state: "making" | "ready" | "signedOff" | "replaced";
  madeAt: string;
  signedOffBy: string | null;
  signedOffAt: string | null;
}

export interface SignOffPage {
  dossier: {
    id: string;
    state: Dossier["state"];
    styleName: string;
    edition: string;
    dataQualityPercent: number;
    dataQualityGrade: string;
    measures: Measure[];
    madeAt: string;
    signedOffBy: string | null;
    signedOffAt: string | null;
  };
  endsAt: string;
}

export interface CatalogueRow {
  row: number;
  styleCode: string;
  name: string;
  outcome: "new" | "matched" | "refused";
  reason: string | null;
}

export interface CataloguePreview {
  rows: CatalogueRow[];
  newCount: number;
  matchedCount: number;
  refusedCount: number;
}

export interface EstimateAnswer {
  garment: string;
  fibre: string;
  country: string;
  climate: string;
  shown: string;
  answeredAt: string;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
    lastValue?: string;
    lastAt?: string;
    busyUntil?: string;
  };
}

/** What the server tells the page before any script runs. */
export type VisitWithReadings = Visit & { readings: Reading[] };

export interface Boot {
  status: number;
  heading: string;
  visit?: VisitWithReadings;
  answer?: { token: string; page: AnswerPage };
  answerEnded?: Language;
  signOff?: { token: string; page: SignOffPage };
  signOffEnded?: boolean;
  passport?: PublicPassport;
  passportEnded?: Language;
  passportPath?: string;
}
