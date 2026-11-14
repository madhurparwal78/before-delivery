export interface Template {
  id: 'library-loans' | 'greenhouse-beds' | 'recipe-box'
  name: string
  description: string
  keywords: string[]
  text: string
}

export const TEMPLATES: readonly Template[] = [
  {
    id: 'library-loans',
    name: 'Library loans',
    description: 'Shelves, books, members and loans with a loan status choice.',
    keywords: ['library', 'books', 'loans', 'shelves'],
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
    id: 'greenhouse-beds',
    name: 'Greenhouse beds',
    description: 'Beds and sowings grouped together, with a light level choice.',
    keywords: ['garden', 'greenhouse', 'beds', 'plants'],
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
    id: 'recipe-box',
    name: 'Recipe box',
    description: 'Recipes and ingredients joined through a composite key.',
    keywords: ['recipes', 'cooking', 'ingredients', 'food'],
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
]

export function findTemplate(id: string): Template | undefined {
  return TEMPLATES.find((template) => template.id === id)
}

/** A template matches when the trimmed query, ignoring letter case, is part of its name or one of its keywords. */
export function matchTemplates(query: string): Template[] {
  const needle = query.trim().toLowerCase()
  return TEMPLATES.filter(
    (template) => template.name.toLowerCase().includes(needle) || template.keywords.some((keyword) => keyword.toLowerCase().includes(needle)),
  )
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
`

export const HERO_FIRST_LINK = 'link books.shelf_id >- shelves.id'
