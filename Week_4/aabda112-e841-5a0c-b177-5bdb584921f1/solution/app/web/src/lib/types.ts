import type { AppointmentReason, AppointmentStatus, InvoiceStatus, Species, StockReason, TreatmentStatus } from '../../../shared/domain';

export interface Appointment {
  id: string;
  patientId: string;
  patientName: string;
  species: Species;
  vetId: string;
  vetName: string;
  roomId: string;
  roomName: string;
  start: string;
  end: string;
  reason: AppointmentReason;
  status: AppointmentStatus;
  late: boolean;
}

export interface Room {
  id: string;
  name: string;
}

export interface QueueEntry {
  appointmentId: string;
  patientId: string;
  patientName: string;
  species: Species;
  vetName: string;
  checkedInAt: string;
  waitingMinutes: number;
  lateByMinutes: number | null;
}

export interface Dose {
  id: string;
  patientId: string;
  patientName: string;
  kennel: string;
  name: string;
  scheduledAt: string;
  status: TreatmentStatus;
  givenAt: string | null;
  givenBy: string | null;
  skipReason: string | null;
  notes: { id: string; text: string; author: string | null; createdAt: string }[];
}

export interface PatientSummary {
  id: string;
  name: string;
  species: Species;
  clientName: string;
  weightGrams: number | null;
  photoFileId: string | null;
  status: 'In ward' | 'Waiting' | 'In consult' | null;
}

export interface PatientFile {
  id: string;
  name: string;
  kind: 'xray' | 'wound' | 'lab' | 'consent' | 'profile';
  contentType: string;
  sizeBytes: number;
  sha256: string;
  url: string;
}

export interface InvoiceLine {
  id: string;
  stockItemId: string;
  description: string;
  quantity: number;
  unitPricePence: number;
  netPence: number;
  discountPence: number;
  vatPence: number;
  totalPence: number;
}

export interface Invoice {
  id: string;
  number: string;
  patientId: string;
  patientName: string;
  appointmentId: string | null;
  status: InvoiceStatus;
  discountPercent: number;
  vatPercent: number;
  lines: InvoiceLine[];
  totalPence: number;
  paidPence: number;
  balancePence: number;
  payments: { id: string; pence: number; at: string; takenBy: { id: string; name: string } }[];
  voidedBy: { id: string; name: string } | null;
  voidedAt: string | null;
  voidReason: string | null;
}

export interface StockItem {
  id: string;
  name: string;
  onHand: number;
  usable: number;
  reorderPoint: number;
  unitPricePence: number;
  low: boolean;
  batches: { batch: string; expiresOn: string; remaining: number; expired: boolean }[];
}

export interface Movement {
  id: string;
  delta: number;
  reason: StockReason;
  batch: string;
  balanceAfter: number;
}

export interface ClientEntry {
  id: string;
  name: string;
  patients: { id: string; name: string }[];
}
