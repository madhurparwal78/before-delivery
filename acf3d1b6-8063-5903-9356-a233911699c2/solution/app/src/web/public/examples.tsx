import { useState } from 'preact/hooks';
import { EXAMPLE_CATEGORIES, findExamples } from '../../shared/catalog.js';
import { PENDING_PROMPT } from '../api.js';
import { Copy, Search } from '../ui/icons.js';
import { TabPanel, Tabs } from '../ui/tabs.js';
import { useToast } from '../ui/toast.js';

const TABS = ['All', ...EXAMPLE_CATEGORIES.map((category) => category.label)];

export function ExamplesPage() {
  const [tab, setTab] = useState(0);
  const [search, setSearch] = useState('');
  const toast = useToast();
  const category = tab ? EXAMPLE_CATEGORIES[tab - 1].id : undefined;
  const examples = findExamples(category, search);

  const copy = async (prompt: string) => {
    await navigator.clipboard.writeText(prompt);
    toast('Prompt copied', 'success');
  };

  return (
    <section class="page-hero container">
      <h1 class="display">Explore all examples</h1>
      <div class="examples-controls">
        <Tabs id="examples" label="Example categories" tabs={TABS} selected={tab} onSelect={setTab} class="tablist-scroll" />
        <div class="search">
          <Search class="search-icon" />
          <label for="examples-search" class="sr-only">Search examples</label>
          <input
            id="examples-search"
            class="input search-input"
            type="search"
            placeholder="Search examples"
            value={search}
            onInput={(event) => setSearch((event.currentTarget as HTMLInputElement).value)}
          />
        </div>
      </div>
      <TabPanel id="examples" selected={tab}>
        <p class="count" aria-live="polite">
          {examples.length} examples
        </p>
        {examples.length === 0 && <p class="empty-line">No examples match {search.trim()}.</p>}
        <div class="grid-2 examples">
          {examples.map((example) => (
            <article key={example.heading} class="card example-card">
              <h2 class="title">{example.heading}</h2>
              <p class="example-prompt">{example.prompt}</p>
              <div class="button-row">
                <a
                  class="button button-dark"
                  href="/studio"
                  onClick={() => sessionStorage.setItem(PENDING_PROMPT, example.prompt)}
                >
                  Try in Studio
                </a>
                <button type="button" class="button button-light" onClick={() => copy(example.prompt)}>
                  <Copy size={16} /> Copy prompt
                </button>
              </div>
            </article>
          ))}
        </div>
      </TabPanel>
    </section>
  );
}
