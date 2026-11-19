export type TemplateId = 'thesis-numbered' | 'article-single';

export interface TemplateFile {
  path: string;
  content: string;
}

export interface Template {
  id: TemplateId;
  name: string;
  files: TemplateFile[];
}

const THESIS_MAIN = `\\documentclass[12pt,a4paper]{report}
\\input{preamble}

\\title{Working Title of the Thesis}
\\author{Student Name}
\\date{\\today}

\\begin{document}
\\maketitle
\\include{frontmatter/abstract}
\\include{frontmatter/acknowledgements}
\\tableofcontents

\\include{chapters/01-introduction}
\\include{chapters/02-background}
\\include{chapters/03-method}
\\include{chapters/04-results}
\\include{chapters/05-conclusion}

\\bibliographystyle{plainnat}
\\bibliography{references}
\\end{document}
`;

const THESIS_PREAMBLE = `\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage{graphicx}
\\usepackage{svg}
\\usepackage{amsmath}
\\usepackage[numbers]{natbib}
\\usepackage{hyperref}
\\graphicspath{{figures/}}
`;

const THESIS_INTRO = `\\chapter{Introduction}
\\label{ch:introduction}

State the research question here.
Earlier work on review in doctoral writing is surveyed in
Chapter~\\ref{ch:background} \\citep{marlow2019margins}.
`;

const THESIS_BACKGROUND = `\\chapter{Background}
\\label{ch:background}

Summarise the field. Review practice in small groups follows \\citet{ferreira2021review}.
`;

const THESIS_METHOD = `\\chapter{Method}
\\label{ch:method}

Describe the method so that another lab could repeat it.
`;

const THESIS_RESULTS = `\\chapter{Results}
\\label{ch:results}

\\begin{figure}[ht]
  \\centering
  \\includesvg{placeholder-plot}
  \\caption{Replace this placeholder plot with your first result.}
  \\label{fig:placeholder}
\\end{figure}
`;

const THESIS_CONCLUSION = `\\chapter{Conclusion}
\\label{ch:conclusion}

Restate the contribution and list open questions.
% Add \\cite{} keys here only once they exist in references.bib.
`;

const THESIS_ABSTRACT = `\\chapter*{Abstract}

Summarise the thesis in no more than 300 words.
`;

const THESIS_ACKNOWLEDGEMENTS = `\\chapter*{Acknowledgements}

Thank your supervisor, committee and funders here.
`;

const THESIS_PLOT = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 240">
  <title>Placeholder plot</title>
  <circle cx="60" cy="190" r="5"/>
  <circle cx="120" cy="160" r="5"/>
  <circle cx="180" cy="170" r="5"/>
  <circle cx="240" cy="110" r="5"/>
  <circle cx="300" cy="80" r="5"/>
  <circle cx="360" cy="50" r="5"/>
</svg>
`;

const THESIS_REFERENCES = `@article{marlow2019margins,
  author  = {Imogen Marlow},
  title   = {Margins as a Workspace: Annotation in Doctoral Writing},
  journal = {Journal of Scholarly Practice},
  year    = {2019},
  volume  = {12},
  pages   = {45--67}
}

@inproceedings{ferreira2021review,
  author    = {Tomas Ferreira and Wen Li},
  title     = {Review Rounds in Small Research Groups},
  booktitle = {Proceedings of the Workshop on Research Writing},
  year      = {2021},
  pages     = {1--9}
}

@book{okafor2017drafts,
  author    = {Chidinma Okafor},
  title     = {Drafts, Versions and the Thesis},
  publisher = {Quillwork Example Press},
  year      = {2017}
}
`;

const ARTICLE_MAIN = `\\documentclass[11pt]{article}
\\usepackage{graphicx}

\\title{Untitled Article}
\\author{}
\\date{}

\\begin{document}
\\maketitle

\\section{Introduction}

\\end{document}
`;

export const templates: Template[] = [
  {
    id: 'thesis-numbered',
    name: 'Thesis, numbered chapters',
    files: [
      { path: 'chapters/01-introduction.tex', content: THESIS_INTRO },
      { path: 'chapters/02-background.tex', content: THESIS_BACKGROUND },
      { path: 'chapters/03-method.tex', content: THESIS_METHOD },
      { path: 'chapters/04-results.tex', content: THESIS_RESULTS },
      { path: 'chapters/05-conclusion.tex', content: THESIS_CONCLUSION },
      { path: 'figures/placeholder-plot.svg', content: THESIS_PLOT },
      { path: 'frontmatter/abstract.tex', content: THESIS_ABSTRACT },
      { path: 'frontmatter/acknowledgements.tex', content: THESIS_ACKNOWLEDGEMENTS },
      { path: 'main.tex', content: THESIS_MAIN },
      { path: 'preamble.tex', content: THESIS_PREAMBLE },
      { path: 'references.bib', content: THESIS_REFERENCES },
    ],
  },
  {
    id: 'article-single',
    name: 'Article, single file',
    files: [{ path: 'main.tex', content: ARTICLE_MAIN }],
  },
];

export function findTemplate(id: string): Template | null {
  return templates.find((template) => template.id === id) ?? null;
}

export const GRANT_MAIN = `\\documentclass[11pt]{article}
\\usepackage{graphicx}

\\title{Shared Margins: Review Infrastructure for Small Labs}
\\author{Ilse Varga}
\\date{}

\\begin{document}
\\maketitle

\\section{Introduction}
Prior pilots are reported in \\cite{varga2024pilot}.

\\bibliographystyle{plain}
\\bibliography{refs}
\\end{document}
`;

export const GRANT_REFS = `@techreport{varga2023pilot,
  author      = {Ilse Varga and Noor Haddad},
  title       = {Pilot Study of Margin Review in Two Labs},
  institution = {Varga Lab},
  year        = {2023}
}
`;
