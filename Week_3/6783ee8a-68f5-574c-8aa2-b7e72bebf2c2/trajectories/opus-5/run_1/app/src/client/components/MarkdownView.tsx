import { useMemo } from 'react';
import { filterHtml, renderMarkdown } from '../../shared/markdown.js';

interface MarkdownViewProps {
  source: string;
  notebookId: string;
  cellId: string;
}

function attachmentResolver(notebookId: string, cellId: string): (name: string) => string {
  return (name: string) =>
    `/api/notebooks/${encodeURIComponent(notebookId)}/attachments/${encodeURIComponent(cellId)}/${encodeURIComponent(name)}`;
}

/** A rendered markdown cell: the same filtered result for every role. */
export function MarkdownView({ source, notebookId, cellId }: MarkdownViewProps): JSX.Element {
  const html = useMemo(
    () => renderMarkdown(source, { resolveAttachment: attachmentResolver(notebookId, cellId) }),
    [source, notebookId, cellId],
  );
  return <div className="markdown" dangerouslySetInnerHTML={{ __html: html }} />;
}

/** A `text/markdown` display output, rendered with the markdown rules. */
export function MarkdownOutput({ source }: { source: string }): JSX.Element {
  const html = useMemo(() => renderMarkdown(source), [source]);
  return <div className="markdown" dangerouslySetInnerHTML={{ __html: html }} />;
}

/** A `text/html` display output, filtered by the same allowlist. */
export function HtmlOutput({ html }: { html: string }): JSX.Element {
  const safe = useMemo(() => filterHtml(html), [html]);
  return <div className="markdown" dangerouslySetInnerHTML={{ __html: safe }} />;
}
