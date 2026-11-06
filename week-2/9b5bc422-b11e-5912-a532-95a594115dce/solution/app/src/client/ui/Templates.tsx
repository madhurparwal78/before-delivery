import { useState } from "react";
import { flushSync } from "react-dom";
import { blockName, typeLabel } from "../domain/blocks.ts";
import type { Template } from "../domain/templates.ts";
import { TEMPLATE_CATEGORIES, TEMPLATES } from "../domain/templates.ts";
import { documentFromTemplate } from "../store/actions.ts";
import { navigate } from "../store/router.ts";
import { Dialog } from "./common.tsx";

function Preview({ template, onClose }: { template: Template; onClose: () => void }) {
  return (
    <Dialog name={template.name} onClose={onClose} wide>
      <div className="template-preview" aria-label={`${template.name} blocks`} role="group">
        {template.blocks.map((block, index) => (
          <p key={index} className={`preview-${block.type}`} aria-label={blockName(typeLabel(block.type), block.text, { notched: false, bothKept: false })} role="group">
            {block.text || " "}
          </p>
        ))}
      </div>
      <div className="dialog-actions">
        <button
          type="button"
          className="button"
          data-first-focus
          onClick={() => {
            const id = documentFromTemplate(template);
            flushSync(onClose);
            navigate(`/doc/${id}`, "title");
          }}
        >
          Use this template
        </button>
        <button type="button" className="button" onClick={onClose}>Close</button>
      </div>
    </Dialog>
  );
}

export function Templates() {
  const [category, setCategory] = useState("All");
  const [preview, setPreview] = useState<Template | null>(null);
  const shown = TEMPLATES.filter((template) => category === "All" || template.category === category);
  return (
    <div className="screen">
      <h1 className="screen-title">Templates</h1>
      <div role="group" aria-label="Template categories" className="chips">
        {TEMPLATE_CATEGORIES.map((chip) => (
          <button key={chip} type="button" className="chip" aria-pressed={chip === category} onClick={() => setCategory(chip)}>{chip}</button>
        ))}
      </div>
      <div className="template-grid">
        {shown.map((template) => (
          <article key={template.name} className="paper template-card">
            <h2>{template.name}</h2>
            <p className="template-category">{template.category}</p>
            <p>{template.description}</p>
            <button type="button" className="button" aria-label={`Preview ${template.name}`} onClick={() => setPreview(template)}>Preview</button>
          </article>
        ))}
      </div>
      {preview && <Preview template={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}
