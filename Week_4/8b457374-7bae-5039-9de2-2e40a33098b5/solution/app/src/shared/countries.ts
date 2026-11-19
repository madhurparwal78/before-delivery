// The brief's country table (Business rules › Countries and zones), sorted by name for the pickers.

type Region = "europe" | "rest_of_world";

interface Country {
  code: string;
  name: string;
  region: Region;
}

const EUROPE: [string, string][] = [
  ["AT", "Austria"], ["BE", "Belgium"], ["CH", "Switzerland"], ["DE", "Germany"], ["DK", "Denmark"],
  ["ES", "Spain"], ["FI", "Finland"], ["FR", "France"], ["GB", "United Kingdom"], ["IE", "Ireland"],
  ["IT", "Italy"], ["NL", "Netherlands"], ["NO", "Norway"], ["PL", "Poland"], ["PT", "Portugal"], ["SE", "Sweden"],
];

const REST_OF_WORLD: [string, string][] = [
  ["AU", "Australia"], ["BR", "Brazil"], ["CA", "Canada"], ["JP", "Japan"], ["MX", "Mexico"],
  ["NZ", "New Zealand"], ["SG", "Singapore"], ["US", "United States"],
];

export const COUNTRIES: Country[] = [
  ...EUROPE.map(([code, name]): Country => ({ code, name, region: "europe" })),
  ...REST_OF_WORLD.map(([code, name]): Country => ({ code, name, region: "rest_of_world" })),
].sort((a, b) => a.name.localeCompare(b.name, "en"));

export function countryOf(code: unknown): Country | undefined {
  return COUNTRIES.find((c) => c.code === code);
}
