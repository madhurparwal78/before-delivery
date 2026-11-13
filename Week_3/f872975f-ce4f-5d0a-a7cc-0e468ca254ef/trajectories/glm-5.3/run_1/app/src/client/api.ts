export interface SessionUser {
  id: number;
  name: string;
  email: string;
  role: 'owner' | 'hand' | 'maker';
}

export interface BoardSummary {
  tag: string;
  species: string;
  grade: string | null;
  status: 'tagged' | 'graded' | 'available' | 'held' | 'sold-whole' | 'cut';
  lot: { id: string; name: string };
  length_mm: number;
  width_mm: number;
  thickness_mm: number;
  volume_mm3: number;
  board_feet: string;
  rate_cents: number | null;
  price_cents: number | null;
  longest_clear_mm: number;
  defects: Array<{ kind: string; start_mm: number; end_mm: number }>;
  parent_tag: string | null;
}

export interface Hold {
  id: string;
  board: string;
  status: 'pending-payment' | 'held' | 'released' | 'converted-to-sale';
  release_reason: string | null;
  pieces: PieceInput[];
  cuts_mm: number[];
  take_mm: number | null;
  sale: 'cut' | 'whole' | null;
  offcut_mm: number | null;
  price_cents: number;
  deposit_cents: number;
  created_at: string;
  held_at: string | null;
  expires_at: string | null;
  killbill_payment_id: string | null;
}

export interface PieceInput {
  label: string;
  length_mm: number;
  width_mm: number;
  start_mm: number;
}

export interface FitResult {
  board: string;
  pieces: Array<PieceInput & { status: string }>;
  clear_count: number;
  cuts_mm: number[];
  take_mm: number | null;
  sale: 'cut' | 'whole' | null;
  offcut_mm: number | null;
  clear_offcut_mm: number | null;
  board_feet: string | null;
  price_cents: number | null;
  verdict: string;
}

export interface Ticket {
  id: string;
  status: 'issued' | 'at-saw' | 'done';
  board: string;
  maker: { name: string };
  pieces: PieceInput[];
  cuts_mm: number[];
  take_mm: number;
  sale: 'cut' | 'whole';
  offcut: { tag: string; planned_mm: number; measured_mm: number | null } | null;
  pdf_key: string;
  created_at: string;
  events: Array<{ kind: 'issued' | 'started' | 'done'; by: { name: string }; at: string }>;
}

export interface Invoice {
  id: string;
  ticket: string;
  board: string;
  price_cents: number;
  deposit_cents: number;
  amount_cents: number;
  lines: Array<{ label: string; length_mm: number; amount_cents: number }>;
  status: string;
  paid_at: string;
}

export interface Lot {
  id: string;
  name: string;
  origin: string;
  built_year: number;
}

export interface StockRow {
  species: string;
  open_boards: number;
  on_rack: number;
  held: number;
  volume_mm3: string;
  board_feet: string;
}

export interface BoardDetail extends BoardSummary {
  lot: Lot;
  photos: Array<{ id: string; url: string; thumb_url: string; width: number; height: number }>;
  my_hold: Hold | null;
}

