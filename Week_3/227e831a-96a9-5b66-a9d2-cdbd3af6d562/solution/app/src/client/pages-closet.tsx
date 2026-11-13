import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import type { Category, Item, RetireReason } from '../shared/api-types'
import { CATEGORIES, categoryRank } from '../shared/categories'
import { ITEM_EXISTS, itemIdentity } from '../shared/names'
import { detectPhotoType, PHOTO_SIGNATURE_BYTES, PHOTO_TYPE_MESSAGE } from '../shared/photo-type'
import { entryGrams } from '../shared/weights'
import { api, ApiError, NetworkError, weightInput } from './api'
import { cache } from './cache'
import { navigate } from './router'
import { settleWrites } from './writes'
import { Dialog, FieldError, RadioGroup, Status } from './ui'

const EMPTY_COPY = 'Your closet is empty. Add your first piece of gear or import a gear list.'
const LOST_ANSWER = "Couldn't reach Skinout. Your retirement was not confirmed; confirm again."

function sortItems(items: readonly Item[]): Item[] {
  return [...items].sort((a, b) => categoryRank(a.category) - categoryRank(b.category) || a.name.localeCompare(b.name))
}

const PRICE = /^\$?(\d+)(?:\.(\d{1,2}))?$/

/** Dollars typed by the hiker as whole cents, by string arithmetic. */
function centsFromText(text: string): number | null | undefined {
  const trimmed = text.trim()
  if (trimmed === '') return null
  const match = PRICE.exec(trimmed)
  if (!match) return undefined
  return Number.parseInt(`${match[1]}${(match[2] ?? '').padEnd(2, '0')}`, 10)
}

interface GearDialogProps {
  item: Item | null
  /** The closet as last read, so a name the closet already holds is refused before it is sent. */
  closet: readonly Item[]
  onClose: () => void
  onSaved: (item: Item) => void
  onConflict: () => void
  announce: (text: string) => void
}

