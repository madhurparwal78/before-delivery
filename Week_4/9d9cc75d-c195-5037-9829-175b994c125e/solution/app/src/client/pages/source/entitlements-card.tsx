import { useState } from 'react';
import { api, generalErrorCopy } from '../../api/client.ts';
import { act, commit } from '../../api/use-load.ts';
import type { Entitlements } from '../../../shared/model.ts';
import { Button } from '../../ui/button.tsx';
import { Select, TextField } from '../../ui/fields.tsx';
import { TableWrap } from '../../ui/table-wrap.tsx';
import type { CardProps } from './card-props.ts';

const FAILED = 'Something went wrong. Try again.';
const NAME_REQUIRED = 'Name is required.';

/** `table "Entitlements"`: who sees which values of the security field. Only creators change it. */
export function EntitlementsCard({ source, creator, reload, say, warn }: Omit<CardProps, 'project'>) {
  const { entitlements } = source;
  const [security, setSecurity] = useState(entitlements.field ?? '');
  const [username, setUsername] = useState('');
  const [values, setValues] = useState('');
  const [error, setError] = useState<string | null>(null);

  const save = (users: Record<string, string[]>, after: () => void) =>
    act(
      async () => {
        await api.put<Entitlements>(`/api/sources/${source.id}/entitlements`, { field: security || null, users });
        await reload();
        commit(() => {
          setError(null);
          after();
          say('Entitlements saved.');
        });
      },
      (caught) => {
        const message = generalErrorCopy(caught) ?? caught.fieldMessage('username');
        setError(message);
        warn(message ?? FAILED);
      },
    );

  const add = () => {
    if (username.trim() === '') {
      setError(NAME_REQUIRED);
      warn(NAME_REQUIRED);
      return undefined;
    }
    return save(
      { ...entitlements.users, [username.trim()]: values.split(',').map((value) => value.trim()).filter((value) => value !== '') },
      () => {
        setUsername('');
        setValues('');
      },
    );
  };

  const remove = (name: string) => {
    const { [name]: _gone, ...rest } = entitlements.users;
    return save(rest, () => undefined);
  };

  return (
    <section className="card-stack" aria-labelledby="entitlements-heading">
      <h2 id="entitlements-heading">Entitlements</h2>
      <TableWrap>
        <table aria-label="Entitlements">
          <thead>
            <tr>
              <th scope="col">Username</th>
              <th scope="col">Values</th>
              {creator ? (
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {Object.entries(entitlements.users).map(([name, allowed]) => (
              <tr key={name}>
                <th scope="row">{name}</th>
                <td>{allowed.join(', ')}</td>
                {creator ? (
                  <td className="num">
                    <Button compact aria-label={`Remove entitlement for ${name}`} onClick={() => void remove(name)}>
                      Remove
                    </Button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
      {creator ? (
        <form
          className="card form-grid"
          onSubmit={(event) => {
            event.preventDefault();
            void add();
          }}
        >
          <Select
            label="Security field"
            value={security}
            onChange={setSecurity}
            options={[{ value: '', label: 'None' }, ...source.fields.map((field) => ({ value: field.name, label: field.name }))]}
          />
          <TextField label="Entitled username" value={username} onChange={setUsername} error={error} />
          <TextField label="Values" value={values} onChange={setValues} hint="Separate values with commas." />
          <Button type="submit" variant="primary">
            Add entitlement
          </Button>
        </form>
      ) : null}
    </section>
  );
}
