/** Typed access to the app's own API. The browser talks to no other origin. */

import type {
  AdminOrder,
  Comment,
  ComparisonItem,
  DialMode,
  FavouriteItem,
  Order,
  Placement,
  Product,
  Project,
  ProjectCover,
  ProjectSummary,
  QuoteShare,
  ServiceHealth,
  StockItem,
  TradeApplication,
  User,
} from "../shared/types.js";

export interface ApiFailure {
  status: number;
  code: string;
  fields: Record<string, string>;
  /** Some failures publish the order or an available count alongside the code. */
  extra: Record<string, unknown>;
}

export class ApiError extends Error {
  constructor(readonly failure: ApiFailure) {
    super(`${failure.status} ${failure.code}`);
    this.name = "ApiError";
  }

  field(name: string): string | undefined {
    return this.failure.fields[name];
  }
}

async function request<T>(
  method: string,
  path: string,
  options: { body?: unknown; idempotencyKey?: string; formData?: FormData } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;

  if (options.formData) {
    body = options.formData;
  } else if (options.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(options.body);
  }
  if (options.idempotencyKey) headers["idempotency-key"] = options.idempotencyKey;

  const response = await fetch(path, { method, headers, body, credentials: "same-origin" });
  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = text === "" ? null : JSON.parse(text);
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const record = (payload ?? {}) as Record<string, unknown>;
    const { error, errors, ...extra } = record;
    throw new ApiError({
      status: response.status,
      code: typeof error === "string" ? error : "unknown",
      fields: (errors ?? {}) as Record<string, string>,
      extra,
    });
  }
  return payload as T;
}

const get = <T>(path: string): Promise<T> => request<T>("GET", path);

export interface CatalogueQuery {
  q?: string;
  family?: string | null;
  finish?: string[];
  beam?: number[];
  cct?: number[];
  clearance?: boolean;
}

export function catalogueSearch(query: CatalogueQuery): string {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.family) params.set("family", query.family);
  if (query.finish?.length) params.set("finish", query.finish.join(","));
  if (query.beam?.length) params.set("beam", query.beam.join(","));
  if (query.cct?.length) params.set("cct", query.cct.join(","));
  if (query.clearance) params.set("clearance", "true");
  return params.toString();
}

