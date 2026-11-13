import { ApiFailure, del, get } from '../api';
import type { Prop } from '../../shared/types';
import { editor, say } from './state';

export async function loadProps(): Promise<void> {
  const { props } = await get<{ props: Prop[] }>('/api/props');
  editor.set({ props, propsLoaded: true });
}

interface UploadInput {
  file: File;
  name: string;
  widthMm: number;
  depthMm: number;
  heightMm: number;
}

/** Uploads a glTF file; resolves to the stored prop, or null after the failure copy was announced and nothing was added. */
export async function uploadProp(input: UploadInput): Promise<Prop | null> {
  say(`Uploading ${input.file.name}...`);
  const form = new FormData();
  form.set('file', input.file);
  form.set('name', input.name);
  form.set('widthMm', String(input.widthMm));
  form.set('depthMm', String(input.depthMm));
  form.set('heightMm', String(input.heightMm));
  try {
    const response = await fetch('/api/props', { method: 'POST', body: form, credentials: 'same-origin' });
    if (!response.ok) throw new ApiFailure(response.status, {});
    const { prop } = (await response.json()) as { prop: Prop };
    editor.set((s) => ({ props: [prop, ...s.props] }));
    say(`${prop.name} is in the library.`);
    return prop;
  } catch {
    say('Upload failed. Nothing was added.');
    return null;
  }
}

/** Removes a prop from the library; false when a room still uses it. */
export async function deleteProp(prop: Prop): Promise<boolean> {
  try {
    await del(`/api/props/${prop.id}`);
    editor.set((s) => ({ props: s.props.filter((p) => p.id !== prop.id) }));
    return true;
  } catch (error) {
    if (error instanceof ApiFailure && error.code === 'prop_in_use') return false;
    throw error;
  }
}