function GearDialog({ item, closet, onClose, onSaved, onConflict, announce }: GearDialogProps) {
  const [name, setName] = useState(item?.name ?? '')
  const [category, setCategory] = useState<Category>(item?.category ?? 'Shelter')
  const [weight, setWeight] = useState(item ? String(item.weightGrams) : '')
  const [unit, setUnit] = useState<'g' | 'oz'>('g')
  const [units, setUnits] = useState(item ? String(item.unitsOwned) : '1')
  const [price, setPrice] = useState(item?.priceCents == null ? '' : `${Math.floor(item.priceCents / 100)}.${String(item.priceCents % 100).padStart(2, '0')}`)
  const [notes, setNotes] = useState(item?.notes ?? '')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [conflict, setConflict] = useState<string | null>(null)
  const form = useRef<HTMLFormElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (conflict) cancel.current?.focus()
    else if (Object.keys(errors).length > 0) form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
  }, [errors, conflict])

  async function save(event: FormEvent) {
    event.preventDefault()
    const identity = itemIdentity(name, category)
    if (closet.some((other) => other.id !== item?.id && itemIdentity(other.name, other.category) === identity)) {
      setErrors({ name: ITEM_EXISTS })
      announce(ITEM_EXISTS)
      return
    }
    const cents = centsFromText(price)
    const body = {
      name, category, weight: weightInput(weight, unit), unitsOwned: /^\d+$/.test(units) ? Number.parseInt(units, 10) : null,
      priceCents: cents === undefined ? -1 : cents, notes,
    }
    announce('Saving...')
    try {
      const saved = item ? await api.editItem(item.id, item.version, body) : await api.addItem(body)
      announce(`Saved ${saved.name}.`)
      onSaved(saved)
    } catch (error) {
      if (!(error instanceof ApiError)) throw error
      if (error.code === 'item_changed') {
        const copy = `${error.message} Close this form and open it again to see the latest.`
        setConflict(copy)
        announce(copy)
        onConflict()
      } else {
        setErrors(error.code === 'item_exists' ? { name: error.message } : error.fields)
        announce(error.fields.name ?? error.message)
      }
    }
  }

  const storedGrams = unit === 'oz' ? entryGrams(weight.trim(), unit, 0) : null
  const invalid = (field: string) => (errors[field] ? { 'aria-invalid': true as const, 'aria-describedby': `gear-${field}-error` } : {})

  return (
    <Dialog name={item ? `Edit ${item.name}` : 'Add gear'} onClose={onClose}>
      <h2>{item ? 'Edit gear' : 'Add gear'}</h2>
      {conflict && <p className="conflict" role="note">{conflict}</p>}
      <form ref={form} onSubmit={save} className="stack" noValidate>
        <div className="field">
          <label htmlFor="gear-name">Name</label>
          <input id="gear-name" type="text" value={name} {...invalid('name')} onChange={(e) => setName(e.target.value)} />
          <FieldError id="gear-name-error" message={errors.name} />
        </div>
        <div className="field">
          <label htmlFor="gear-category">Category</label>
          <select id="gear-category" value={category} {...invalid('category')} onChange={(e) => setCategory(e.target.value as Category)}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <FieldError id="gear-category-error" message={errors.category} />
        </div>
        <div className="field">
          <label htmlFor="gear-weight">Weight</label>
          <div className="inline">
            <input id="gear-weight" type="number" step="any" min="0" className="weight-input" value={weight} {...invalid('weight')} onChange={(e) => setWeight(e.target.value)} />
            <RadioGroup name="Weight unit" groupName="gear-unit" value={unit} options={[{ value: 'g', label: 'g' }, { value: 'oz', label: 'oz' }]} onChange={setUnit} />
          </div>
          {storedGrams !== null && !errors.weight && <p className="hint">Stored as <span className="figure">{storedGrams} g</span></p>}
          <FieldError id="gear-weight-error" message={errors.weight} />
        </div>
        <div className="field">
          <label htmlFor="gear-units">Units owned</label>
          <input id="gear-units" type="number" step="1" min="1" max="99" className="weight-input" value={units} {...invalid('unitsOwned')} onChange={(e) => setUnits(e.target.value)} />
          <FieldError id="gear-unitsOwned-error" message={errors.unitsOwned} />
        </div>
        <div className="field">
          <label htmlFor="gear-price">Price</label>
          <input id="gear-price" type="text" inputMode="decimal" placeholder="0.00" value={price} {...invalid('priceCents')} onChange={(e) => setPrice(e.target.value)} />
          <FieldError id="gear-priceCents-error" message={errors.priceCents} />
        </div>
        <div className="field">
          <label htmlFor="gear-notes">Private notes</label>
          <textarea id="gear-notes" rows={3} value={notes} {...invalid('notes')} onChange={(e) => setNotes(e.target.value)} />
          <FieldError id="gear-notes-error" message={errors.notes} />
        </div>
        <div className="actions">
          <button type="submit" className="primary">Save gear</button>
          <button type="button" ref={cancel} onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Dialog>
  )
}

const REASONS: readonly { value: RetireReason; label: string }[] = [
  { value: 'sold', label: 'Sold' },
  { value: 'retired', label: 'Retired' },
  { value: 'lost', label: 'Lost' },
]

interface RetireDialogProps {
  item: Item
  onClose: () => void
  onDone: (item: Item, units: number) => void
  announce: (text: string) => void
}