export const api = {
  signup: (body: {
    email: string;
    password: string;
    name: string;
    account_type: "retail" | "trade";
    trade?: { business_name: string; nzbn: string; occupation: string };
  }) => request<{ user: User }>("POST", "/api/auth/signup", { body }),

  signin: (body: { email: string; password: string }) =>
    request<{ user: User }>("POST", "/api/auth/signin", { body }),

  signout: () => request<void>("POST", "/api/auth/signout"),
  me: () => get<{ user: User }>("/api/me"),
  setDial: (mode: DialMode) => request<{ dial_mode: DialMode }>("PUT", "/api/me/dial", { body: { mode } }),

  catalogue: (query: CatalogueQuery) => {
    const search = catalogueSearch(query);
    return get<{ products: Product[] }>(`/api/catalogue${search ? `?${search}` : ""}`);
  },
  product: (slug: string) => get<{ product: Product }>(`/api/products/${encodeURIComponent(slug)}`),
  compare: (codes: string[]) =>
    get<{ items: ComparisonItem[] }>(`/api/compare?codes=${encodeURIComponent(codes.join(","))}`),

  favourites: () => get<{ items: FavouriteItem[] }>("/api/favourites"),
  saveFavourite: (code: string) =>
    request<{ saved: boolean }>("PUT", `/api/favourites/${encodeURIComponent(code)}`),
  removeFavourite: (code: string) => request<void>("DELETE", `/api/favourites/${encodeURIComponent(code)}`),

  cart: () => get<{ order: Order }>("/api/cart"),
  addCartLine: (variantCode: string, quantity: number) =>
    request<{ order: Order }>("POST", "/api/cart/lines", { body: { variant_code: variantCode, quantity } }),
  setCartLine: (code: string, quantity: number) =>
    request<{ order: Order }>("PATCH", `/api/cart/lines/${encodeURIComponent(code)}`, { body: { quantity } }),

  authorise: (
    orderKey: string,
    body: {
      card: { number: string; expiry: string; cvc: string; name: string };
      delivery: { name: string; address: string; city: string; postcode: string };
    },
    idempotencyKey: string,
  ) => request<{ order: Order }>("POST", `/api/orders/${orderKey}/authorise`, { body, idempotencyKey }),

  placeOnAccount: (
    orderKey: string,
    body: {
      delivery: { name: string; address: string; city: string; postcode: string };
      purchase_order?: string;
    },
    idempotencyKey: string,
  ) => request<{ order: Order }>("POST", `/api/orders/${orderKey}/place-on-account`, { body, idempotencyKey }),

  orders: () => get<{ orders: Order[] }>("/api/orders"),
  order: (orderKey: string) => get<{ order: Order }>(`/api/orders/${encodeURIComponent(orderKey)}`),

  newsletter: (body: { email: string; occupation: string; consent: boolean }) =>
    request<{ status: string }>("POST", "/api/newsletter", { body }),
  confirmNewsletter: (token: string) =>
    get<{ status: string; email: string; occupation: string }>(
      `/api/newsletter/confirm?token=${encodeURIComponent(token)}`,
    ),

  createProject: (body: {
    name: string;
    client_name?: string;
    ceiling_height_mm?: number;
    room_width_mm?: number;
    room_depth_mm?: number;
  }) => request<{ project: Project }>("POST", "/api/projects", { body }),
  projects: () => get<{ projects: ProjectSummary[] }>("/api/projects"),
  project: (id: string) => get<{ project: Project }>(`/api/projects/${id}`),
  patchProject: (
    id: string,
    body: Partial<{
      name: string;
      client_name: string;
      ceiling_height_mm: number;
      room_width_mm: number;
      room_depth_mm: number;
    }>,
  ) => request<{ project: Project }>("PATCH", `/api/projects/${id}`, { body }),
  addProjectLine: (id: string, variantCode: string, quantity: number) =>
    request<{ project: Project }>("POST", `/api/projects/${id}/lines`, {
      body: { variant_code: variantCode, quantity },
    }),
  setProjectLine: (id: string, code: string, quantity: number) =>
    request<{ project: Project }>("PATCH", `/api/projects/${id}/lines/${encodeURIComponent(code)}`, {
      body: { quantity },
    }),
  uploadCover: (id: string, file: File) => {
    const formData = new FormData();
    formData.append("image", file);
    return request<{ cover: ProjectCover }>("POST", `/api/projects/${id}/cover`, { formData });
  },

  createPlacement: (id: string, body: { variant_code: string; x_mm: number; y_mm: number }) =>
    request<{ placement: Placement; live: boolean }>("POST", `/api/projects/${id}/placements`, { body }),
  movePlacement: (id: string, placementId: string, body: { x_mm: number; y_mm: number }) =>
    request<{ placement: Placement; live: boolean }>("PATCH", `/api/projects/${id}/placements/${placementId}`, {
      body,
    }),
  deletePlacement: (id: string, placementId: string) =>
    request<void>("DELETE", `/api/projects/${id}/placements/${placementId}`),

  addCollaborator: (id: string, email: string) =>
    request<{ collaborator: { user_id: string; name: string; email: string } }>(
      "POST",
      `/api/projects/${id}/collaborators`,
      { body: { email } },
    ),

  comments: (id: string) => get<{ comments: Comment[] }>(`/api/projects/${id}/comments`),
  postComment: (id: string, body: string) =>
    request<{ comment: Comment }>("POST", `/api/projects/${id}/comments`, { body: { body } }),

  createShare: (
    id: string,
    body: { recipients: string[]; price_display: "trade" | "retail" | "none"; message?: string },
  ) => request<{ share: QuoteShare }>("POST", `/api/projects/${id}/shares`, { body }),
  shares: (id: string) => get<{ shares: QuoteShare[] }>(`/api/projects/${id}/shares`),

  adminApplications: () => get<{ applications: TradeApplication[] }>("/api/admin/trade-applications"),
  approveApplication: (id: string) =>
    request<{ application: TradeApplication }>("POST", `/api/admin/trade-applications/${id}/approve`),
  declineApplication: (id: string, reason: string) =>
    request<{ application: TradeApplication }>("POST", `/api/admin/trade-applications/${id}/decline`, {
      body: { reason },
    }),
  adminOrders: () => get<{ orders: AdminOrder[] }>("/api/admin/orders"),
  dispatchOrder: (orderKey: string) =>
    request<{ order: Order }>("POST", `/api/admin/orders/${encodeURIComponent(orderKey)}/dispatch`),
  refundOrder: (orderKey: string, body: { amount_cents: number; reason: string }, idempotencyKey: string) =>
    request<{ order: Order }>("POST", `/api/admin/orders/${encodeURIComponent(orderKey)}/refunds`, {
      body,
      idempotencyKey,
    }),
  recordPayment: (orderKey: string, amountCents: number) =>
    request<{ order: Order }>("POST", `/api/admin/orders/${encodeURIComponent(orderKey)}/record-payment`, {
      body: { amount_cents: amountCents },
    }),
  adminStock: () => get<{ items: StockItem[] }>("/api/admin/stock"),
  adjustVariant: (code: string, body: { stock_adjust?: number; note?: string }) =>
    request<{ item: StockItem }>("PATCH", `/api/admin/variants/${encodeURIComponent(code)}`, { body }),
  adminHealth: () => get<{ services: ServiceHealth }>("/api/admin/health"),
};
