import type { Queryable } from './db.js';
import { newId, sha256Hex } from './ids.js';
import type { PersonShape } from '../shared/types.js';

export const THESIS_FILES: Record<string, string> = {
  'main.tex': `\\documentclass[12pt,a4paper]{report}\n\\input{preamble}\n\n\\title{Working Title of the Thesis}\n\\author{Student Name}\n\\date{\\today}\n\n\\begin{document}\n\\maketitle\n\\include{frontmatter/abstract}\n\\include{frontmatter/acknowledgements}\n\\tableofcontents\n\n\\include{chapters/01-introduction}\n\\include{chapters/02-background}\n\\include{chapters/03-method}\n\\include{chapters/04-results}\n\\include{chapters/05-conclusion}\n\n\\bibliographystyle{plainnat}\n\\bibliography{references}\n\\end{document}\n`,
  'preamble.tex': `\\usepackage[utf8]{inputenc}\n\\usepackage[T1]{fontenc}\n\\usepackage{graphicx}\n\\usepackage{svg}\n\\usepackage{amsmath}\n\\usepackage[numbers]{natbib}\n\\usepackage{hyperref}\n\\graphicspath{{figures/}}\n`,
  'chapters/01-introduction.tex': `\\chapter{Introduction}\n\\label{ch:introduction}\n\nState the research question here.\nEarlier work on review in doctoral writing is surveyed in\nChapter~\\ref{ch:background} \\citep{marlow2019margins}.\n`,
  'chapters/02-background.tex': `\\chapter{Background}\n\\label{ch:background}\n\nSummarise the field. Review practice in small groups follows \\citet{ferreira2021review}.\n`,
  'chapters/03-method.tex': `\\chapter{Method}\n\\label{ch:method}\n\nDescribe the method so that another lab could repeat it.\n`,
  'chapters/04-results.tex': `\\chapter{Results}\n\\label{ch:results}\n\n\\begin{figure}[ht]\n  \\centering\n  \\includesvg{placeholder-plot}\n  \\caption{Replace this placeholder plot with your first result.}\n  \\label{fig:placeholder}\n\\end{figure}\n`,
  'chapters/05-conclusion.tex': `\\chapter{Conclusion}\n\\label{ch:conclusion}\n\nRestate the contribution and list open questions.\n% Add \\cite{} keys here only once they exist in references.bib.\n`,
  'frontmatter/abstract.tex': `\\chapter*{Abstract}\n\nSummarise the thesis in no more than 300 words.\n`,
  'frontmatter/acknowledgements.tex': `\\chapter*{Acknowledgements}\n\nThank your supervisor, committee and funders here.\n`,
  'figures/placeholder-plot.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 240">\n  <title>Placeholder plot</title>\n  <circle cx="60" cy="190" r="5"/>\n  <circle cx="120" cy="160" r="5"/>\n  <circle cx="180" cy="170" r="5"/>\n  <circle cx="240" cy="110" r="5"/>\n  <circle cx="300" cy="80" r="5"/>\n  <circle cx="360" cy="50" r="5"/>\n</svg>\n`,
  'references.bib': `@article{marlow2019margins,\n  author  = {Imogen Marlow},\n  title   = {Margins as a Workspace: Annotation in Doctoral Writing},\n  journal = {Journal of Scholarly Practice},\n  year    = {2019},\n  volume  = {12},\n  pages   = {45--67}\n}\n\n@inproceedings{ferreira2021review,\n  author    = {Tomas Ferreira and Wen Li},\n  title     = {Review Rounds in Small Research Groups},\n  booktitle = {Proceedings of the Workshop on Research Writing},\n  year      = {2021},\n  pages     = {1--9}\n}\n\n@book{okafor2017drafts,\n  author    = {Chidinma Okafor},\n  title     = {Drafts, Versions and the Thesis},\n  publisher = {Quillwork Example Press},\n  year      = {2017}\n}\n`,
};

export const ARTICLE_MAIN_TEX = `\\documentclass[11pt]{article}\n\\usepackage{graphicx}\n\n\\title{Untitled Article}\n\\author{}\n\\date{}\n\n\\begin{document}\n\\maketitle\n\n\\section{Introduction}\n\n\\end{document}\n`;

/** Write the template's files and the single created ledger entry at revision 1. */
export async function createProjectFromTemplate(
  sql: Queryable,
  projectId: string,
  template: string,
  actor: PersonShape,
): Promise<void> {
  const files: Record<string, string> =
    template === 'thesis-numbered' ? THESIS_FILES : { 'main.tex': ARTICLE_MAIN_TEX };
  const templateName = template === 'thesis-numbered' ? 'Thesis, numbered chapters' : 'Article, single file';
  for (const [path, content] of Object.entries(files)) {
    const id = newId('f');
    const buf = Buffer.from(content, 'utf8');
    await sql`
      INSERT INTO files (id, project_id, path, kind, revision, size, content_type, sha256)
      VALUES (${id}, ${projectId}, ${path}, 'text', 1, ${buf.length}, 'text/plain', ${sha256Hex(buf)})`;
    await sql`
      INSERT INTO file_versions (file_id, revision, content, sha256)
      VALUES (${id}, 1, ${buf}, ${sha256Hex(buf)})`;
    await sql`
      INSERT INTO project_revisions (project_id, revision, file_id, path, kind, size, sha256)
      VALUES (${projectId}, 1, ${id}, ${path}, 'text', ${buf.length}, ${sha256Hex(buf)})`;
  }
  await sql`
    INSERT INTO ledger_entries (project_id, revision, kind, summary, actor_id, actor_name, actor_handle, at)
    VALUES (${projectId}, 1, 'created', ${'Created from template ' + templateName}, ${actor.id}, ${actor.displayName}, ${actor.handle}, now())`;
}