function RetireDialog({ item, onClose, onDone, announce }: RetireDialogProps) {
  const key = useRef(crypto.randomUUID())
  const [units, setUnits] = useState('1')
  const [reason, setReason] = useState<RetireReason>('retired')
  const [message, setMessage] = useState<string | undefined>()
  const confirm = useRef<HTMLButtonElement>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    const count = Number.parseInt(units, 10)
    try {
      const done = await api.retire(item.id, key.current, { units: Number.isNaN(count) ? null : count, reason })
      announce(`Retired ${count} of ${item.name}.`)
      onDone(done.item, count)
    } catch (error) {
      if (error instanceof NetworkError) {
        announce(LOST_ANSWER)
        confirm.current?.focus()
      } else if (error instanceof ApiError && error.code === 'request_in_progress') {
        announce(error.message)
        confirm.current?.focus()
      } else if (error instanceof ApiError && error.status === 409) {
        announce(error.code === 'item_retired' ? `${item.name} is already retired.` : error.message)
        onClose()
      } else if (error instanceof ApiError && error.status === 422 && !error.fields['Idempotency-Key']) {
        setMessage(error.fields.units ?? error.fields.reason ?? error.message)
        announce(error.fields.units ?? error.fields.reason ?? error.message)
      } else if (error instanceof ApiError) {
        announce(error.message)
        onClose()
      } else throw error
    }
  }

  return (
    <Dialog name={`Retire ${item.name}`} onClose={onClose}>
      <h2>Retire gear</h2>
      <form onSubmit={submit} className="stack" noValidate>
        <div className="field">
          <label htmlFor="retire-units">Units</label>
          <input id="retire-units" type="number" step="1" min="1" max={item.unitsOwned} className="weight-input" value={units}
            aria-invalid={message ? true : undefined} aria-describedby={message ? 'retire-units-error' : undefined}
            onChange={(e) => { setUnits(e.target.value); setMessage(undefined) }} />
          <FieldError id="retire-units-error" message={message} />
        </div>
        <div className="field">
          <span className="label">Reason</span>
          <RadioGroup name="Reason" groupName="retire-reason" value={reason} options={REASONS} onChange={setReason} />
        </div>
        <div className="actions">
          <button type="submit" ref={confirm} className="primary">Confirm retire</button>
          <button type="button" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Dialog>
  )
}

function Thumb({ item }: { item: Item }) {
  return item.photo ? <img className="thumb" src={item.photo.url} alt={`Photo of ${item.name}`} width={40} height={40} /> : <span className="thumb empty" aria-hidden="true" />
}

function Rows({ items, retired, actions }: { items: Item[]; retired: boolean; actions: (item: Item) => React.ReactNode }) {
  const groups = CATEGORIES.map((category) => ({ category, items: items.filter((item) => item.category === category) })).filter((g) => g.items.length > 0)
  return (
    <table className="ledger closet-ledger" aria-label={retired ? 'Retired gear' : 'Closet ledger'} role="table">
      <thead role="rowgroup">
        <tr role="row">
          <th role="columnheader" scope="col"><span className="visually-hidden">Photo</span></th>
          <th role="columnheader" scope="col">Gear</th>
          <th role="columnheader" scope="col" className="weight">Weight</th>
          <th role="columnheader" scope="col">Stock</th>
          <th role="columnheader" scope="col"><span className="visually-hidden">Actions</span></th>
        </tr>
      </thead>
      <tbody role="rowgroup">
        {groups.flatMap((group) => [
          <tr key={`g-${group.category}`} role="row" className="group"><th role="columnheader" colSpan={5} scope="colgroup">{group.category}</th></tr>,
          ...group.items.map((item) => (
            <tr key={item.id} role="row" className="entering">
              <td role="cell" className="photo-cell"><Thumb item={item} /></td>
              <td role="cell" className="name-cell"><span className="item-name">{item.name}</span><span className="item-category">{item.category}</span></td>
              <td role="cell" className="weight">{item.weightDisplay}</td>
              <td role="cell" className="stock-cell"><span>Packed in {item.packedInLists} / owned {item.unitsOwned}</span></td>
              <td role="cell" className="row-actions">{actions(item)}</td>
            </tr>
          )),
        ])}
      </tbody>
    </table>
  )
}

