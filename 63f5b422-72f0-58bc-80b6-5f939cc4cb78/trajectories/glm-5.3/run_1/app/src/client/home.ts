// The workspace list: create workspaces and follow links.
async function homeMain(): Promise<void> {
  const form = document.getElementById('create-workspace') as HTMLFormElement | null;
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = form.querySelector<HTMLInputElement>('#f-ws-name')!;
    const name = input.value.trim();
    if (name.length < 1) return;
    const res = await fetch('/api/workspaces', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (res.ok) {
      const data = await res.json() as { id: string; pages: { id: string }[] };
      location.href = `/w/${data.id}/edit?page=${data.pages[0]?.id ?? ''}`;
    }
  });
}

void homeMain();
