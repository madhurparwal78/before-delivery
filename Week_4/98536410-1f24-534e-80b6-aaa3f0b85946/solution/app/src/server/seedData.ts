// Seed data from the brief: invented operators, people, shops, products and opening hours.

export interface DayHours {
  weekday: number;
  open: boolean;
  opens: string | null;
  closes: string | null;
}

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];

function daily(): DayHours[] {
  return WEEKDAYS.map((weekday) => ({ weekday, open: true, opens: "08:00", closes: "20:00" }));
}

function standard(): DayHours[] {
  return WEEKDAYS.map((weekday) => {
    if (weekday <= 5) return { weekday, open: true, opens: "09:00", closes: "19:00" };
    if (weekday === 6) return { weekday, open: true, opens: "09:00", closes: "13:00" };
    return { weekday, open: false, opens: null, closes: null };
  });
}

export const seedPassword = "estate-demo-2026";

export const seedOperators = [
  { id: "atlantico", name: "Grupo Atlântico Ferragens", prefix: "AT" },
  { id: "casalusa", name: "Casa Lusa Ferragens", prefix: "CL" },
] as const;

export const seedPeople = [
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
] as const;

const LISBON = "Europe/Lisbon";
const AZORES = "Atlantic/Azores";

interface SeedShop {
  id: string;
  operator: string;
  name: string;
  city: string;
  region: string;
  lat: number;
  lon: number;
  timezone: string;
  vatRate: number;
  hours: DayHours[];
  suspendedReason: string | null;
}

function shop(id: string, name: string, city: string, region: string, lat: number, lon: number, timezone: string,
  hours: DayHours[], suspendedReason: string | null = null): SeedShop {
  return { id, operator: id.startsWith("AT") ? "atlantico" : "casalusa", name, city, region, lat, lon, timezone, vatRate: timezone === AZORES ? 16 : 23, hours, suspendedReason };
}

export const seedShops: SeedShop[] = [
  shop("AT01", "Loja Lisboa Baixa", "Lisboa", "centro", 38.711, -9.1366, LISBON, daily()),
  shop("AT02", "Loja Lisboa Alvalade", "Lisboa", "centro", 38.753, -9.144, LISBON, standard()),
  shop("AT03", "Loja Almada", "Almada", "centro", 38.679, -9.1569, LISBON, standard()),
  shop("AT04", "Loja Setúbal", "Setúbal", "centro", 38.5244, -8.8882, LISBON, standard()),
  shop("AT05", "Loja Faro Centro", "Faro", "sul", 37.0194, -7.9304, LISBON, standard()),
  shop("AT06", "Loja Olhão", "Olhão", "sul", 37.026, -7.8411, LISBON, standard()),
  shop("AT07", "Loja Portimão", "Portimão", "sul", 37.1386, -8.537, LISBON, standard(), "Flood repairs"),
  shop("AT08", "Loja Porto Bolhão", "Porto", "norte", 41.1496, -8.6067, LISBON, standard()),
  shop("AT09", "Loja Matosinhos", "Matosinhos", "norte", 41.1844, -8.6963, LISBON, standard()),
  shop("AT10", "Loja Braga Sé", "Braga", "norte", 41.5503, -8.427, LISBON, standard()),
  shop("AT11", "Loja Ponta Delgada", "Ponta Delgada", "sao_miguel", 37.7412, -25.6756, AZORES, daily()),
  shop("AT12", "Loja Angra do Heroísmo", "Angra do Heroísmo", "terceira", 38.655, -27.221, AZORES, standard()),
  shop("CL01", "Casa Lusa Porto Boavista", "Porto", "norte", 41.1612, -8.644, LISBON, standard()),
  shop("CL02", "Casa Lusa Gaia", "Vila Nova de Gaia", "norte", 41.1239, -8.6118, LISBON, standard()),
  shop("CL03", "Casa Lusa Braga", "Braga", "norte", 41.5454, -8.4265, LISBON, standard()),
  shop("CL04", "Casa Lusa Coimbra", "Coimbra", "centro", 40.2033, -8.4103, LISBON, standard()),
  shop("CL05", "Casa Lusa Aveiro", "Aveiro", "centro", 40.6405, -8.6538, LISBON, standard()),
  shop("CL06", "Casa Lusa Lisboa Benfica", "Lisboa", "centro", 38.751, -9.201, LISBON, standard()),
  shop("CL07", "Casa Lusa Cascais", "Cascais", "centro", 38.6979, -9.4215, LISBON, standard()),
  shop("CL08", "Casa Lusa Faro", "Faro", "sul", 37.017, -7.935, LISBON, standard()),
  shop("CL09", "Casa Lusa Lagos", "Lagos", "sul", 37.1028, -8.673, LISBON, standard(), "Stocktake"),
  shop("CL10", "Casa Lusa Ribeira Grande", "Ribeira Grande", "sao_miguel", 37.821, -25.515, AZORES, standard()),
];

export const seedProducts = [
  { operator: "atlantico", sku: "VM-750", name: "Verniz marítimo 750 ml", price: 24900 },
  { operator: "atlantico", sku: "TE-BR-4L", name: "Tinta esmalte branca 4 L", price: 38500 },
  { operator: "atlantico", sku: "FITA-48", name: "Fita-cola de pintor 48 mm", price: 4995 },
  { operator: "atlantico", sku: "PRF-440", name: "Parafuso inox A2 4x40 mm (unidade)", price: 35 },
  { operator: "atlantico", sku: "MANG-25", name: "Mangueira de jardim 25 m", price: 29990 },
  { operator: "atlantico", sku: "TES-POD", name: "Tesoura de poda", price: 12490 },
  { operator: "atlantico", sku: "CAD-40", name: "Cadeado latão 40 mm", price: 9990 },
  { operator: "atlantico", sku: "REL-1KG", name: "Semente de relva 1 kg", price: 7450 },
  { operator: "casalusa", sku: "CL-VM-750", name: "Verniz marítimo 750 ml", price: 26500 },
  { operator: "casalusa", sku: "CL-TP-5L", name: "Tinta plástica branca 5 L", price: 31900 },
  { operator: "casalusa", sku: "CL-PRG-50", name: "Prego aço 50 mm (unidade)", price: 20 },
  { operator: "casalusa", sku: "CL-REG-10", name: "Regador 10 L", price: 8750 },
  { operator: "casalusa", sku: "CL-LUV", name: "Luvas de jardim", price: 3990 },
] as const;

export const seedStockDefault = 20;

export const seedStockExceptions: Record<string, number> = {
  "AT01/PRF-440": 500,
  "AT01/FITA-48": 60,
  "AT05/VM-750": 1,
  "AT05/TES-POD": 2,
  "AT06/VM-750": 1,
  "AT11/VM-750": 2,
  "AT11/MANG-25": 0,
  "AT12/VM-750": 3,
  "CL08/CL-VM-750": 1,
};
