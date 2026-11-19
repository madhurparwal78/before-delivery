export const REGIONS = ["norte", "centro", "sul", "sao_miguel", "terceira"] as const;
export type Region = (typeof REGIONS)[number];

export const DISPLAY_STATES = ["open", "closing_soon", "closed", "stock_critical", "suspended"] as const;
export type DisplayState = (typeof DISPLAY_STATES)[number];

export const STATE_LABELS: Record<DisplayState, string> = {
  open: "Open",
  closing_soon: "Closing soon",
  closed: "Closed",
  stock_critical: "Stock critical",
  suspended: "Suspended",
};

export type Role = "lead" | "manager" | "care" | "shopper";

export type OrderStatus = "placed" | "picking" | "ready" | "collected" | "cancelled";
export type ReturnStatus = "requested" | "received" | "settled" | "declined";
export type HoldStatus = "active" | "released" | "converted";

export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  placed: ["picking", "cancelled"],
  picking: ["ready", "cancelled"],
  ready: ["collected", "cancelled"],
  collected: [],
  cancelled: [],
};

export const RETURN_TRANSITIONS: Record<ReturnStatus, ReturnStatus[]> = {
  requested: ["received", "declined"],
  received: ["settled"],
  settled: [],
  declined: [],
};

export function isOrderTransitionLegal(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

export function isReturnTransitionLegal(from: ReturnStatus, to: ReturnStatus): boolean {
  return RETURN_TRANSITIONS[from].includes(to);
}

export interface SeedPerson {
  email: string;
  name: string;
  role: Role;
  operator: string;
  shops: string[];
}

export interface SeedStore {
  id: string;
  operator: string;
  name: string;
  city: string;
  region: Region;
  lat: number;
  lon: number;
  timezone: "Europe/Lisbon" | "Atlantic/Azores";
  hours: "daily" | "standard";
  suspended: boolean;
  suspension_reason: string | null;
}

export interface SeedProduct {
  operator: string;
  sku: string;
  name: string;
  unit_price_milli: number;
}

export const OPERATORS = [
  { id: "atlantico", name: "Grupo Atlântico Ferragens", prefix: "AT" },
  { id: "casalusa", name: "Casa Lusa Ferragens", prefix: "CL" },
] as const;

export const PEOPLE: SeedPerson[] = [
  { email: "lead.atlantico@tramela.example", name: "Inês Carvalho", role: "lead", operator: "atlantico", shops: [] },
  { email: "gerente.faro@tramela.example", name: "Tiago Mendes", role: "manager", operator: "atlantico", shops: ["AT05", "AT06"] },
  { email: "gerente.lisboa@tramela.example", name: "Rui Antunes", role: "manager", operator: "atlantico", shops: ["AT01"] },
  { email: "gerente.pdelgada@tramela.example", name: "Sofia Medeiros", role: "manager", operator: "atlantico", shops: ["AT11"] },
  { email: "apoio.atlantico@tramela.example", name: "Joana Pires", role: "care", operator: "atlantico", shops: [] },
  { email: "cliente.ana@tramela.example", name: "Ana Ribeiro", role: "shopper", operator: "atlantico", shops: [] },
  { email: "cliente.bruno@tramela.example", name: "Bruno Faria", role: "shopper", operator: "atlantico", shops: [] },
  { email: "cliente.eva@tramela.example", name: "Eva Couto", role: "shopper", operator: "atlantico", shops: [] },
  { email: "cliente.filipe@tramela.example", name: "Filipe Rocha", role: "shopper", operator: "atlantico", shops: [] },
  { email: "cliente.gil@tramela.example", name: "Gil Moreira", role: "shopper", operator: "atlantico", shops: [] },
  { email: "cliente.helena@tramela.example", name: "Helena Duarte", role: "shopper", operator: "atlantico", shops: [] },
  { email: "lead.casalusa@tramela.example", name: "Marta Lopes", role: "lead", operator: "casalusa", shops: [] },
  { email: "gerente.braga@tramela.example", name: "Hugo Sá", role: "manager", operator: "casalusa", shops: ["CL03"] },
  { email: "apoio.casalusa@tramela.example", name: "Carla Nunes", role: "care", operator: "casalusa", shops: [] },
  { email: "cliente.diogo@tramela.example", name: "Diogo Teixeira", role: "shopper", operator: "casalusa", shops: [] },
];

export const STORES: SeedStore[] = [
  { id: "AT01", operator: "atlantico", name: "Loja Lisboa Baixa", city: "Lisboa", region: "centro", lat: 38.711, lon: -9.1366, timezone: "Europe/Lisbon", hours: "daily", suspended: false, suspension_reason: null },
  { id: "AT02", operator: "atlantico", name: "Loja Lisboa Alvalade", city: "Lisboa", region: "centro", lat: 38.753, lon: -9.144, timezone: "Europe/Lisbon", hours: "standard", suspended: false, suspension_reason: null },
  { id: "AT03", operator: "atlantico", name: "Loja Almada", city: "Almada", region: "centro", lat: 38.679, lon: -9.1569, timezone: "Europe/Lisbon", hours: "standard", suspended: false, suspension_reason: null },
  { id: "AT04", operator: "atlantico", name: "Loja Setúbal", city: "Setúbal", region: "centro", lat: 38.5244, lon: -8.8882, timezone: "Europe/Lisbon", hours: "standard", suspended: false, suspension_reason: null },
  { id: "AT05", operator: "atlantico", name: "Loja Faro Centro", city: "Faro", region: "sul", lat: 37.0194, lon: -7.9304, timezone: "Europe/Lisbon", hours: "standard", suspended: false, suspension_reason: null },
  { id: "AT06", operator: "atlantico", name: "Loja Olhão", city: "Olhão", region: "sul", lat: 37.026, lon: -7.8411, timezone: "Europe/Lisbon", hours: "standard", suspended: false, suspension_reason: null },
  { id: "AT07", operator: "atlantico", name: "Loja Portimão", city: "Portimão", region: "sul", lat: 37.1386, lon: -8.537, timezone: "Europe/Lisbon", hours: "standard", suspended: true, suspension_reason: "Flood repairs" },
  { id: "AT08", operator: "atlantico", name: "Loja Porto Bolhão", city: "Porto", region: "norte", lat: 41.1496, lon: -8.6067, timezone: "Europe/Lisbon", hours: "standard", suspended: false, suspension_reason: null },
  { id: "AT09", operator: "atlantico", name: "Loja Matosinhos", city: "Matosinhos", region: "norte", lat: 41.1844, lon: -8.6963, timezone: "Europe/Lisbon", hours: "standard", suspended: false, suspension_reason: null },
  { id: "AT10", operator: "atlantico", name: "Loja Braga Sé", city: "Braga", region: "norte", lat: 41.5503, lon: -8.427, timezone: "Europe/Lisbon", hours: "standard", suspended: false, suspension_reason: null },
  { id: "AT11", operator: "atlantico", name: "Loja Ponta Delgada", city: "Ponta Delgada", region: "sao_miguel", lat: 37.7412, lon: -25.6756, timezone: "Atlantic/Azores", hours: "daily", suspended: false, suspension_reason: null },
  { id: "AT12", operator: "atlantico", name: "Loja Angra do Heroísmo", city: "Angra do Heroísmo", region: "terceira", lat: 38.655, lon: -27.221, timezone: "Atlantic/Azores", hours: "standard", suspended: false, suspension_reason: null },
  { id: "CL01", operator: "casalusa", name: "Casa Lusa Porto Boavista", city: "Porto", region: "norte", lat: 41.1612, lon: -8.644, timezone: "Europe/Lisbon", hours: "standard", suspended: false, suspension_reason: null },
  { id: "CL02", operator: "casalusa", name: "Casa Lusa Gaia", city: "Vila Nova de Gaia", region: "norte", lat: 41.1239, lon: -8.6118, timezone: "Europe/Lisbon", hours: "standard", suspended: false, suspension_reason: null },
  { id: "CL03", operator: "casalusa", name: "Casa Lusa Braga", city: "Braga", region: "norte", lat: 41.5454, lon: -8.4265, timezone: "Europe/Lisbon", hours: "standard", suspended: false, suspension_reason: null },
  { id: "CL04", operator: "casalusa", name: "Casa Lusa Coimbra", city: "Coimbra", region: "centro", lat: 40.2033, lon: -8.4103, timezone: "Europe/Lisbon", hours: "standard", suspended: false, suspension_reason: null },
  { id: "CL05", operator: "casalusa", name: "Casa Lusa Aveiro", city: "Aveiro", region: "centro", lat: 40.6405, lon: -8.6538, timezone: "Europe/Lisbon", hours: "standard", suspended: false, suspension_reason: null },
  { id: "CL06", operator: "casalusa", name: "Casa Lusa Lisboa Benfica", city: "Lisboa", region: "centro", lat: 38.751, lon: -9.201, timezone: "Europe/Lisbon", hours: "standard", suspended: false, suspension_reason: null },
  { id: "CL07", operator: "casalusa", name: "Casa Lusa Cascais", city: "Cascais", region: "centro", lat: 38.6979, lon: -9.4215, timezone: "Europe/Lisbon", hours: "standard", suspended: false, suspension_reason: null },
  { id: "CL08", operator: "casalusa", name: "Casa Lusa Faro", city: "Faro", region: "sul", lat: 37.017, lon: -7.935, timezone: "Europe/Lisbon", hours: "standard", suspended: false, suspension_reason: null },
  { id: "CL09", operator: "casalusa", name: "Casa Lusa Lagos", city: "Lagos", region: "sul", lat: 37.1028, lon: -8.673, timezone: "Europe/Lisbon", hours: "standard", suspended: true, suspension_reason: "Stocktake" },
  { id: "CL10", operator: "casalusa", name: "Casa Lusa Ribeira Grande", city: "Ribeira Grande", region: "sao_miguel", lat: 37.821, lon: -25.515, timezone: "Atlantic/Azores", hours: "standard", suspended: false, suspension_reason: null },
];

export const PRODUCTS: SeedProduct[] = [
  { operator: "atlantico", sku: "VM-750", name: "Verniz marítimo 750 ml", unit_price_milli: 24900 },
  { operator: "atlantico", sku: "TE-BR-4L", name: "Tinta esmalte branca 4 L", unit_price_milli: 38500 },
  { operator: "atlantico", sku: "FITA-48", name: "Fita-cola de pintor 48 mm", unit_price_milli: 4995 },
  { operator: "atlantico", sku: "PRF-440", name: "Parafuso inox A2 4x40 mm (unidade)", unit_price_milli: 35 },
  { operator: "atlantico", sku: "MANG-25", name: "Mangueira de jardim 25 m", unit_price_milli: 29990 },
  { operator: "atlantico", sku: "TES-POD", name: "Tesoura de poda", unit_price_milli: 12490 },
  { operator: "atlantico", sku: "CAD-40", name: "Cadeado latão 40 mm", unit_price_milli: 9990 },
  { operator: "atlantico", sku: "REL-1KG", name: "Semente de relva 1 kg", unit_price_milli: 7450 },
  { operator: "casalusa", sku: "CL-VM-750", name: "Verniz marítimo 750 ml", unit_price_milli: 26500 },
  { operator: "casalusa", sku: "CL-TP-5L", name: "Tinta plástica branca 5 L", unit_price_milli: 31900 },
  { operator: "casalusa", sku: "CL-PRG-50", name: "Prego aço 50 mm (unidade)", unit_price_milli: 20 },
  { operator: "casalusa", sku: "CL-REG-10", name: "Regador 10 L", unit_price_milli: 8750 },
  { operator: "casalusa", sku: "CL-LUV", name: "Luvas de jardim", unit_price_milli: 3990 },
];

export const STOCK_EXCEPTIONS: { store: string; sku: string; on_hand: number }[] = [
  { store: "AT01", sku: "PRF-440", on_hand: 500 },
  { store: "AT01", sku: "FITA-48", on_hand: 60 },
  { store: "AT05", sku: "VM-750", on_hand: 1 },
  { store: "AT05", sku: "TES-POD", on_hand: 2 },
  { store: "AT06", sku: "VM-750", on_hand: 1 },
  { store: "AT11", sku: "VM-750", on_hand: 2 },
  { store: "AT11", sku: "MANG-25", on_hand: 0 },
  { store: "AT12", sku: "VM-750", on_hand: 3 },
  { store: "CL08", sku: "CL-VM-750", on_hand: 1 },
];

export const AREAS = [
  { name: "Lisboa", lat: 38.7223, lon: -9.1393 },
  { name: "Porto", lat: 41.1579, lon: -8.6291 },
  { name: "Faro", lat: 37.0194, lon: -7.9304 },
  { name: "Coimbra", lat: 40.2033, lon: -8.4103 },
  { name: "Braga", lat: 41.5454, lon: -8.4265 },
  { name: "Ponta Delgada", lat: 37.7412, lon: -25.6756 },
  { name: "Angra do Heroísmo", lat: 38.655, lon: -27.221 },
] as const;
