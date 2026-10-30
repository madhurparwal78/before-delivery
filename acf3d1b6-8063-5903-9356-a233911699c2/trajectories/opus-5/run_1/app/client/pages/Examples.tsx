import { useState } from 'preact/hooks';
import { PublicLayout } from '../components/Chrome';
import { TabPanel, TabRow, useToast } from '../components/ui';
import { CopySheets, MagnifyingGlass } from '../components/Icons';
import { EXAMPLE_TABS, filterExamples } from '../../shared/catalog';

export function Examples() {
  const [category, setCategory] = useState('all');
  const [search, setSearch] = useState('');
  const toast = useToast();

  const shown = filterExamples(category, search);

  const copy = async (prompt: string) => {
    try {
      await navigator.clipboard.writeText(prompt);
    } catch {
      const holder = document.createElement('textarea');
      holder.value = prompt;
      document.body.appendChild(holder);
      holder.select();
      document.execCommand('copy');
      holder.remove();
    }
    toast('Prompt copied');
  };

  return (
    <PublicLayout>
      <section class="shell section">
        <h1>Explore all examples</h1>
        <p class="lead">Eight prompts our team keeps coming back to. Copy one, or open it straight in the studio.</p>

        <div style="margin:26px 0 18px">
          <TabRow
            label="Example categories"
            idPrefix="examples"
            tabs={EXAMPLE_TABS.map((tab) => ({ id: tab.id, label: tab.label }))}
            value={category}
            onChange={setCategory}
          />
        </div>

        <div class="field" style="max-width:420px">
          <label for="field-search">Search examples</label>
          <div style="position:relative">
            <input
              class="input"
              id="field-search"
              name="search"
              type="search"
              value={search}
              style="padding-left:40px"
              onInput={(event) => setSearch((event.target as HTMLInputElement).value)}
            />
            <span style="position:absolute;left:13px;top:50%;transform:translateY(-50%);color:var(--muted)">
              <MagnifyingGlass />
            </span>
          </div>
        </div>

        <p class="muted mono">{shown.length} examples</p>

        <TabPanel idPrefix="examples" id={category}>
          {shown.length === 0 ? (
            <div class="empty-state">
              <p style="margin:0">No examples match {search.trim()}.</p>
            </div>
          ) : (
            <div class="card-grid card-grid-2">
              {shown.map((example) => (
                <article class="card lift" key={example.heading}>
                  <h2 style="font-size:1.15rem">{example.heading}</h2>
                  <p>{example.prompt}</p>
                  <div class="chip-group">
                    <a class="btn btn-dark" href={`/studio?prompt=${encodeURIComponent(example.prompt)}`}>
                      Try in Studio
                    </a>
                    <button type="button" class="btn btn-light" onClick={() => void copy(example.prompt)}>
                      <CopySheets />
                      Copy prompt
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </TabPanel>
      </section>
    </PublicLayout>
  );
}
