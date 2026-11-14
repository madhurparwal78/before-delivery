export type TemplateId = "library-loans" | "greenhouse-beds" | "recipe-box";

export interface Template {
  id: TemplateId;
  name: string;
  keywords: string[];
  description: string;
  text: string;
}

export const HERO_SAMPLE = `# Library loans and shelves
entity shelves {
  id int [key]
  label varchar(40)
}

entity books {
  id int [key]
  title text
  shelf_id int
}
link books.shelf_id >- shelves.id

entity loans {
  id int [key]
  book_id int
  due date
}
link loans.book_id >- books.id
`;

export const HERO_SAMPLE_START = HERO_SAMPLE.slice(
  0,
  HERO_SAMPLE.indexOf("link books.shelf_id >- shelves.id\n") + "link books.shelf_id >- shelves.id\n".length,
);

export const TEMPLATES: readonly Template[] = [
  {
    id: "library-loans",
    name: "Library loans",
    keywords: ["library", "books", "loans", "shelves"],
    description: "Shelves, books, members and loans with a loan status choice.",
    text: `# Library loans and shelves
choice loan_status { open, returned, overdue }

entity shelves {
  id int [key, auto]
  label varchar(40) [required, unique]
  floor smallint [required, default: 1]
}

entity books {
  id int [key, auto]
  title varchar(200) [required]
  isbn char(13) [unique]
  shelf_id int
}
link books.shelf_id >- shelves.id

entity members {
  id int [key, auto]
  full_name varchar(120) [required]
  joined_on date [required]
}

entity loans {
  id bigint [key, auto]
  book_id int [required]
  member_id int [required]
  status loan_status [required, default: 'open']
  due_on date [required]
  index (book_id, status)
}
link loans.book_id >- books.id
link loans.member_id >- members.id
`,
  },
  {
    id: "greenhouse-beds",
    name: "Greenhouse beds",
    keywords: ["garden", "greenhouse", "beds", "plants"],
    description: "Beds and sowings grouped together, with a light level choice.",
    text: `# Greenhouse beds
choice light_level { shade, partial, full }

entity beds {
  id int [key, auto]
  code varchar(8) [required, unique]
  light light_level [required, default: 'full']
}

entity sowings {
  id int [key, auto]
  bed_id int [required]
  crop varchar(60) [required]
  sown_on date [required]
}
link sowings.bed_id >- beds.id

group "Growing" { beds, sowings }
`,
  },
  {
    id: "recipe-box",
    name: "Recipe box",
    keywords: ["recipes", "cooking", "ingredients", "food"],
    description: "Recipes and ingredients joined through a composite key.",
    text: `# Recipe box
entity recipes {
  id int [key, auto]
  title varchar(120) [required]
  serves smallint [default: 2]
}

entity ingredients {
  id int [key, auto]
  name varchar(80) [required, unique]
}

entity recipe_ingredients {
  recipe_id int [key]
  ingredient_id int [key]
  amount decimal(6,2) [required]
  unit varchar(12)
}
link recipe_ingredients.recipe_id >- recipes.id [delete: cascade]
link recipe_ingredients.ingredient_id >- ingredients.id
`,
  },
];

export function isTemplateId(value: unknown): value is TemplateId {
  return TEMPLATES.some((t) => t.id === value);
}

export function matchTemplates(query: string): Template[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...TEMPLATES];
  return TEMPLATES.filter((t) => t.name.toLowerCase().includes(q) || t.keywords.some((k) => k.includes(q)));
}
