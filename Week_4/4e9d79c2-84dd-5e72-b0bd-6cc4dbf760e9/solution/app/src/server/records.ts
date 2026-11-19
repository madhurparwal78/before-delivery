// The rows the domain reads, one interface per table, named by the brief's terms.
import type { Block } from "./hours.js";
import type { Party } from "./domain.js";

export interface DeskRow { id: string; name: string; email: string; email_folded: string; password_hash: string; next_run: number; holidays: string[] | null; holidays_read_at: number | null; review_list: ReviewRow[]; created_at: number }
interface ReviewRow { row: number; message: string }
export interface CustomerRow { id: string; desk_id: string; name: string; email: string; email_folded: string; telephone: string; telephone_folded: string; language: string; notes: string | null; state: string; closed_at: number | null; erase_at: number | null; created_at: number }
interface CancellationLine { vehicleId: string; days: number; charge: string; paid: string; refundsDue: string; owed: string }
export interface Cancellation { id: string; noticeAt: string | null; by: string; lines: CancellationLine[] }
export interface Leg { km: string; minutes: number; miles: string }
export interface HireRow {
  id: string; desk_id: string; customer_id: string; occasion: string; journey_type: string; state: string; plan_sizes: number[] | null; party: Party; details: string | null;
  name: string; email: string | null; telephone: string | null; language: string; submitted_body: string | null; merged_into: string | null; created_at: number;
  depart_date: string; depart_time: string; depart_repeated: string | null; depart_instant: number; return_date: string | null; return_time: string | null; return_repeated: string | null; return_instant: number | null;
  legs: Leg[] | null; plan_out_of_date: boolean; awarded_operator: string | null; awarded_at: number | null; quote_version: number; quote_token: string | null; quote_sent_at: number | null; quote_ends_at: number | null;
  rate_table_id: string | null; quote_mailed: boolean; quote_edited: boolean; quote_changed_at: number | null; accepted_at: number | null; deposit_said_sent: boolean; reminded: boolean; cancellation: Cancellation | null;
}
export interface StopRow { id: string; text: string; checked: boolean }
export interface OperatorRow { desk_id: string; id: string; name: string; town: string; email: string; telephone: string; sizes: number[]; listed: boolean; dbs_checked_on: string | null }
export interface PaperRow { desk_id: string; operator_id: string; kind: string; ends_on: string; stored: boolean; object_key: string | null; content_type: string | null; expiry_mailed: boolean }
export interface OperatorView extends OperatorRow { paperRows: PaperRow[] }
export interface BidAskRow { token: string; desk_id: string; hire_id: string; operator_id: string; sent_at: number; closes_at: number; prices: number[] | null; received_at: number | null; withdrawn: boolean; mailed: boolean }
export interface VehicleRow { id: string; hire_id: string; position: number; seats: number; operator_id: string | null; bought: number; margin_halves: number; deposit: number; charges: number; depart_date: string; depart_time: string; depart_repeated: string | null; depart_instant: number }
export interface RunRow { id: string; desk_id: string; number: number; hire_id: string; vehicle_id: string; driver_name: string | null; driver_telephone: string | null; telephone_folded: string | null; told_at: number | null; confirmed: boolean; token: string; second_driver: boolean; duty_start: number | null; blocks: Block[] }
export interface FlightRow { run_id: string; stop_id: string; code: string; landed_at: number | null; read_at: number | null; failed: boolean }
export interface PressRow { id: string; run_id: string; stop_id: string; kind: string; at: number; repeat_key: string }
export interface AcceptedChargeRow { run_id: string; stop_id: string; kind: string; minutes: number; pennies: number }
export interface LedgerLineRow { id: string; desk_id: string; movement_id: string; hire_id: string; vehicle_id: string | null; account: string; pennies: number; at: number; part: string; description: string }
export interface PassengerRow { id: string; hire_id: string; name: string; grp: string; needs: string; folded: string; listed_twice: boolean; wheelchair: boolean; vehicle_id: string | null; seat: string | null }
interface HistoryEntry { at: string | null; who: string; what: string }
export interface DocumentRow { id: string; desk_id: string; hire_id: string; kind: string; state: string; number: string | null; object_key: string | null; customer_name: string | null; created_at: number; history: HistoryEntry[]; erased: boolean }
export interface ComplaintRow { id: string; desk_id: string; customer_id: string; summary: string; received_date: string; received_time: string; reply_due: string; holiday_line: string | null }
export interface LostItemRow { id: string; desk_id: string; description: string; found_on: string; held_to: string; returned_at: number | null; owner_details: string | null }
export interface StatementRow { row: number; date: string; description: string; amount: string; balance: string; reference?: string }
export interface StatementPreviewRow { id: string; desk_id: string; matched: StatementRow[]; created_at: number }
export interface ChangeRow { id: string; hire_id: string; at: number; body: { old: { total: string }; new: { total: string } } }
