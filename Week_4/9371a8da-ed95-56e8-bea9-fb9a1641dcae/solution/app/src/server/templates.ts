// The two published project templates, file for file.
import type { TemplateId } from "../shared/api.ts";

export interface Template {
  id: TemplateId;
  name: string;
  files: Record<string, string>;
}

const thesis: Record<string, string> = {
  "chapters/01-introduction.tex": String.raw`\chapter{Introduction}
\label{ch:introduction}

State the research question here.
Earlier work on review in doctoral writing is surveyed in
Chapter~\ref{ch:background} \citep{marlow2019margins}.
`,
  "chapters/02-background.tex": String.raw`\chapter{Background}
\label{ch:background}

Summarise the field. Review practice in small groups follows \citet{ferreira2021review}.
`,
  "chapters/03-method.tex": String.raw`\chapter{Method}
\label{ch:method}

Describe the method so that another lab could repeat it.
`,
  "chapters/04-results.tex": String.raw`\chapter{Results}
\label{ch:results}

\begin{figure}[ht]
  \centering
  \includesvg{placeholder-plot}
  \caption{Replace this placeholder plot with your first result.}
  \label{fig:placeholder}
\end{figure}
`,
  "chapters/05-conclusion.tex": String.raw`\chapter{Conclusion}
\label{ch:conclusion}

Restate the contribution and list open questions.
% Add \cite{} keys here only once they exist in references.bib.
`,
  "figures/placeholder-plot.svg": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 240">
  <title>Placeholder plot</title>
  <circle cx="60" cy="190" r="5"/>
  <circle cx="120" cy="160" r="5"/>
  <circle cx="180" cy="170" r="5"/>
  <circle cx="240" cy="110" r="5"/>
  <circle cx="300" cy="80" r="5"/>
  <circle cx="360" cy="50" r="5"/>
</svg>
`,
  "frontmatter/abstract.tex": String.raw`\chapter*{Abstract}

Summarise the thesis in no more than 300 words.
`,
  "frontmatter/acknowledgements.tex": String.raw`\chapter*{Acknowledgements}

Thank your supervisor, committee and funders here.
`,
  "main.tex": String.raw`\documentclass[12pt,a4paper]{report}
\input{preamble}

\title{Working Title of the Thesis}
\author{Student Name}
\date{\today}

\begin{document}
\maketitle
\include{frontmatter/abstract}
\include{frontmatter/acknowledgements}
\tableofcontents

\include{chapters/01-introduction}
\include{chapters/02-background}
\include{chapters/03-method}
\include{chapters/04-results}
\include{chapters/05-conclusion}

\bibliographystyle{plainnat}
\bibliography{references}
\end{document}
`,
  "preamble.tex": String.raw`\usepackage[utf8]{inputenc}
\usepackage[T1]{fontenc}
\usepackage{graphicx}
\usepackage{svg}
\usepackage{amsmath}
\usepackage[numbers]{natbib}
\usepackage{hyperref}
\graphicspath{{figures/}}
`,
  "references.bib": `@article{marlow2019margins,
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
`,
};

const article: Record<string, string> = {
  "main.tex": String.raw`\documentclass[11pt]{article}
\usepackage{graphicx}

\title{Untitled Article}
\author{}
\date{}

\begin{document}
\maketitle

\section{Introduction}

\end{document}
`,
};

export const TEMPLATES: readonly Template[] = [
  { id: "thesis-numbered", name: "Thesis, numbered chapters", files: thesis },
  { id: "article-single", name: "Article, single file", files: article },
];

export function templateById(id: string): Template | undefined {
  return TEMPLATES.find((template) => template.id === id);
}
