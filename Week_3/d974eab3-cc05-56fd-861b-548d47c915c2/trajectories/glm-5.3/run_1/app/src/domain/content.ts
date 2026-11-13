export interface Pack {
  sticks: number;
  price_yen: number;
}

export interface Ingredient {
  name: string;
  mg: number;
}

export interface Store {
  name: string;
  url: string;
}

export interface Product {
  name: string;
  format: string;
  serving: string;
  packs: Pack[];
  ingredients: Ingredient[];
  how_to_use: string[];
  storage: string;
  cautions: string[];
  stores: Store[];
}

export interface InterviewAnswer {
  question: string;
  answer: string;
}

export interface Interview {
  slug: string;
  name: string;
  role: string;
  category: 'expert' | 'everyday';
  lede: string;
  hue: number;
  answers: InterviewAnswer[];
}

export interface Scenario {
  id: string;
  mode: 'on' | 'off';
  name: string;
  title: string;
  time: string;
  copy: string;
  moment: string;
}

export interface ContentRecord {
  edition: number;
  product: Product;
  interviews: Interview[];
  scenarios: Scenario[];
}