export interface Rate {
  species: string;
  grade: string;
  rate_cents: number;
  effective_at: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields?: Record<string, string>;
  constructor(
    status: number,
    code: string,
    message: string,
    fields?: Record<string, string>,
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers: {
      ...(init.body && !(init.body instanceof File) ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }
  if (!response.ok) {
    const record = (payload ?? {}) as Record<string, unknown>;
    throw new ApiError(
      response.status,
      String(record['error'] ?? 'not_found'),
      String(record['message'] ?? ''),
      (record['fields'] as Record<string, string> | undefined) ?? undefined,
    );
  }
  return payload as T;
}

export const api = {
  async health(): Promise<{ status: string }> {
    return request('/api/health');
  },
  async services(): Promise<{ billing: 'up' | 'down'; storage: 'up' | 'down' }> {
    return request('/api/services');
  },
  async session(): Promise<{ user: SessionUser }> {
    return request('/api/session');
  },
  async signIn(email: string, password: string): Promise<{ user: SessionUser }> {
    return request('/api/session', { method: 'POST', body: JSON.stringify({ email, password }) });
  },
  async signOut(): Promise<void> {
    await request('/api/session', { method: 'DELETE' });
  },
  async lots(): Promise<{ lots: Lot[] }> {
    return request('/api/lots');
  },
  async boards(params: string): Promise<{ count: number; boards: BoardSummary[] }> {
    return request(`/api/boards${params}`);
  },
  async board(tag: string): Promise<{ board: BoardDetail }> {
    return request(`/api/boards/${encodeURIComponent(tag)}`);
  },
  async intake(body: unknown): Promise<{ board: BoardSummary }> {
    return request('/api/boards', { method: 'POST', body: JSON.stringify(body) });
  },
  async grade(tag: string, grade: string): Promise<unknown> {
    return request(`/api/boards/${encodeURIComponent(tag)}/grade`, { method: 'POST', body: JSON.stringify({ grade }) });
  },
  async listBoard(tag: string): Promise<unknown> {
    return request(`/api/boards/${encodeURIComponent(tag)}/list`, { method: 'POST', body: '{}' });
  },
  async fit(tag: string, pieces: PieceInput[]): Promise<FitResult> {
    return request(`/api/boards/${encodeURIComponent(tag)}/fit`, { method: 'POST', body: JSON.stringify({ pieces }) });
  },
  async importLayout(tag: string, bytes: ArrayBuffer): Promise<{ layout: Record<string, unknown> }> {
    return request(`/api/boards/${encodeURIComponent(tag)}/layout`, { method: 'POST', body: new Uint8Array(bytes) });
  },
  async rates(): Promise<{ rates: Rate[]; scheduled: Rate[] }> {
    return request('/api/rates');
  },
  async putRate(body: unknown): Promise<unknown> {
    return request('/api/rates', { method: 'PUT', body: JSON.stringify(body) });
  },
  async stock(): Promise<{ species: StockRow[]; totals: Omit<StockRow, 'species'> }> {
    return request('/api/stock');
  },
  async holds(): Promise<{ holds: Hold[] }> {
    return request('/api/holds');
  },
  async hold(tag: string, pieces: PieceInput[], cardNumber: string, key: string): Promise<{ hold: Hold }> {
    return request('/api/holds', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
      body: JSON.stringify({ board: tag, pieces, card_number: cardNumber }),
    });
  },
  async cancelHold(id: string): Promise<{ hold: Hold }> {
    return request(`/api/holds/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: '{}' });
  },
  async purchase(id: string, key: string): Promise<{ sale: { ticket: string; invoice: string } }> {
    return request(`/api/holds/${encodeURIComponent(id)}/purchase`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
      body: '{}',
    });
  },
  async tickets(status?: string): Promise<{ tickets: Ticket[] }> {
    const suffix = status ? `?status=${encodeURIComponent(status)}` : '';
    return request(`/api/tickets${suffix}`);
  },
  async ticket(id: string): Promise<{ ticket: Ticket }> {
    return request(`/api/tickets/${encodeURIComponent(id)}`);
  },
  async startTicket(id: string): Promise<{ ticket: Ticket }> {
    return request(`/api/tickets/${encodeURIComponent(id)}/start`, { method: 'POST', body: '{}' });
  },
  async doneTicket(id: string, offcutMm: number | null): Promise<{ ticket: Ticket }> {
    return request(`/api/tickets/${encodeURIComponent(id)}/done`, {
      method: 'POST',
      body: JSON.stringify(offcutMm === null ? {} : { offcut_mm: offcutMm }),
    });
  },
  async invoices(): Promise<{ invoices: Invoice[] }> {
    return request('/api/invoices');
  },
  async uploadPhoto(tag: string, file: File): Promise<unknown> {
    return request(`/api/boards/${encodeURIComponent(tag)}/photos`, {
      method: 'POST',
      headers: { 'Content-Type': file.type },
      body: new Uint8Array(new Uint8Array(await file.arrayBuffer())),
    });
  },
};