export function Closet() {
  const [items, setItems] = useState<Item[] | null>(cache.closet.get())
  const [message, setMessage] = useState('')
  const [dialog, setDialog] = useState<{ kind: 'gear'; item: Item | null } | { kind: 'retire'; item: Item } | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  const photoFor = useRef<Item | null>(null)
  const [afterRetire, setAfterRetire] = useState<{ label: string; retired: boolean } | null>(null)

  async function reload() {
    const loaded = await api.closet()
    cache.closet.set(loaded)
    setItems(loaded)
    return loaded
  }

  useEffect(() => {
    let live = true
    void settleWrites().then(() => api.closet()).then(
      (loaded) => { cache.closet.set(loaded); if (live) setItems(loaded) },
      () => undefined,
    )
    return () => { live = false }
  }, [])

  async function uploadPhoto(file: File, item: Item) {
    if (detectPhotoType(new Uint8Array(await file.slice(0, PHOTO_SIGNATURE_BYTES).arrayBuffer())) === null) {
      setMessage(PHOTO_TYPE_MESSAGE)
      return
    }
    setMessage('Uploading photo...')
    try {
      await api.addPhoto(item.id, file)
      setMessage('Photo ready.')
      await reload()
    } catch (error) {
      if (!(error instanceof ApiError)) throw error
      setMessage(error.code === 'storage_unavailable' ? 'Photo storage is unavailable. The item was saved without a new photo.' : (error.fields.photo ?? error.message))
    }
  }

  async function remove(item: Item, button: HTMLElement) {
    try {
      await api.deleteItem(item.id)
      setMessage(`Deleted ${item.name}.`)
      await reload()
      heading.current?.focus()
    } catch (error) {
      if (!(error instanceof ApiError)) throw error
      if (error.code === 'storage_unavailable') setMessage(`Photo storage is unavailable, so ${item.name} was not deleted.`)
      else setMessage(error.code === 'item_in_lists' ? `${item.name} is on a trip list and can't be deleted. Retire it instead.` : error.message)
      button.focus()
    }
  }

  useLayoutEffect(() => {
    if (!afterRetire || dialog) return
    if (afterRetire.retired) heading.current?.focus()
    else [...document.querySelectorAll<HTMLElement>('button')].find((b) => b.getAttribute('aria-label') === afterRetire.label)?.focus()
    setAfterRetire(null)
  }, [afterRetire, dialog])

  const sorted = sortItems(items ?? [])
  const active = sorted.filter((item) => item.status === 'active')
  const retired = sorted.filter((item) => item.status === 'retired')
  const closeDialog = () => setDialog(null)

  return (
    <main className="page">
      <div className="page-head">
        <h1 ref={heading} tabIndex={-1}>Closet</h1>
        <div className="actions">
          <button type="button" className="primary" onClick={() => setDialog({ kind: 'gear', item: null })}>Add gear</button>
          <button type="button" onClick={() => navigate('/imports', { openImport: true })}>Import gear list</button>
        </div>
      </div>
      <Status name="Closet updates" text={message} />
      <input ref={picker} type="file" accept="image/*" className="visually-hidden" tabIndex={-1} aria-hidden="true"
        onChange={(event) => {
          const file = event.target.files?.[0]
          const item = photoFor.current
          event.target.value = ''
          if (file && item) void uploadPhoto(file, item)
        }} />
      {items === null ? <p className="hint">Loading your closet…</p> : active.length === 0 ? (
        <p className="empty">{EMPTY_COPY}</p>
      ) : (
        <Rows items={active} retired={false} actions={(item) => (
          <>
            <button type="button" aria-label={`Edit ${item.name}`} onClick={() => setDialog({ kind: 'gear', item })}>Edit</button>
            <button type="button" aria-label={`Retire ${item.name}`} onClick={() => setDialog({ kind: 'retire', item })}>Retire</button>
            <button type="button" aria-label={`Add photo for ${item.name}`} onClick={() => { photoFor.current = item; picker.current?.click() }}>Add photo</button>
          </>
        )} />
      )}
      <h2>Retired gear</h2>
      {retired.length === 0 ? <p className="hint">Nothing retired yet.</p> : (
        <Rows items={retired} retired actions={(item) => (
          <button type="button" aria-label={`Delete ${item.name}`} onClick={(event) => void remove(item, event.currentTarget)}>Delete</button>
        )} />
      )}
      {dialog?.kind === 'gear' && (
        <GearDialog item={dialog.item} closet={items ?? []} onClose={closeDialog} announce={setMessage} onConflict={() => void reload()}
          onSaved={() => { void reload(); closeDialog() }} />
      )}
      {dialog?.kind === 'retire' && (
        <RetireDialog item={dialog.item} onClose={closeDialog} announce={setMessage}
          onDone={(updated) => {
            void reload()
            closeDialog()
            setAfterRetire({ label: `Edit ${updated.name}`, retired: updated.status === 'retired' })
          }} />
      )}
    </main>
  )
}
