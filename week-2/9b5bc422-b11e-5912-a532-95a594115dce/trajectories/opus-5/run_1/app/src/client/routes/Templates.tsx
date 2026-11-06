import { useState } from 'react';
import { TEMPLATES, TEMPLATE_CATEGORIES, type Template } from '../../domain/templates.ts';
import { Dialog } from '../components/Dialog.tsx';
import { focusWhenReady } from '../focus.ts';
import { navigate } from '../router.ts';
import { templates } from '../store/actions.ts';

export function Templates() {
  const [category, setCategory] = useState<string>('All');
  const [previewing, setPreviewing] = useState<Template | null>(null);

  const shown = TEMPLATES.filter((template) => category === 'All' || template.category === category);

  const use = (template: Template) => {
    void templates.use(template.id).then((made) => {
      navigate(`/doc/${made.documentId}?view=page&block=${made.blockId}`);
      focusWhenReady('[aria-label="Document title"]');
    });
  };

  return (
    <div className="screen templates-screen">
      <h1 className="display">Templates</h1>
      <div role="group" aria-label="Template categories" className="chip-row">
        {TEMPLATE_CATEGORIES.map((chip) => (
          <button
            key={chip}
            type="button"
            className="button chip"
            aria-pressed={category === chip}
            onClick={() => setCategory(chip)}
          >
            {chip}
          </button>
        ))}
      </div>
      <ul className="template-grid">
        {shown.map((template) => (
          <li key={template.id} className="paper template-card">
            <h2 className="display">{template.name}</h2>
            <p className="template-category">{template.category}</p>
            <p className="template-description">{template.description}</p>
            <button
              type="button"
              className="button"
              aria-label={`Preview ${template.name}`}
              onClick={() => setPreviewing(template)}
            >
              Preview
            </button>
          </li>
        ))}
      </ul>

      {previewing && (
        <Dialog name={previewing.name} onClose={() => setPreviewing(null)} wide>
          <h2 className="display">{previewing.name}</h2>
          <p>{previewing.description}</p>
          <div className="template-preview">
            {previewing.blocks.map((block, index) => (
              <p key={`${block.type}-${index}`} className={`block-${block.type}`}>
                {block.text}
              </p>
            ))}
          </div>
          <div className="dialog-actions">
            <button type="button" className="button" data-autofocus onClick={() => use(previewing)}>
              Use this template
            </button>
            <button type="button" className="button" onClick={() => setPreviewing(null)}>
              Close
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
