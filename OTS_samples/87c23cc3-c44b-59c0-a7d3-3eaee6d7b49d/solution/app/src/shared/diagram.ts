import { CARDINALITY_WORDS } from './domain.ts'
import { typeToString, type Column, type ColumnRef, type Entity, type Link, type Model } from './mortise.ts'

export type KeyMarker = 'primary' | 'unique' | 'foreign'

export function foreignColumn(link: Link): ColumnRef | null {
  if (link.token === '>-' || link.token === '--') return link.from
  if (link.token === '-<') return link.to
  return null
}

function entityLinkCount(model: Model, entity: string): number {
  return model.links.filter((link) => link.from.entity === entity || link.to.entity === entity).length
}

export function entityLabel(model: Model, entity: Entity): string {
  const columns = entity.columns.length
  const links = entityLinkCount(model, entity.name)
  return `Entity ${entity.name}, ${columns} ${columns === 1 ? 'column' : 'columns'}, ${links} ${links === 1 ? 'link' : 'links'}`
}

export function columnMarkers(model: Model, entity: Entity, column: Column): KeyMarker[] {
  const markers: KeyMarker[] = []
  if (column.key) markers.push('primary')
  if (column.unique || entity.indexes.some((index) => index.unique && index.columns.includes(column.name))) markers.push('unique')
  const foreign = model.links.some((link) => {
    const side = foreignColumn(link)
    return side !== null && side.entity === entity.name && side.column === column.name
  })
  if (foreign) markers.push('foreign')
  return markers
}

export function columnLabel(column: Column, markers: KeyMarker[]): string {
  let label = `${column.name} ${typeToString(column.type)}`
  if (markers.includes('primary')) label += ', primary key'
  if (markers.includes('unique')) label += ', unique'
  if (markers.includes('foreign')) label += ', foreign key'
  if (column.required && !column.key) label += ', required'
  return label
}

export function linkKey(link: Link): string {
  return `${link.from.entity}.${link.from.column}->${link.to.entity}.${link.to.column}`
}

export function outlineItems(model: Model): string[] {
  return model.order.map((ref) => {
    if (ref.kind === 'choice') {
      const choice = model.choices[ref.index] as Model['choices'][number]
      return `Choice ${choice.name}: ${choice.values.join(', ')}`
    }
    if (ref.kind === 'entity') return entityLabel(model, model.entities[ref.index] as Entity)
    if (ref.kind === 'link') {
      const link = model.links[ref.index] as Link
      return `Link ${link.from.entity}.${link.from.column} to ${link.to.entity}.${link.to.column}, ${CARDINALITY_WORDS[link.cardinality]}`
    }
    const group = model.groups[ref.index] as Model['groups'][number]
    return `Group ${group.name}: ${group.entities.join(', ')}`
  })
}

export function groupOf(model: Model, entity: string): string | null {
  return model.groups.find((group) => group.entities.includes(entity))?.name ?? null
}
