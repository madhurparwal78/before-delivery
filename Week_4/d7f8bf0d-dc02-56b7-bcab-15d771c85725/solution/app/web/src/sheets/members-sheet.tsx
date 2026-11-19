import { useState, type ChangeEvent, type FormEvent } from 'react'
import { act, closeSheet, workspacePath } from '../actions'
import { apiGet, apiWrite } from '../api'
import { COPY } from '../copy'
import { canManage, useSelector } from '../state'
import { Button, EmptyState, Sheet, SelectField, TextField } from '../ui/primitives'
import { Skeleton } from './skeleton'
import { useLoad } from './use-load'
import type { MemberRow, Role } from '../../../shared/domain'

const ROLE_LABELS: Record<Role, string> = { founder: 'Founder', manager: 'Manager', member: 'Member', operator: 'Operator' }
const ROLE_OPTIONS = [{ value: 'manager', label: 'Manager' }, { value: 'member', label: 'Member' }, { value: 'operator', label: 'Operator' }]

const blank = { display_name: '', email: '', password: '', role: 'member' }

export function MembersSheet() {
  const role = useSelector(s => s.role)
  const { data, reload } = useLoad(() => apiGet<{ members: MemberRow[] }>(`${workspacePath()}/members`), [])
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(blank)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const field = (name: keyof typeof blank) => ({
    value: form[name],
    onChange: (event: ChangeEvent<HTMLInputElement & HTMLSelectElement>) => setForm(current => ({ ...current, [name]: event.target.value })),
    error: errors[name],
  })

  async function save(event: FormEvent): Promise<void> {
    event.preventDefault()
    const done = await act({
      pending: COPY.addingMember,
      run: () => apiWrite('POST', `${workspacePath()}/members`, form),
      success: () => COPY.memberAdded,
      inline: true,
    })
    if (done.ok) {
      setForm(blank)
      setErrors({})
      setOpen(false)
      reload()
    } else if (done.error.code === 'member_exists') {
      setErrors({ email: done.error.message })
    } else {
      setErrors(done.error.fields)
    }
  }

  return (
    <Sheet title="Members" testId="sheet-members" onClose={closeSheet}>
      {canManage(role) ? (
        <div className="sheet-actions">
          <Button onClick={() => setOpen(true)}>Add member</Button>
        </div>
      ) : null}
      {open ? (
        <form className="inline-form" onSubmit={event => void save(event)}>
          <TextField label="Display name" {...field('display_name')} />
          <TextField label="Email" type="email" {...field('email')} />
          <TextField label="Password" type="password" autoComplete="new-password" {...field('password')} />
          <SelectField label="Role" options={ROLE_OPTIONS} {...field('role')} />
          <div className="modal-actions">
            <Button className="btn-ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit">Save member</Button>
          </div>
        </form>
      ) : null}
      {data === null ? <Skeleton /> : data.members.length === 0 ? <EmptyState /> : (
        <ul className="rows">
          {data.members.map(member => (
            <li key={member.user_id} className="row" data-testid={`member-row-${member.user_id}`}>
              <div className="row-main">
                <span className="row-title">{member.display_name}</span>
                <span className="row-meta">{member.email}</span>
              </div>
              <div className="row-actions"><span className="state-word">{ROLE_LABELS[member.role]}</span></div>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  )
}
