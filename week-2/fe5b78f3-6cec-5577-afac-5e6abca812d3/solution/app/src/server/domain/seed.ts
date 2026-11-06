// Seed data from the brief (Seed data). Applied to Postgres on every start; the catalog is then read back from it.
import type { ClassCode } from "../../shared/api.js";

interface StopSeed {
  code: string;
  name: string;
  km: number;
  /** Minutes after 00:00 IST on the run date (the day the train leaves its origin). */
  minutes: number;
  remote: boolean;
}

interface TrainSeed {
  number: string;
  name: string;
  stops: StopSeed[];
  coaches: { code: string; cls: ClassCode }[];
}

function at(time: string, nextDay = false): number {
  const [hh, mm] = time.split(":").map(Number);
  return (nextDay ? 1440 : 0) + (hh ?? 0) * 60 + (mm ?? 0);
}

function stop(code: string, name: string, km: number, minutes: number, remote = false): StopSeed {
  return { code, name, km, minutes, remote };
}

function coaches(codes: string): { code: string; cls: ClassCode }[] {
  return codes.split(", ").map((code) => ({ code, cls: code.startsWith("S") ? "SL" : "3A" }));
}

export const TRAINS: TrainSeed[] = [
  {
    number: "12951",
    name: "Kesar Night Mail",
    stops: [
      stop("MMCT", "Mumbai Central", 0, at("17:10")),
      stop("ST", "Surat", 263, at("19:55")),
      stop("BRC", "Vadodara Jn", 392, at("21:20"), true),
      stop("RTM", "Ratlam Jn", 653, at("00:45", true)),
      stop("KOTA", "Kota Jn", 918, at("04:10", true)),
      stop("NDLS", "New Delhi", 1384, at("08:35", true)),
    ],
    coaches: coaches("S1, S2, B1"),
  },
  {
    number: "12627",
    name: "Kaveri Dawn Express",
    stops: [
      stop("SBC", "KSR Bengaluru", 0, at("05:00")),
      stop("BWT", "Bangarapet", 70, at("06:05")),
      stop("KPD", "Katpadi Jn", 229, at("08:10"), true),
      stop("MAS", "Chennai Central", 362, at("10:20")),
    ],
    coaches: coaches("S1, B1"),
  },
  {
    number: "17031",
    name: "Godavari Link",
    stops: [
      stop("HYB", "Hyderabad Deccan", 0, at("05:01")),
      stop("KZJ", "Kazipet Jn", 132, at("07:05")),
      stop("BZA", "Vijayawada Jn", 351, at("10:30"), true),
      stop("RJY", "Rajahmundry", 501, at("13:00")),
      stop("VSKP", "Visakhapatnam", 701, at("16:40")),
    ],
    coaches: coaches("S1, B1"),
  },
  {
    number: "22477",
    name: "Thar Afternoon Express",
    stops: [
      stop("JP", "Jaipur Jn", 0, at("14:00")),
      stop("AII", "Ajmer Jn", 135, at("15:50"), true),
      stop("MJ", "Marwar Jn", 255, at("17:40")),
      stop("JU", "Jodhpur Jn", 326, at("19:05")),
    ],
    coaches: coaches("S1, B1"),
  },
  {
    number: "14231",
    name: "Doab Express",
    stops: [
      stop("LKO", "Lucknow", 0, at("14:01")),
      stop("RBL", "Rae Bareli Jn", 80, at("15:30")),
      stop("PBH", "Pratapgarh Jn", 160, at("17:00"), true),
      stop("BSB", "Varanasi Jn", 301, at("20:05")),
    ],
    coaches: coaches("S1, B1"),
  },
  {
    number: "11025",
    name: "Kumbhar Link",
    stops: [
      stop("PUNE", "Pune Jn", 0, at("21:30")),
      stop("DD", "Daund Jn", 76, at("22:55")),
      stop("MMR", "Manmad Jn", 330, at("03:10", true), true),
      stop("BSL", "Bhusaval Jn", 490, at("05:40", true)),
      stop("NGP", "Nagpur Jn", 890, at("12:20", true)),
    ],
    coaches: coaches("S1, B1"),
  },
  {
    number: "12489",
    name: "Hooghly Midnight Express",
    stops: [
      stop("HWH", "Howrah Jn", 0, at("23:45")),
      stop("BWN", "Barddhaman Jn", 107, at("01:00", true)),
      stop("ASN", "Asansol Jn", 214, at("02:20", true), true),
      stop("JAJ", "Jhajha", 339, at("04:15", true)),
      stop("PNBE", "Patna Jn", 532, at("07:50", true)),
    ],
    coaches: coaches("S1, S2, B1"),
  },
  {
    number: "16341",
    name: "Malabar Morning Express",
    stops: [
      stop("ERS", "Ernakulam Jn", 0, at("09:30")),
      stop("TCR", "Thrissur", 74, at("10:45")),
      stop("SRR", "Shoranur Jn", 107, at("11:35"), true),
      stop("CLT", "Kozhikode", 193, at("13:15")),
      stop("MAQ", "Mangaluru Central", 414, at("17:35")),
    ],
    coaches: coaches("S1, B1"),
  },
];

export const SEEDED_ACCOUNTS = [
  { name: "Meera Iyer", email: "meera.iyer@example.test", password: "chart-paper-01", phone: "+919800000001" },
  { name: "Rohan Bhat", email: "rohan.bhat@example.test", password: "chart-paper-02", phone: "+919800000002" },
];
