
### Tool call: browser_resize
- Args
```json
{
  "width": 1280,
  "height": 800
}
```
- Result
```json
{
  "page": "- Page URL: about:blank"
}
```

### Tool call: browser_navigate
- Args
```json
{
  "url": "http://127.0.0.1:4173/signin"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/signin\n- Page Title: Marginalia\n- Console: 2 errors, 0 warnings",
  "snapshot": "- generic [ref=e4]:\n  - heading \"Sign in to Marginalia\" [level=1] [ref=e5]\n  - generic [ref=e6]:\n    - generic [ref=e7]:\n      - generic [ref=e8]: Email\n      - textbox \"Email\" [ref=e9]\n    - generic [ref=e10]:\n      - generic [ref=e11]: Password\n      - textbox \"Password\" [ref=e12]\n    - button \"Sign in\" [ref=e13] [cursor=pointer]",
  "events": "- New console entries: evidence/reduced/console-2026-11-11T14-45-22-359Z.log#L1-L2"
}
```

### Tool call: browser_snapshot
- Args
```json
{
  "depth": 3
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/signin\n- Page Title: Marginalia\n- Console: 2 errors, 0 warnings",
  "inlineSnapshot": "- generic [ref=e4]:\n  - heading \"Sign in to Marginalia\" [level=1] [ref=e5]\n  - generic [ref=e6]:\n    - generic [ref=e7]:\n      - generic [ref=e8]: Email\n      - textbox \"Email\" [ref=e9]\n    - generic [ref=e10]:\n      - generic [ref=e11]: Password\n      - textbox \"Password\" [ref=e12]\n    - button \"Sign in\" [ref=e13] [cursor=pointer]"
}
```

### Tool call: browser_fill_form
- Args
```json
{
  "fields": [
    {
      "target": "e9",
      "name": "Email",
      "type": "textbox",
      "value": "ilse.varga@varga-lab.test"
    },
    {
      "target": "e12",
      "name": "Password",
      "type": "textbox",
      "value": "quill-owner-2026"
    }
  ]
}
```
- Result
```json
{}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Sign in",
  "target": "e13"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/\n- Page Title: Marginalia\n- Console: 2 errors, 0 warnings",
  "snapshot": "- generic [ref=e14]:\n  - generic [ref=e16]:\n    - button \"Ilse Varga\" [ref=e17] [cursor=pointer]\n    - button \"Sign out\" [ref=e18] [cursor=pointer]\n  - heading \"Projects\" [level=1] [ref=e19]\n  - generic [ref=e21]:\n    - generic [ref=e22]:\n      - link \"Annotation Practice in Multilingual Labs\" [ref=e23] [cursor=pointer]:\n        - /url: /p/p_8ceb10d2e44073813a2497f1?file=main.tex\n      - generic [ref=e24]: owner\n      - generic [ref=e25]: r1\n    - generic [ref=e26]:\n      - 'link \"Grant Proposal: Shared Margins\" [ref=e27] [cursor=pointer]':\n        - /url: /p/p_15b66bd5aa05e286d7d88900?file=main.tex\n      - generic [ref=e28]: owner\n      - generic [ref=e29]: r3\n    - generic [ref=e30]:\n      - link \"Run481729\" [ref=e31] [cursor=pointer]:\n        - /url: /p/p_a559d3dcd8e66821dadbf312?file=main.tex\n      - generic [ref=e32]: owner\n      - generic [ref=e33]: r1\n    - generic [ref=e34]:\n      - link \"Share937154\" [ref=e35] [cursor=pointer]:\n        - /url: /p/p_d93f001bb37a17132e6fac8e?file=main.tex\n      - generic [ref=e36]: owner\n      - generic [ref=e37]: r1\n  - button \"New project\" [ref=e38] [cursor=pointer]\n  - status [ref=e39]"
}
```

### Tool call: browser_snapshot
- Args
```json
{
  "depth": 2
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/\n- Page Title: Marginalia\n- Console: 2 errors, 0 warnings",
  "inlineSnapshot": "- generic [ref=e14]:\n  - generic [ref=e16]:\n    - button \"Ilse Varga\" [ref=e17] [cursor=pointer]\n    - button \"Sign out\" [ref=e18] [cursor=pointer]\n  - heading \"Projects\" [level=1] [ref=e19]\n  - generic [ref=e21]:\n    - generic [ref=e22]\n    - generic [ref=e26]\n    - generic [ref=e30]\n    - generic [ref=e34]\n  - button \"New project\" [ref=e38] [cursor=pointer]\n  - status [ref=e39]"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "New project",
  "target": "e38"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/\n- Page Title: Marginalia\n- Console: 2 errors, 0 warnings",
  "snapshot": "- generic [ref=e40]:\n  - generic [ref=e42]:\n    - button \"Ilse Varga\" [ref=e43] [cursor=pointer]\n    - button \"Sign out\" [ref=e44] [cursor=pointer]\n  - heading \"Projects\" [level=1] [ref=e45]\n  - generic [ref=e47]:\n    - generic [ref=e48]:\n      - link \"Annotation Practice in Multilingual Labs\" [ref=e49] [cursor=pointer]:\n        - /url: /p/p_8ceb10d2e44073813a2497f1?file=main.tex\n      - generic [ref=e50]: owner\n      - generic [ref=e51]: r1\n    - generic [ref=e52]:\n      - 'link \"Grant Proposal: Shared Margins\" [ref=e53] [cursor=pointer]':\n        - /url: /p/p_15b66bd5aa05e286d7d88900?file=main.tex\n      - generic [ref=e54]: owner\n      - generic [ref=e55]: r3\n    - generic [ref=e56]:\n      - link \"Run481729\" [ref=e57] [cursor=pointer]:\n        - /url: /p/p_a559d3dcd8e66821dadbf312?file=main.tex\n      - generic [ref=e58]: owner\n      - generic [ref=e59]: r1\n    - generic [ref=e60]:\n      - link \"Share937154\" [ref=e61] [cursor=pointer]:\n        - /url: /p/p_d93f001bb37a17132e6fac8e?file=main.tex\n      - generic [ref=e62]: owner\n      - generic [ref=e63]: r1\n  - button \"New project\" [ref=e64] [cursor=pointer]\n  - dialog [ref=e66]:\n    - heading \"New project\" [level=2] [ref=e68]\n    - generic [ref=e69]:\n      - generic [ref=e70]:\n        - generic [ref=e71]: Title\n        - textbox \"Title\" [active] [ref=e72]\n      - radiogroup \"Template\" [ref=e73]:\n        - generic [ref=e74]:\n          - radio \"Thesis, numbered chapters\" [checked] [ref=e75]\n          - text: Thesis, numbered chapters\n        - generic [ref=e76]:\n          - radio \"Article, single file\" [ref=e77]\n          - text: Article, single file\n      - button \"Create project\" [ref=e79] [cursor=pointer]\n  - status [ref=e80]"
}
```

### Tool call: browser_snapshot
- Args
```json
{
  "depth": 4
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/\n- Page Title: Marginalia\n- Console: 2 errors, 0 warnings",
  "inlineSnapshot": "- generic [ref=e40]:\n  - generic [ref=e42]:\n    - button \"Ilse Varga\" [ref=e43] [cursor=pointer]\n    - button \"Sign out\" [ref=e44] [cursor=pointer]\n  - heading \"Projects\" [level=1] [ref=e45]\n  - generic [ref=e47]:\n    - generic [ref=e48]:\n      - link \"Annotation Practice in Multilingual Labs\" [ref=e49] [cursor=pointer]:\n        - /url: /p/p_8ceb10d2e44073813a2497f1?file=main.tex\n      - generic [ref=e50]: owner\n      - generic [ref=e51]: r1\n    - generic [ref=e52]:\n      - 'link \"Grant Proposal: Shared Margins\" [ref=e53] [cursor=pointer]':\n        - /url: /p/p_15b66bd5aa05e286d7d88900?file=main.tex\n      - generic [ref=e54]: owner\n      - generic [ref=e55]: r3\n    - generic [ref=e56]:\n      - link \"Run481729\" [ref=e57] [cursor=pointer]:\n        - /url: /p/p_a559d3dcd8e66821dadbf312?file=main.tex\n      - generic [ref=e58]: owner\n      - generic [ref=e59]: r1\n    - generic [ref=e60]:\n      - link \"Share937154\" [ref=e61] [cursor=pointer]:\n        - /url: /p/p_d93f001bb37a17132e6fac8e?file=main.tex\n      - generic [ref=e62]: owner\n      - generic [ref=e63]: r1\n  - button \"New project\" [ref=e64] [cursor=pointer]\n  - dialog \"New project\" [ref=e66]:\n    - heading \"New project\" [level=2] [ref=e68]\n    - generic [ref=e69]:\n      - generic [ref=e70]:\n        - generic [ref=e71]: Title\n        - textbox \"Title\" [active] [ref=e72]\n      - radiogroup \"Template\" [ref=e73]:\n        - generic [ref=e74]\n        - generic [ref=e76]\n      - button \"Create project\" [ref=e79] [cursor=pointer]\n  - status [ref=e80]"
}
```

### Tool call: browser_fill_form
- Args
```json
{
  "fields": [
    {
      "target": "e72",
      "name": "Title",
      "type": "textbox",
      "value": "Stub628405"
    }
  ]
}
```
- Result
```json
{}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Create project",
  "target": "e79"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/p/p_f6b1c704a294b3bafa18029b?file=main.tex\n- Page Title: Marginalia\n- Console: 2 errors, 0 warnings",
  "snapshot": "- generic [ref=e81]:\n  - link \"Skip to source\" [ref=e82] [cursor=pointer]:\n    - /url: \"#source-box\"\n  - generic [ref=e83]:\n    - link \"Projects\" [ref=e84] [cursor=pointer]:\n      - /url: /\n    - generic [ref=e85]: Stub628405\n    - button \"Save\" [ref=e86] [cursor=pointer]\n    - button \"Suggest edit\" [ref=e87] [cursor=pointer]\n    - button \"Comment\" [disabled] [ref=e88]\n    - button \"New file\" [ref=e89] [cursor=pointer]\n    - button \"Upload file\" [ref=e90] [cursor=pointer]\n    - button \"Citation warnings\" [ref=e91] [cursor=pointer]\n    - generic [ref=e92]: No undefined citations\n    - button \"History\" [ref=e93] [cursor=pointer]\n    - button \"People and sharing\" [ref=e94] [cursor=pointer]\n    - button \"Submission check\" [ref=e95] [cursor=pointer]\n  - generic [ref=e96]:\n    - complementary [ref=e97]:\n      - tree \"Project files\" [ref=e98]:\n        - group \"chapters\" [ref=e99]:\n          - treeitem \"▾ chapters/\" [expanded] [ref=e100]\n          - treeitem \"01-introduction.tex\" [ref=e101]\n          - treeitem \"02-background.tex\" [ref=e102]\n          - treeitem \"03-method.tex\" [ref=e103]\n          - treeitem \"04-results.tex\" [ref=e104]\n          - treeitem \"05-conclusion.tex\" [ref=e105]\n        - group \"figures\" [ref=e106]:\n          - treeitem \"▾ figures/\" [expanded] [ref=e107]\n          - treeitem \"placeholder-plot.svg\" [ref=e108]\n        - group \"frontmatter\" [ref=e109]:\n          - treeitem \"▾ frontmatter/\" [expanded] [ref=e110]\n          - treeitem \"abstract.tex\" [ref=e111]\n          - treeitem \"acknowledgements.tex\" [ref=e112]\n        - treeitem \"main.tex\" [selected] [ref=e113]\n        - treeitem \"preamble.tex\" [ref=e114]\n        - treeitem \"references.bib\" [ref=e115]\n      - navigation \"Sections\":\n        - list \"Sections\"\n    - generic [ref=e117]:\n      - generic [ref=e118]:\n        - generic [ref=e119]: main.tex\n        - button \"Delete main.tex\" [ref=e120] [cursor=pointer]\n      - generic [ref=e122]:\n        - generic [aria-hidden] [ref=e123]:\n          - generic [ref=e124]: \"1\"\n          - generic [ref=e125]: \"2\"\n          - generic [ref=e126]: \"3\"\n          - generic [ref=e127]: \"4\"\n          - generic [ref=e128]: \"5\"\n          - generic [ref=e129]: \"6\"\n          - generic [ref=e130]: \"7\"\n          - generic [ref=e131]: \"8\"\n          - generic [ref=e132]: \"9\"\n          - generic [ref=e133]: \"10\"\n          - generic [ref=e134]: \"11\"\n          - generic [ref=e135]: \"12\"\n          - generic [ref=e136]: \"13\"\n          - generic [ref=e137]: \"14\"\n          - generic [ref=e138]: \"15\"\n          - generic [ref=e139]: \"16\"\n          - generic [ref=e140]: \"17\"\n          - generic [ref=e141]: \"18\"\n          - generic [ref=e142]: \"19\"\n          - generic [ref=e143]: \"20\"\n          - generic [ref=e144]: \"21\"\n          - generic [ref=e145]: \"22\"\n          - generic [ref=e146]: \"23\"\n        - textbox \"Source of main.tex\" [active] [ref=e147]: \"\\\\documentclass[12pt,a4paper]{report} \\\\input{preamble} \\\\title{Working Title of the Thesis} \\\\author{Student Name} \\\\date{\\\\today} \\\\begin{document} \\\\maketitle \\\\include{frontmatter/abstract} \\\\include{frontmatter/acknowledgements} \\\\tableofcontents \\\\include{chapters/01-introduction} \\\\include{chapters/02-background} \\\\include{chapters/03-method} \\\\include{chapters/04-results} \\\\include{chapters/05-conclusion} \\\\bibliographystyle{plainnat} \\\\bibliography{references} \\\\end{document}\"\n    - complementary \"Margin\" [ref=e148]\n  - generic [ref=e149]:\n    - status\n    - status"
}
```

### Tool call: browser_snapshot
- Args
```json
{
  "depth": 5
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/p/p_f6b1c704a294b3bafa18029b?file=main.tex\n- Page Title: Marginalia\n- Console: 2 errors, 0 warnings",
  "inlineSnapshot": "- generic [ref=e81]:\n  - link \"Skip to source\" [ref=e82] [cursor=pointer]:\n    - /url: \"#source-box\"\n  - generic [ref=e83]:\n    - link \"Projects\" [ref=e84] [cursor=pointer]:\n      - /url: /\n    - generic [ref=e85]: Stub628405\n    - button \"Save\" [ref=e86] [cursor=pointer]\n    - button \"Suggest edit\" [ref=e87] [cursor=pointer]\n    - button \"Comment\" [disabled] [ref=e88]\n    - button \"New file\" [ref=e89] [cursor=pointer]\n    - button \"Upload file\" [ref=e90] [cursor=pointer]\n    - button \"Citation warnings\" [ref=e91] [cursor=pointer]\n    - generic [ref=e92]: No undefined citations\n    - button \"History\" [ref=e93] [cursor=pointer]\n    - button \"People and sharing\" [ref=e94] [cursor=pointer]\n    - button \"Submission check\" [ref=e95] [cursor=pointer]\n  - generic [ref=e96]:\n    - complementary [ref=e97]:\n      - tree \"Project files\" [ref=e98]:\n        - group \"chapters\" [ref=e99]:\n          - treeitem \"▾ chapters/\" [expanded] [ref=e100]\n          - treeitem \"01-introduction.tex\" [ref=e101]\n          - treeitem \"02-background.tex\" [ref=e102]\n          - treeitem \"03-method.tex\" [ref=e103]\n          - treeitem \"04-results.tex\" [ref=e104]\n          - treeitem \"05-conclusion.tex\" [ref=e105]\n        - group \"figures\" [ref=e106]:\n          - treeitem \"▾ figures/\" [expanded] [ref=e107]\n          - treeitem \"placeholder-plot.svg\" [ref=e108]\n        - group \"frontmatter\" [ref=e109]:\n          - treeitem \"▾ frontmatter/\" [expanded] [ref=e110]\n          - treeitem \"abstract.tex\" [ref=e111]\n          - treeitem \"acknowledgements.tex\" [ref=e112]\n        - treeitem \"main.tex\" [selected] [ref=e113]\n        - treeitem \"preamble.tex\" [ref=e114]\n        - treeitem \"references.bib\" [ref=e115]\n      - navigation \"Sections\":\n        - list \"Sections\"\n    - generic [ref=e117]:\n      - generic [ref=e118]:\n        - generic [ref=e119]: main.tex\n        - button \"Delete main.tex\" [ref=e120] [cursor=pointer]\n      - generic [ref=e122]:\n        - generic [aria-hidden] [ref=e123]:\n          - generic [ref=e124]: \"1\"\n          - generic [ref=e125]: \"2\"\n          - generic [ref=e126]: \"3\"\n          - generic [ref=e127]: \"4\"\n          - generic [ref=e128]: \"5\"\n          - generic [ref=e129]: \"6\"\n          - generic [ref=e130]: \"7\"\n          - generic [ref=e131]: \"8\"\n          - generic [ref=e132]: \"9\"\n          - generic [ref=e133]: \"10\"\n          - generic [ref=e134]: \"11\"\n          - generic [ref=e135]: \"12\"\n          - generic [ref=e136]: \"13\"\n          - generic [ref=e137]: \"14\"\n          - generic [ref=e138]: \"15\"\n          - generic [ref=e139]: \"16\"\n          - generic [ref=e140]: \"17\"\n          - generic [ref=e141]: \"18\"\n          - generic [ref=e142]: \"19\"\n          - generic [ref=e143]: \"20\"\n          - generic [ref=e144]: \"21\"\n          - generic [ref=e145]: \"22\"\n          - generic [ref=e146]: \"23\"\n        - textbox \"Source of main.tex\" [active] [ref=e147]: \"\\\\documentclass[12pt,a4paper]{report} \\\\input{preamble} \\\\title{Working Title of the Thesis} \\\\author{Student Name} \\\\date{\\\\today} \\\\begin{document} \\\\maketitle \\\\include{frontmatter/abstract} \\\\include{frontmatter/acknowledgements} \\\\tableofcontents \\\\include{chapters/01-introduction} \\\\include{chapters/02-background} \\\\include{chapters/03-method} \\\\include{chapters/04-results} \\\\include{chapters/05-conclusion} \\\\bibliographystyle{plainnat} \\\\bibliography{references} \\\\end{document}\"\n    - complementary \"Margin\" [ref=e148]\n  - generic [ref=e149]:\n    - status\n    - status"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "03-method.tex",
  "target": "e103"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/p/p_f6b1c704a294b3bafa18029b?file=chapters%2F03-method.tex\n- Page Title: Marginalia\n- Console: 2 errors, 0 warnings",
  "snapshot": "- generic [ref=e150]:\n  - link \"Skip to source\" [ref=e151] [cursor=pointer]:\n    - /url: \"#source-box\"\n  - generic [ref=e152]:\n    - link \"Projects\" [ref=e153] [cursor=pointer]:\n      - /url: /\n    - generic [ref=e154]: Stub628405\n    - button \"Save\" [ref=e155] [cursor=pointer]\n    - button \"Suggest edit\" [ref=e156] [cursor=pointer]\n    - button \"Comment\" [disabled] [ref=e157]\n    - button \"New file\" [ref=e158] [cursor=pointer]\n    - button \"Upload file\" [ref=e159] [cursor=pointer]\n    - button \"Citation warnings\" [ref=e160] [cursor=pointer]\n    - generic [ref=e161]: No undefined citations\n    - button \"History\" [ref=e162] [cursor=pointer]\n    - button \"People and sharing\" [ref=e163] [cursor=pointer]\n    - button \"Submission check\" [ref=e164] [cursor=pointer]\n  - generic [ref=e165]:\n    - complementary [ref=e166]:\n      - tree \"Project files\" [ref=e167]:\n        - group \"chapters\" [ref=e168]:\n          - treeitem \"▾ chapters/\" [expanded] [ref=e169]\n          - treeitem \"01-introduction.tex\" [ref=e170]\n          - treeitem \"02-background.tex\" [ref=e171]\n          - treeitem \"03-method.tex\" [selected] [ref=e172]\n          - treeitem \"04-results.tex\" [ref=e173]\n          - treeitem \"05-conclusion.tex\" [ref=e174]\n        - group \"figures\" [ref=e175]:\n          - treeitem \"▾ figures/\" [expanded] [ref=e176]\n          - treeitem \"placeholder-plot.svg\" [ref=e177]\n        - group \"frontmatter\" [ref=e178]:\n          - treeitem \"▾ frontmatter/\" [expanded] [ref=e179]\n          - treeitem \"abstract.tex\" [ref=e180]\n          - treeitem \"acknowledgements.tex\" [ref=e181]\n        - treeitem \"main.tex\" [ref=e182]\n        - treeitem \"preamble.tex\" [ref=e183]\n        - treeitem \"references.bib\" [ref=e184]\n      - navigation \"Sections\" [ref=e185]:\n        - list \"Sections\" [ref=e186]:\n          - listitem [ref=e187]:\n            - link \"Method\" [ref=e188] [cursor=pointer]:\n              - /url: \"#\"\n    - generic [ref=e190]:\n      - generic [ref=e191]:\n        - generic [ref=e192]: chapters/03-method.tex\n        - button \"Delete chapters/03-method.tex\" [ref=e193] [cursor=pointer]\n      - generic [ref=e195]:\n        - generic [aria-hidden] [ref=e196]:\n          - generic [ref=e197]: \"1\"\n          - generic [ref=e198]: \"2\"\n          - generic [ref=e199]: \"3\"\n          - generic [ref=e200]: \"4\"\n          - generic [ref=e201]: \"5\"\n        - textbox \"Source of chapters/03-method.tex\" [ref=e202]: \"\\\\chapter{Method} \\\\label{ch:method} Describe the method so that another lab could repeat it.\"\n    - complementary \"Margin\" [ref=e203]\n  - generic [ref=e204]:\n    - status\n    - status"
}
```

### Tool call: browser_snapshot
- Args
```json
{
  "depth": 4
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/p/p_f6b1c704a294b3bafa18029b?file=chapters%2F03-method.tex\n- Page Title: Marginalia\n- Console: 2 errors, 0 warnings",
  "inlineSnapshot": "- generic [ref=e150]:\n  - link \"Skip to source\" [ref=e151] [cursor=pointer]:\n    - /url: \"#source-box\"\n  - generic [ref=e152]:\n    - link \"Projects\" [ref=e153] [cursor=pointer]:\n      - /url: /\n    - generic [ref=e154]: Stub628405\n    - button \"Save\" [ref=e155] [cursor=pointer]\n    - button \"Suggest edit\" [ref=e156] [cursor=pointer]\n    - button \"Comment\" [disabled] [ref=e157]\n    - button \"New file\" [ref=e158] [cursor=pointer]\n    - button \"Upload file\" [ref=e159] [cursor=pointer]\n    - button \"Citation warnings\" [ref=e160] [cursor=pointer]\n    - generic [ref=e161]: No undefined citations\n    - button \"History\" [ref=e162] [cursor=pointer]\n    - button \"People and sharing\" [ref=e163] [cursor=pointer]\n    - button \"Submission check\" [ref=e164] [cursor=pointer]\n  - generic [ref=e165]:\n    - complementary [ref=e166]:\n      - tree \"Project files\" [ref=e167]:\n        - group \"chapters\" [ref=e168]\n        - group \"figures\" [ref=e175]\n        - group \"frontmatter\" [ref=e178]\n        - treeitem \"main.tex\" [ref=e182]\n        - treeitem \"preamble.tex\" [ref=e183]\n        - treeitem \"references.bib\" [ref=e184]\n      - navigation \"Sections\" [ref=e185]:\n        - list \"Sections\" [ref=e186]\n    - generic [ref=e190]:\n      - generic [ref=e191]:\n        - generic [ref=e192]: chapters/03-method.tex\n        - button \"Delete chapters/03-method.tex\" [ref=e193] [cursor=pointer]\n      - generic [ref=e195]:\n        - generic [aria-hidden] [ref=e196]\n        - textbox \"Source of chapters/03-method.tex\" [ref=e202]: \"\\\\chapter{Method} \\\\label{ch:method} Describe the method so that another lab could repeat it.\"\n    - complementary \"Margin\" [ref=e203]\n  - generic [ref=e204]:\n    - status\n    - status"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Source textbox",
  "target": "e202"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/p/p_f6b1c704a294b3bafa18029b?file=chapters%2F03-method.tex\n- Page Title: Marginalia\n- Console: 2 errors, 0 warnings",
  "snapshot": "- generic [ref=e150]:\n  - link \"Skip to source\" [ref=e151] [cursor=pointer]:\n    - /url: \"#source-box\"\n  - generic [ref=e152]:\n    - link \"Projects\" [ref=e153] [cursor=pointer]:\n      - /url: /\n    - generic [ref=e154]: Stub628405\n    - button \"Save\" [ref=e155] [cursor=pointer]\n    - button \"Suggest edit\" [ref=e156] [cursor=pointer]\n    - button \"Comment\" [disabled] [ref=e157]\n    - button \"New file\" [ref=e158] [cursor=pointer]\n    - button \"Upload file\" [ref=e159] [cursor=pointer]\n    - button \"Citation warnings\" [ref=e160] [cursor=pointer]\n    - generic [ref=e161]: No undefined citations\n    - button \"History\" [ref=e162] [cursor=pointer]\n    - button \"People and sharing\" [ref=e163] [cursor=pointer]\n    - button \"Submission check\" [ref=e164] [cursor=pointer]\n  - generic [ref=e165]:\n    - complementary [ref=e166]:\n      - tree \"Project files\" [ref=e167]:\n        - group \"chapters\" [ref=e168]:\n          - treeitem \"▾ chapters/\" [expanded] [ref=e169]\n          - treeitem \"01-introduction.tex\" [ref=e170]\n          - treeitem \"02-background.tex\" [ref=e171]\n          - treeitem \"03-method.tex\" [selected] [ref=e172]\n          - treeitem \"04-results.tex\" [ref=e173]\n          - treeitem \"05-conclusion.tex\" [ref=e174]\n        - group \"figures\" [ref=e175]:\n          - treeitem \"▾ figures/\" [expanded] [ref=e176]\n          - treeitem \"placeholder-plot.svg\" [ref=e177]\n        - group \"frontmatter\" [ref=e178]:\n          - treeitem \"▾ frontmatter/\" [expanded] [ref=e179]\n          - treeitem \"abstract.tex\" [ref=e180]\n          - treeitem \"acknowledgements.tex\" [ref=e181]\n        - treeitem \"main.tex\" [ref=e182]\n        - treeitem \"preamble.tex\" [ref=e183]\n        - treeitem \"references.bib\" [ref=e184]\n      - navigation \"Sections\" [ref=e185]:\n        - list \"Sections\" [ref=e186]:\n          - listitem [ref=e187]:\n            - link \"Method\" [ref=e188] [cursor=pointer]:\n              - /url: \"#\"\n    - generic [ref=e190]:\n      - generic [ref=e191]:\n        - generic [ref=e192]: chapters/03-method.tex\n        - button \"Delete chapters/03-method.tex\" [ref=e193] [cursor=pointer]\n      - generic [ref=e195]:\n        - generic [aria-hidden] [ref=e196]:\n          - generic [ref=e197]: \"1\"\n          - generic [ref=e198]: \"2\"\n          - generic [ref=e199]: \"3\"\n          - generic [ref=e200]: \"4\"\n          - generic [ref=e201]: \"5\"\n        - textbox \"Source of chapters/03-method.tex\" [active] [ref=e202]: \"\\\\chapter{Method} \\\\label{ch:method} Describe the method so that another lab could repeat it.\"\n    - complementary \"Margin\" [ref=e203]\n  - generic [ref=e204]:\n    - status\n    - status"
}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "End"
}
```
- Result
```json
{}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "ArrowLeft"
}
```
- Result
```json
{}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "Control+Shift+ArrowLeft"
}
```
- Result
```json
{}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "Control+Shift+ArrowLeft"
}
```
- Result
```json
{}
```

### Tool call: browser_evaluate
- Args
```json
{
  "element": "Source textbox",
  "target": "e202",
  "function": "e=>({start:e.selectionStart,end:e.selectionEnd,text:e.value.slice(e.selectionStart,e.selectionEnd)})"
}
```
- Result
```json
{
  "result": "{\n  \"start\": 8,\n  \"end\": 15,\n  \"text\": \"{Method\"\n}"
}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "Control+End"
}
```
- Result
```json
{}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "ArrowLeft"
}
```
- Result
```json
{}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "Control+Shift+ArrowLeft"
}
```
- Result
```json
{}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "Control+Shift+ArrowLeft"
}
```
- Result
```json
{}
```

### Tool call: browser_evaluate
- Args
```json
{
  "element": "Source textbox",
  "target": "e202",
  "function": "e=>({start:e.selectionStart,end:e.selectionEnd,text:e.value.slice(e.selectionStart,e.selectionEnd)})"
}
```
- Result
```json
{
  "result": "{\n  \"start\": 89,\n  \"end\": 92,\n  \"text\": \"it.\"\n}"
}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "Control+End"
}
```
- Result
```json
{}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "ArrowLeft"
}
```
- Result
```json
{}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "Control+Shift+ArrowLeft"
}
```
- Result
```json
{}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "Control+Shift+ArrowLeft"
}
```
- Result
```json
{}
```

### Tool call: browser_evaluate
- Args
```json
{
  "element": "Source textbox",
  "target": "e202",
  "function": "e=>({start:e.selectionStart,end:e.selectionEnd,text:e.value.slice(e.selectionStart,e.selectionEnd)})"
}
```
- Result
```json
{
  "result": "{\n  \"start\": 89,\n  \"end\": 92,\n  \"text\": \"it.\"\n}"
}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "Control+End"
}
```
- Result
```json
{}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "ArrowLeft"
}
```
- Result
```json
{}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "Shift+ArrowLeft"
}
```
- Result
```json
{}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "Shift+ArrowLeft"
}
```
- Result
```json
{}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "Shift+ArrowLeft"
}
```
- Result
```json
{}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "Shift+ArrowLeft"
}
```
- Result
```json
{}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "Shift+ArrowLeft"
}
```
- Result
```json
{}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "Shift+ArrowLeft"
}
```
- Result
```json
{}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "Shift+ArrowLeft"
}
```
- Result
```json
{}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "Shift+ArrowLeft"
}
```
- Result
```json
{}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "Shift+ArrowLeft"
}
```
- Result
```json
{}
```

### Tool call: browser_evaluate
- Args
```json
{
  "element": "Source textbox",
  "target": "e202",
  "function": "e=>({start:e.selectionStart,end:e.selectionEnd,text:e.value.slice(e.selectionStart,e.selectionEnd)})"
}
```
- Result
```json
{
  "result": "{\n  \"start\": 83,\n  \"end\": 92,\n  \"text\": \"epeat it.\"\n}"
}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "ArrowRight"
}
```
- Result
```json
{}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "ArrowLeft"
}
```
- Result
```json
{}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "Shift+ArrowLeft"
}
```
- Result
```json
{}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "Shift+ArrowLeft"
}
```
- Result
```json
{}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "Shift+ArrowLeft"
}
```
- Result
```json
{}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "Shift+ArrowLeft"
}
```
- Result
```json
{}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "Shift+ArrowLeft"
}
```
- Result
```json
{}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "Shift+ArrowLeft"
}
```
- Result
```json
{}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "Shift+ArrowLeft"
}
```
- Result
```json
{}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "Shift+ArrowLeft"
}
```
- Result
```json
{}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "Shift+ArrowLeft"
}
```
- Result
```json
{}
```

### Tool call: browser_evaluate
- Args
```json
{
  "element": "Source textbox",
  "target": "e202",
  "function": "e=>({start:e.selectionStart,end:e.selectionEnd,text:e.value.slice(e.selectionStart,e.selectionEnd)})"
}
```
- Result
```json
{
  "result": "{\n  \"start\": 82,\n  \"end\": 91,\n  \"text\": \"repeat it\"\n}"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Suggest edit",
  "target": "e156"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/p/p_f6b1c704a294b3bafa18029b?file=chapters%2F03-method.tex\n- Page Title: Marginalia\n- Console: 2 errors, 0 warnings",
  "snapshot": "- generic [ref=e205]:\n  - link \"Skip to source\" [ref=e206] [cursor=pointer]:\n    - /url: \"#source-box\"\n  - generic [ref=e207]:\n    - link \"Projects\" [ref=e208] [cursor=pointer]:\n      - /url: /\n    - generic [ref=e209]: Stub628405\n    - button \"Save\" [ref=e210] [cursor=pointer]\n    - button \"Suggest edit\" [ref=e211] [cursor=pointer]\n    - button \"Comment\" [ref=e212] [cursor=pointer]\n    - button \"New file\" [ref=e213] [cursor=pointer]\n    - button \"Upload file\" [ref=e214] [cursor=pointer]\n    - button \"Citation warnings\" [ref=e215] [cursor=pointer]\n    - generic [ref=e216]: No undefined citations\n    - button \"History\" [ref=e217] [cursor=pointer]\n    - button \"People and sharing\" [ref=e218] [cursor=pointer]\n    - button \"Submission check\" [ref=e219] [cursor=pointer]\n  - generic [ref=e220]:\n    - complementary [ref=e221]:\n      - tree \"Project files\" [ref=e222]:\n        - group \"chapters\" [ref=e223]:\n          - treeitem \"▾ chapters/\" [expanded] [ref=e224]\n          - treeitem \"01-introduction.tex\" [ref=e225]\n          - treeitem \"02-background.tex\" [ref=e226]\n          - treeitem \"03-method.tex\" [selected] [ref=e227]\n          - treeitem \"04-results.tex\" [ref=e228]\n          - treeitem \"05-conclusion.tex\" [ref=e229]\n        - group \"figures\" [ref=e230]:\n          - treeitem \"▾ figures/\" [expanded] [ref=e231]\n          - treeitem \"placeholder-plot.svg\" [ref=e232]\n        - group \"frontmatter\" [ref=e233]:\n          - treeitem \"▾ frontmatter/\" [expanded] [ref=e234]\n          - treeitem \"abstract.tex\" [ref=e235]\n          - treeitem \"acknowledgements.tex\" [ref=e236]\n        - treeitem \"main.tex\" [ref=e237]\n        - treeitem \"preamble.tex\" [ref=e238]\n        - treeitem \"references.bib\" [ref=e239]\n      - navigation \"Sections\" [ref=e240]:\n        - list \"Sections\" [ref=e241]:\n          - listitem [ref=e242]:\n            - link \"Method\" [ref=e243] [cursor=pointer]:\n              - /url: \"#\"\n    - generic [ref=e245]:\n      - generic [ref=e246]:\n        - generic [ref=e247]: chapters/03-method.tex\n        - button \"Delete chapters/03-method.tex\" [ref=e248] [cursor=pointer]\n      - generic [ref=e250]:\n        - generic [aria-hidden] [ref=e251]:\n          - generic [ref=e252]: \"1\"\n          - generic [ref=e253]: \"2\"\n          - generic [ref=e254]: \"3\"\n          - generic [ref=e255]: \"4\"\n          - generic [ref=e256]: \"5\"\n        - textbox \"Source of chapters/03-method.tex\" [ref=e202]: \"\\\\chapter{Method} \\\\label{ch:method} Describe the method so that another lab could repeat it.\"\n    - complementary \"Margin\" [ref=e257]\n  - generic [ref=e258]:\n    - status\n    - status\n  - dialog [ref=e260]:\n    - heading \"Suggest edit\" [level=2] [ref=e262]\n    - generic [ref=e263]:\n      - blockquote [ref=e264]: repeat it\n      - generic [ref=e265]:\n        - generic [ref=e266]: Replacement text\n        - textbox \"Replacement text\" [active] [ref=e267]\n      - button \"Add suggestion\" [ref=e269] [cursor=pointer]"
}
```

### Tool call: browser_snapshot
- Args
```json
{
  "depth": 5
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/p/p_f6b1c704a294b3bafa18029b?file=chapters%2F03-method.tex\n- Page Title: Marginalia\n- Console: 2 errors, 0 warnings",
  "inlineSnapshot": "- generic [ref=e205]:\n  - link \"Skip to source\" [ref=e206] [cursor=pointer]:\n    - /url: \"#source-box\"\n  - generic [ref=e207]:\n    - link \"Projects\" [ref=e208] [cursor=pointer]:\n      - /url: /\n    - generic [ref=e209]: Stub628405\n    - button \"Save\" [ref=e210] [cursor=pointer]\n    - button \"Suggest edit\" [ref=e211] [cursor=pointer]\n    - button \"Comment\" [ref=e212] [cursor=pointer]\n    - button \"New file\" [ref=e213] [cursor=pointer]\n    - button \"Upload file\" [ref=e214] [cursor=pointer]\n    - button \"Citation warnings\" [ref=e215] [cursor=pointer]\n    - generic [ref=e216]: No undefined citations\n    - button \"History\" [ref=e217] [cursor=pointer]\n    - button \"People and sharing\" [ref=e218] [cursor=pointer]\n    - button \"Submission check\" [ref=e219] [cursor=pointer]\n  - generic [ref=e220]:\n    - complementary [ref=e221]:\n      - tree \"Project files\" [ref=e222]:\n        - group \"chapters\" [ref=e223]:\n          - treeitem \"▾ chapters/\" [expanded] [ref=e224]\n          - treeitem \"01-introduction.tex\" [ref=e225]\n          - treeitem \"02-background.tex\" [ref=e226]\n          - treeitem \"03-method.tex\" [selected] [ref=e227]\n          - treeitem \"04-results.tex\" [ref=e228]\n          - treeitem \"05-conclusion.tex\" [ref=e229]\n        - group \"figures\" [ref=e230]:\n          - treeitem \"▾ figures/\" [expanded] [ref=e231]\n          - treeitem \"placeholder-plot.svg\" [ref=e232]\n        - group \"frontmatter\" [ref=e233]:\n          - treeitem \"▾ frontmatter/\" [expanded] [ref=e234]\n          - treeitem \"abstract.tex\" [ref=e235]\n          - treeitem \"acknowledgements.tex\" [ref=e236]\n        - treeitem \"main.tex\" [ref=e237]\n        - treeitem \"preamble.tex\" [ref=e238]\n        - treeitem \"references.bib\" [ref=e239]\n      - navigation \"Sections\" [ref=e240]:\n        - list \"Sections\" [ref=e241]:\n          - listitem [ref=e242]\n    - generic [ref=e245]:\n      - generic [ref=e246]:\n        - generic [ref=e247]: chapters/03-method.tex\n        - button \"Delete chapters/03-method.tex\" [ref=e248] [cursor=pointer]\n      - generic [ref=e250]:\n        - generic [aria-hidden] [ref=e251]:\n          - generic [ref=e252]: \"1\"\n          - generic [ref=e253]: \"2\"\n          - generic [ref=e254]: \"3\"\n          - generic [ref=e255]: \"4\"\n          - generic [ref=e256]: \"5\"\n        - textbox \"Source of chapters/03-method.tex\" [ref=e202]: \"\\\\chapter{Method} \\\\label{ch:method} Describe the method so that another lab could repeat it.\"\n    - complementary \"Margin\" [ref=e257]\n  - generic [ref=e258]:\n    - status\n    - status\n  - dialog \"Suggest edit\" [ref=e260]:\n    - heading \"Suggest edit\" [level=2] [ref=e262]\n    - generic [ref=e263]:\n      - blockquote [ref=e264]: repeat it\n      - generic [ref=e265]:\n        - generic [ref=e266]: Replacement text\n        - textbox \"Replacement text\" [active] [ref=e267]\n      - button \"Add suggestion\" [ref=e269] [cursor=pointer]"
}
```

### Tool call: browser_fill_form
- Args
```json
{
  "fields": [
    {
      "target": "e267",
      "name": "Replacement text",
      "type": "textbox",
      "value": "reproduce it"
    }
  ]
}
```
- Result
```json
{}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Add suggestion",
  "target": "e269"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/p/p_f6b1c704a294b3bafa18029b?file=chapters%2F03-method.tex\n- Page Title: Marginalia\n- Console: 2 errors, 0 warnings",
  "snapshot": "- generic [ref=e270]:\n  - link \"Skip to source\" [ref=e271] [cursor=pointer]:\n    - /url: \"#source-box\"\n  - generic [ref=e272]:\n    - link \"Projects\" [ref=e273] [cursor=pointer]:\n      - /url: /\n    - generic [ref=e274]: Stub628405\n    - button \"Save\" [ref=e275] [cursor=pointer]\n    - button \"Suggest edit\" [ref=e276] [cursor=pointer]\n    - button \"Comment\" [ref=e277] [cursor=pointer]\n    - button \"New file\" [ref=e278] [cursor=pointer]\n    - button \"Upload file\" [ref=e279] [cursor=pointer]\n    - button \"Citation warnings\" [ref=e280] [cursor=pointer]\n    - generic [ref=e281]: No undefined citations\n    - button \"History\" [ref=e282] [cursor=pointer]\n    - button \"People and sharing\" [ref=e283] [cursor=pointer]\n    - button \"Submission check\" [ref=e284] [cursor=pointer]\n  - generic [ref=e285]:\n    - complementary [ref=e286]:\n      - tree \"Project files\" [ref=e287]:\n        - group \"chapters\" [ref=e288]:\n          - treeitem \"▾ chapters/\" [expanded] [ref=e289]\n          - treeitem \"01-introduction.tex\" [ref=e290]\n          - treeitem \"02-background.tex\" [ref=e291]\n          - treeitem \"03-method.tex\" [selected] [ref=e292]\n          - treeitem \"04-results.tex\" [ref=e293]\n          - treeitem \"05-conclusion.tex\" [ref=e294]\n        - group \"figures\" [ref=e295]:\n          - treeitem \"▾ figures/\" [expanded] [ref=e296]\n          - treeitem \"placeholder-plot.svg\" [ref=e297]\n        - group \"frontmatter\" [ref=e298]:\n          - treeitem \"▾ frontmatter/\" [expanded] [ref=e299]\n          - treeitem \"abstract.tex\" [ref=e300]\n          - treeitem \"acknowledgements.tex\" [ref=e301]\n        - treeitem \"main.tex\" [ref=e302]\n        - treeitem \"preamble.tex\" [ref=e303]\n        - treeitem \"references.bib\" [ref=e304]\n      - navigation \"Sections\" [ref=e305]:\n        - list \"Sections\" [ref=e306]:\n          - listitem [ref=e307]:\n            - link \"Method\" [ref=e308] [cursor=pointer]:\n              - /url: \"#\"\n    - generic [ref=e310]:\n      - generic [ref=e311]:\n        - generic [ref=e312]: chapters/03-method.tex\n        - button \"Delete chapters/03-method.tex\" [ref=e313] [cursor=pointer]\n      - generic [ref=e315]:\n        - generic [aria-hidden] [ref=e316]:\n          - generic [ref=e317]: \"1\"\n          - generic [ref=e318]: \"2\"\n          - generic [ref=e319]: \"3\"\n          - generic [ref=e320]: \"4\"\n          - generic [ref=e321]: \"5\"\n        - textbox \"Source of chapters/03-method.tex\" [ref=e202]: \"\\\\chapter{Method} \\\\label{ch:method} Describe the method so that another lab could repeat it.\"\n    - complementary \"Margin\" [ref=e322]\n  - generic [ref=e323]:\n    - status [ref=e324]: Suggestion added\n    - status"
}
```

### Tool call: browser_snapshot
- Args
```json
{
  "depth": 6
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/p/p_f6b1c704a294b3bafa18029b?file=chapters%2F03-method.tex\n- Page Title: Marginalia\n- Console: 2 errors, 0 warnings",
  "inlineSnapshot": "- generic [ref=e270]:\n  - link \"Skip to source\" [ref=e271] [cursor=pointer]:\n    - /url: \"#source-box\"\n  - generic [ref=e272]:\n    - link \"Projects\" [ref=e273] [cursor=pointer]:\n      - /url: /\n    - generic [ref=e274]: Stub628405\n    - button \"Save\" [ref=e275] [cursor=pointer]\n    - button \"Suggest edit\" [ref=e276] [cursor=pointer]\n    - button \"Comment\" [ref=e277] [cursor=pointer]\n    - button \"New file\" [ref=e278] [cursor=pointer]\n    - button \"Upload file\" [ref=e279] [cursor=pointer]\n    - button \"Citation warnings\" [ref=e280] [cursor=pointer]\n    - generic [ref=e281]: No undefined citations\n    - button \"History\" [ref=e282] [cursor=pointer]\n    - button \"People and sharing\" [ref=e283] [cursor=pointer]\n    - button \"Submission check\" [ref=e284] [cursor=pointer]\n  - generic [ref=e285]:\n    - complementary [ref=e286]:\n      - tree \"Project files\" [ref=e287]:\n        - group \"chapters\" [ref=e288]:\n          - treeitem \"▾ chapters/\" [expanded] [ref=e289]\n          - treeitem \"01-introduction.tex\" [ref=e290]\n          - treeitem \"02-background.tex\" [ref=e291]\n          - treeitem \"03-method.tex\" [selected] [ref=e292]\n          - treeitem \"04-results.tex\" [ref=e293]\n          - treeitem \"05-conclusion.tex\" [ref=e294]\n        - group \"figures\" [ref=e295]:\n          - treeitem \"▾ figures/\" [expanded] [ref=e296]\n          - treeitem \"placeholder-plot.svg\" [ref=e297]\n        - group \"frontmatter\" [ref=e298]:\n          - treeitem \"▾ frontmatter/\" [expanded] [ref=e299]\n          - treeitem \"abstract.tex\" [ref=e300]\n          - treeitem \"acknowledgements.tex\" [ref=e301]\n        - treeitem \"main.tex\" [ref=e302]\n        - treeitem \"preamble.tex\" [ref=e303]\n        - treeitem \"references.bib\" [ref=e304]\n      - navigation \"Sections\" [ref=e305]:\n        - list \"Sections\" [ref=e306]:\n          - listitem [ref=e307]:\n            - link \"Method\" [ref=e308] [cursor=pointer]:\n              - /url: \"#\"\n    - generic [ref=e310]:\n      - generic [ref=e311]:\n        - generic [ref=e312]: chapters/03-method.tex\n        - button \"Delete chapters/03-method.tex\" [ref=e313] [cursor=pointer]\n      - generic [ref=e315]:\n        - generic [aria-hidden] [ref=e316]:\n          - generic [ref=e317]: \"1\"\n          - generic [ref=e318]: \"2\"\n          - generic [ref=e319]: \"3\"\n          - generic [ref=e320]: \"4\"\n          - generic [ref=e321]: \"5\"\n        - textbox \"Source of chapters/03-method.tex\" [ref=e202]: \"\\\\chapter{Method} \\\\label{ch:method} Describe the method so that another lab could repeat it.\"\n    - complementary \"Margin\" [ref=e322]\n  - generic [ref=e323]:\n    - status [ref=e324]: Suggestion added\n    - status"
}
```

### Tool call: browser_navigate
- Args
```json
{
  "url": "http://127.0.0.1:4173/p/p_f6b1c704a294b3bafa18029b?file=chapters%2F03-method.tex"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/p/p_f6b1c704a294b3bafa18029b?file=chapters%2F03-method.tex\n- Page Title: Marginalia",
  "snapshot": "- generic [ref=f1e3]:\n  - link \"Skip to source\" [ref=f1e4] [cursor=pointer]:\n    - /url: \"#source-box\"\n  - generic [ref=f1e5]:\n    - link \"Projects\" [ref=f1e6] [cursor=pointer]:\n      - /url: /\n    - button \"Save\" [ref=f1e7] [cursor=pointer]\n    - button \"Suggest edit\" [disabled] [ref=f1e8]\n    - button \"Comment\" [disabled] [ref=f1e9]\n    - button \"New file\" [disabled] [ref=f1e10]\n    - button \"Upload file\" [disabled] [ref=f1e11]\n    - button \"Citation warnings\" [ref=f1e12] [cursor=pointer]\n    - button \"History\" [ref=f1e13] [cursor=pointer]\n    - button \"People and sharing\" [ref=f1e14] [cursor=pointer]\n    - button \"Submission check\" [ref=f1e15] [cursor=pointer]\n  - generic [ref=f1e16]:\n    - complementary [ref=f1e17]:\n      - tree \"Project files\"\n      - navigation \"Sections\":\n        - list \"Sections\"\n    - complementary \"Margin\" [ref=f1e20]\n  - generic [ref=f1e21]:\n    - status\n    - status"
}
```

### Tool call: browser_snapshot
- Args
```json
{
  "depth": 6
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/p/p_f6b1c704a294b3bafa18029b?file=chapters%2F03-method.tex\n- Page Title: Marginalia",
  "inlineSnapshot": "- generic [ref=f1e22]:\n  - link \"Skip to source\" [ref=f1e23] [cursor=pointer]:\n    - /url: \"#source-box\"\n  - generic [ref=f1e24]:\n    - link \"Projects\" [ref=f1e25] [cursor=pointer]:\n      - /url: /\n    - generic [ref=f1e26]: Stub628405\n    - button \"Save\" [ref=f1e27] [cursor=pointer]\n    - button \"Suggest edit\" [disabled] [ref=f1e28]\n    - button \"Comment\" [disabled] [ref=f1e29]\n    - button \"New file\" [ref=f1e30] [cursor=pointer]\n    - button \"Upload file\" [ref=f1e31] [cursor=pointer]\n    - button \"Citation warnings\" [ref=f1e32] [cursor=pointer]\n    - generic [ref=f1e33]: No undefined citations\n    - button \"History\" [ref=f1e34] [cursor=pointer]\n    - button \"People and sharing\" [ref=f1e35] [cursor=pointer]\n    - button \"Submission check\" [ref=f1e36] [cursor=pointer]\n  - generic [ref=f1e37]:\n    - complementary [ref=f1e38]:\n      - tree \"Project files\" [ref=f1e39]:\n        - group \"chapters\" [ref=f1e40]:\n          - treeitem \"▾ chapters/\" [expanded] [ref=f1e41]\n          - treeitem \"01-introduction.tex\" [ref=f1e42]\n          - treeitem \"02-background.tex\" [ref=f1e43]\n          - treeitem \"03-method.tex\" [selected] [ref=f1e44]\n          - treeitem \"04-results.tex\" [ref=f1e45]\n          - treeitem \"05-conclusion.tex\" [ref=f1e46]\n        - group \"figures\" [ref=f1e47]:\n          - treeitem \"▾ figures/\" [expanded] [ref=f1e48]\n          - treeitem \"placeholder-plot.svg\" [ref=f1e49]\n        - group \"frontmatter\" [ref=f1e50]:\n          - treeitem \"▾ frontmatter/\" [expanded] [ref=f1e51]\n          - treeitem \"abstract.tex\" [ref=f1e52]\n          - treeitem \"acknowledgements.tex\" [ref=f1e53]\n        - treeitem \"main.tex\" [ref=f1e54]\n        - treeitem \"preamble.tex\" [ref=f1e55]\n        - treeitem \"references.bib\" [ref=f1e56]\n      - navigation \"Sections\" [ref=f1e57]:\n        - list \"Sections\" [ref=f1e58]:\n          - listitem [ref=f1e59]:\n            - link \"Method\" [ref=f1e60] [cursor=pointer]:\n              - /url: \"#\"\n    - generic [ref=f1e62]:\n      - generic [ref=f1e63]:\n        - generic [ref=f1e64]: chapters/03-method.tex\n        - button \"Delete chapters/03-method.tex\" [ref=f1e65] [cursor=pointer]\n      - generic [ref=f1e67]:\n        - generic [aria-hidden] [ref=f1e68]:\n          - generic [ref=f1e69]: \"1\"\n          - generic [ref=f1e70]: \"2\"\n          - generic [ref=f1e71]: \"3\"\n          - generic [ref=f1e72]: \"4\"\n          - generic [ref=f1e73]: \"5\"\n        - textbox \"Source of chapters/03-method.tex\" [ref=f1e74]: \"\\\\chapter{Method} \\\\label{ch:method} Describe the method so that another lab could repeat it.\"\n    - complementary \"Margin\" [ref=f1e75]:\n      - article \"Suggestion by Ilse Varga\" [ref=f1e76]:\n        - heading \"Ilse Varga @ilsevarga\" [level=3] [ref=f1e77]\n        - blockquote [ref=f1e78]: repeat it\n        - paragraph [ref=f1e79]:\n          - deletion [ref=f1e80]: repeat it\n          - insertion [ref=f1e81]: reproduce it\n        - generic [ref=f1e82]:\n          - button \"Accept\" [ref=f1e83] [cursor=pointer]\n          - button \"Reject\" [ref=f1e84] [cursor=pointer]\n  - generic [ref=f1e85]:\n    - status\n    - status"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Accept on new suggestion",
  "target": "article button:first-of-type"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/p/p_f6b1c704a294b3bafa18029b?file=chapters%2F03-method.tex\n- Page Title: Marginalia",
  "snapshot": "- generic [ref=f1e86]:\n  - link \"Skip to source\" [ref=f1e87] [cursor=pointer]:\n    - /url: \"#source-box\"\n  - generic [ref=f1e88]:\n    - link \"Projects\" [ref=f1e89] [cursor=pointer]:\n      - /url: /\n    - generic [ref=f1e90]: Stub628405\n    - button \"Save\" [ref=f1e91] [cursor=pointer]\n    - button \"Suggest edit\" [ref=f1e92] [cursor=pointer]\n    - button \"Comment\" [disabled] [ref=f1e93]\n    - button \"New file\" [ref=f1e94] [cursor=pointer]\n    - button \"Upload file\" [ref=f1e95] [cursor=pointer]\n    - button \"Citation warnings\" [ref=f1e96] [cursor=pointer]\n    - generic [ref=f1e97]: No undefined citations\n    - button \"History\" [ref=f1e98] [cursor=pointer]\n    - button \"People and sharing\" [ref=f1e99] [cursor=pointer]\n    - button \"Submission check\" [ref=f1e100] [cursor=pointer]\n  - generic [ref=f1e101]:\n    - complementary [ref=f1e102]:\n      - tree \"Project files\" [ref=f1e103]:\n        - group \"chapters\" [ref=f1e104]:\n          - treeitem \"▾ chapters/\" [expanded] [ref=f1e105]\n          - treeitem \"01-introduction.tex\" [ref=f1e106]\n          - treeitem \"02-background.tex\" [ref=f1e107]\n          - treeitem \"03-method.tex\" [selected] [ref=f1e108]\n          - treeitem \"04-results.tex\" [ref=f1e109]\n          - treeitem \"05-conclusion.tex\" [ref=f1e110]\n        - group \"figures\" [ref=f1e111]:\n          - treeitem \"▾ figures/\" [expanded] [ref=f1e112]\n          - treeitem \"placeholder-plot.svg\" [ref=f1e113]\n        - group \"frontmatter\" [ref=f1e114]:\n          - treeitem \"▾ frontmatter/\" [expanded] [ref=f1e115]\n          - treeitem \"abstract.tex\" [ref=f1e116]\n          - treeitem \"acknowledgements.tex\" [ref=f1e117]\n        - treeitem \"main.tex\" [ref=f1e118]\n        - treeitem \"preamble.tex\" [ref=f1e119]\n        - treeitem \"references.bib\" [ref=f1e120]\n      - navigation \"Sections\" [ref=f1e121]:\n        - list \"Sections\" [ref=f1e122]:\n          - listitem [ref=f1e123]:\n            - link \"Method\" [ref=f1e124] [cursor=pointer]:\n              - /url: \"#\"\n    - generic [ref=f1e126]:\n      - generic [ref=f1e127]:\n        - generic [ref=f1e128]: chapters/03-method.tex\n        - button \"Delete chapters/03-method.tex\" [ref=f1e129] [cursor=pointer]\n      - generic [ref=f1e131]:\n        - generic [aria-hidden] [ref=f1e132]:\n          - generic [ref=f1e133]: \"1\"\n          - generic [ref=f1e134]: \"2\"\n          - generic [ref=f1e135]: \"3\"\n          - generic [ref=f1e136]: \"4\"\n          - generic [ref=f1e137]: \"5\"\n        - textbox \"Source of chapters/03-method.tex\" [active] [ref=f1e74]: \"\\\\chapter{Method} \\\\label{ch:method} Describe the method so that another lab could repeat it.\"\n    - complementary \"Margin\" [ref=f1e138]:\n      - article \"Suggestion by Ilse Varga\" [ref=f1e139]:\n        - paragraph [ref=f1e140]: Accepted by Ilse Varga\n  - generic [ref=f1e141]:\n    - status [ref=f1e142]: Suggestion accepted, 0 open remain\n    - status"
}
```

### Tool call: browser_snapshot
- Args
```json
{
  "depth": 6
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/p/p_f6b1c704a294b3bafa18029b?file=chapters%2F03-method.tex\n- Page Title: Marginalia",
  "inlineSnapshot": "- generic [ref=f1e86]:\n  - link \"Skip to source\" [ref=f1e87] [cursor=pointer]:\n    - /url: \"#source-box\"\n  - generic [ref=f1e88]:\n    - link \"Projects\" [ref=f1e89] [cursor=pointer]:\n      - /url: /\n    - generic [ref=f1e90]: Stub628405\n    - button \"Save\" [ref=f1e91] [cursor=pointer]\n    - button \"Suggest edit\" [ref=f1e92] [cursor=pointer]\n    - button \"Comment\" [disabled] [ref=f1e93]\n    - button \"New file\" [ref=f1e94] [cursor=pointer]\n    - button \"Upload file\" [ref=f1e95] [cursor=pointer]\n    - button \"Citation warnings\" [ref=f1e96] [cursor=pointer]\n    - generic [ref=f1e97]: No undefined citations\n    - button \"History\" [ref=f1e98] [cursor=pointer]\n    - button \"People and sharing\" [ref=f1e99] [cursor=pointer]\n    - button \"Submission check\" [ref=f1e100] [cursor=pointer]\n  - generic [ref=f1e101]:\n    - complementary [ref=f1e102]:\n      - tree \"Project files\" [ref=f1e103]:\n        - group \"chapters\" [ref=f1e104]:\n          - treeitem \"▾ chapters/\" [expanded] [ref=f1e105]\n          - treeitem \"01-introduction.tex\" [ref=f1e106]\n          - treeitem \"02-background.tex\" [ref=f1e107]\n          - treeitem \"03-method.tex\" [selected] [ref=f1e108]\n          - treeitem \"04-results.tex\" [ref=f1e109]\n          - treeitem \"05-conclusion.tex\" [ref=f1e110]\n        - group \"figures\" [ref=f1e111]:\n          - treeitem \"▾ figures/\" [expanded] [ref=f1e112]\n          - treeitem \"placeholder-plot.svg\" [ref=f1e113]\n        - group \"frontmatter\" [ref=f1e114]:\n          - treeitem \"▾ frontmatter/\" [expanded] [ref=f1e115]\n          - treeitem \"abstract.tex\" [ref=f1e116]\n          - treeitem \"acknowledgements.tex\" [ref=f1e117]\n        - treeitem \"main.tex\" [ref=f1e118]\n        - treeitem \"preamble.tex\" [ref=f1e119]\n        - treeitem \"references.bib\" [ref=f1e120]\n      - navigation \"Sections\" [ref=f1e121]:\n        - list \"Sections\" [ref=f1e122]:\n          - listitem [ref=f1e123]:\n            - link \"Method\" [ref=f1e124] [cursor=pointer]:\n              - /url: \"#\"\n    - generic [ref=f1e126]:\n      - generic [ref=f1e127]:\n        - generic [ref=f1e128]: chapters/03-method.tex\n        - button \"Delete chapters/03-method.tex\" [ref=f1e129] [cursor=pointer]\n      - generic [ref=f1e131]:\n        - generic [aria-hidden] [ref=f1e132]:\n          - generic [ref=f1e133]: \"1\"\n          - generic [ref=f1e134]: \"2\"\n          - generic [ref=f1e135]: \"3\"\n          - generic [ref=f1e136]: \"4\"\n          - generic [ref=f1e137]: \"5\"\n        - textbox \"Source of chapters/03-method.tex\" [active] [ref=f1e74]: \"\\\\chapter{Method} \\\\label{ch:method} Describe the method so that another lab could repeat it.\"\n    - complementary \"Margin\" [ref=f1e138]:\n      - article \"Suggestion by Ilse Varga\" [ref=f1e139]:\n        - paragraph [ref=f1e140]: Accepted by Ilse Varga\n  - generic [ref=f1e141]:\n    - status [ref=f1e142]: Suggestion accepted, 0 open remain\n    - status"
}
```

### Tool call: browser_take_screenshot
- Args
```json
{
  "type": "png",
  "scale": "css"
}
```
- Result
```json
{
  "result": "- [Screenshot of viewport](evidence/reduced/page-2026-11-11T14-49-27-274Z.png)",
  "attachments": [
    {
      "type": "image",
      "data": "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offy58//5htvhqfKly8f8jKxa522QIECoSST9ydPmjTprLPO2uMkw35Gjhx57733nnTSSblz577llluyZMky5u0x4akwHhI0nHnyEipVrJR8SUjWEJah7XPkyFGsWLG0w4VCzpQ5080335wnT56CBQuGxecPP/ww7RblcmeVy5kzZzhEkyZNVqxYUaFChTAYzu3Kq678aspXBz6T5MzQ9pkzZ77gggsqVao08fOJe7/hYbebNm4KC+DZs2cvVapUv6f65cuXL3FAoX6bNmsa3sPwkvDFqnVhreeffz6MhyXocIH33H1PyODw9t54040JAACA+GQ+yHlhyfflES/PnTs3eSdwaMjwd1jhDH+HbkzOCY2XkpKS3A4rqK3ubBViMiyrZsiQIW0/mTJlSnuYJyVP8obhf/7zn2Fxcvfl3FDUU7+eGpYxQ1uOGzcujHz6yacVKu7szI8//rhy5cphz8ns3F1yP1WrVN19cMHCBeHvH374Yffwy5zlXxceovqoo456991369evv2L5ii+/+PL6G64P42HZeeaMmSVPK7n7rsL1Fji+QPIqkiPJ6017GFp35aqVBz6T3efv3EOelOUrlif2cvTRR5csWfKqq64K7Xp8wePPP//8cJ6J/duxY8e3336b2ip198EyZcokN8JS8+WXXR4uKiyw7/7lAAAAiMdBBXBYJu3SuUv37t0rVa6UK1euPn36/DjrP5/1Dem1Z1NlSGzdujVr1qyN/tbogfsfeGnES7sn397CHvYxuH3n4Nlnn929R/ew8dnnn7VsufMDwJ0e3Hm779dTv27RosUeLwnVnTFTxm+++Wbvve3xAdo04SQHDhx47bXXhgs87LDDGjRsEEp45/xt2ytWrDho8KDE73KAMzlI4S198aUXQ4R/ELz/wWN9HnvhhRfCMvv+5oe3a9u2bUOGDilbtuw+z2f7jp3vQNoHqgEAAGJzULdAh+XT7Nmz17qwVqjfxG4RVahQofD34sWLkw9DZE2ZMmXn1o5E5syZH37k4bAIvHr16gEDBhx4/0WLFg25GI6SNvL9998nF4TzHZMvJXdKWLqcNXNWmdJlwp/FSxaH9dXNmzefcMIJe+znpJNOCn/v/oO4pk2bltw48cQTf/7557TxtJ9oFdz/wP39+/efNn3alK+mpP0WohInl5g9e3by88bJS5s+fXrioB3gTA5e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gCgIYAAAAKIggAEAAIiCAAYAACAKAhgAAIAoCGAAAACiIIABAACIggAGAAAgCgIYAACAKAhgAAAAoiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAYAACAKAhgAAIAoCGAAAACiIIABAACIggAGAAAgCgIYAACAKAhgAAAAoiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAYAACAKAhgAAIAoCGAAAACiIIABAACIggAGAAAgCgIYAACAKAhgAAAAoiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAYAACAKAhgAAIAoCGAAAACiIIABAACIggAGAAAgCgIYAACAKAhgAAAAoiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAYAACAKAhgAAIAoCGAAAACiIIABAACIggAGAAAgCgIYAACAKAhgAAAAoiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAYAACAKAhgAAIAoCGAAAACiIIABAACIggAGAAAgCgIYAACAKAhgAAAAoiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAYAACAKAhgAAIAoCGAAAACiIIABAACIggAGAAAgCgIYAACAKAhgAAAAoiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAYAACAKAhgAAIAoCGAAAACiIIABAACIggAGAAAgCgIYAACAKAhgAAAAoiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAYAACAKAhgAAIAoCGAAAACiIIABAACIggAGAAAgCgIYAACAKAhgAAAAoiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAYAACAKAhgAAIAoCGAAAACiIIABAACIggAGAAAgCgIYAACAKAhgAAAAoiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAYAACAKAhgAAIAoCGAAAACiIIABAACIggAGAAAgCgIYAACAKAhgAAAAoiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAYAACAKAhgAAIAoCGAAAACiIIABAACIggAGAAAgCgIYAACAKAhgAAAAoiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAYAACAKAhgAAIAoCGAAAACiIIABAACIggAGAAAgCgIYAACAKAhgAAAAoiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAYAACAKAhgAAIAoCGAAAACiIIABAACIggAGAAAgCgIYAACAKAhgAAAAoiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAYAACAKAhgAAIAoCGAAAACiIIABAACIggAGAAAgCgIYAACAKAhgAAAAoiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAYAACAKAhgAAIAoCGAAAACiIIABAACIggAGAAAgCgIYAACAKAhgAAAAoiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAYAACAKAhgAAIAoCGAAAACiIIABAACIggAGAAAgCgIYAACAKAhgAAAAoiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAYAACAKAhgAAIAoCGAAAACiIIABAACIggAGAAAgCgIYAACAKAhgAAAAoiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAYAACAKAhgAAIAoCGAAAACiIIABAACIggAGAAAgCgIYAACAKAhgAAAAoiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAYAACAKAhgAAIAoCGAAAACiIIABAACIggAGAAAgCgIYAACAKAhgAAAAoiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAYAACAKAhgAAIAoCGAAAACiIIABAACIggAGAAAgChk+GfNcAgAAAP7qMmxevzIBAAAAf3VugQYAACAKAhgAAIAoCGAAAACiIIABAACIggAGAAAgCgIYAACAKAhgAAAAoiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKLwVwjgzz/7pNP9HRJ/afd1bBMuMxG9GL7WAADA/5LMiXSa9u3UUa+PWLBg3mGHHXZ6qTJ16115zDHHJf7PjXv37bMqVD7yyNxh+5RTTsuX75jEoWPLls3vvD06vHWJP873/5w2auTLM2d8nz9/gXPOrVnzgosSf0WH3NcaAAD480jfCnAotz69up1ZrkKPh/t27tqr1BlnDujXZ9OmjQfz2iVLfr7t5vp9H394j/Hnhgz8W4N6i39elEiPsWPfWL1qZXL7yNwpJxYtljh0rF+37u23Xk/8cVavXtXrkS7nVqv5RL8hN97cbNTIEVMmf5H4KzrkvtYAAMCfR/pWgDdt2rxx48bqNWplzZotPCxf4ezwJ/nU7c1vvCP17qK74uTtt0b+OOuHlne0D9uhxF56ccj2bdsXL15Uv8ENF9W5LAxu3ry5f79e8+b+tGLF8uw5cvQf9EL27Nm3bds2euTLEz//ZP2G9RUqnH3FVQ2yZTs8TH73nTc/mzA+rDmfUbpsOHT+AgVbNrshjN/d4Y5TTz39rns7f/7ZJ2PeHvlAp51pPWfOj2GBOiyHFi5c5PxaF5c7q1Ji132zITjDSvWyZb+sW7e2YaObQ7rvcWn/+PC9D8aNWbJkcfESp1x1daNChYuEwVUrVwwe1Pe76d8ee1z+SpXPuXjXye9zcPaPM8MC7A/fTz+hSNHaF9ULpxoGn3m639o1azZsWL9hw4asWbNeUu/KU08rNeHTj/r1fTQ8G7L/8ivqX3bFtSFfX3152ORJE3PnTqlyTvULa1+SPKVx77394QfvLvv1l3DVB/66fPSPcScVO7lipaphu8iJJ9W++NKxY0afWbb87nO2b9/+xqhXPvvs43Vr15QrXylcY/bsOcJ4+7bNTz+9zPz5c9esWV2gwPHX1r8h71FHJ3ZF9d5n9ZvvZPJrEb58b789qtHfbqlYqUr42r0/bsyC+Tu/fJddfm1405IHPeWU0xcumBe+LVLkxGK3Nm75+qsvzpr1Q7as2W6+tUW+Y44Nc8L/Gy8Of2bqV5Py5D36rLMqXn5lg7T9J7/WYSfh6D/Nmb182a/hq3bDTU2S/1sCAADsU/pWgHPmzFm8xKmP9Oz07TdfrV+//jfnh4gKsXdb4zt6PtovhM3rr70YMiyMh7LaunVrtx6PP9b3mZw5cn7w/pgw+PJLz/3444zbW3V44MGem7dsfmZwvzC4dOniV14edt0Nt/V+fFDpMuXCDkOPPTd8VDiTrg/1CfW7x+F6dPt7CK2He/W/8KJ6Q4cMDCWcfOrXX3+59LKr/35/93Ayj/fpEaJ09xeuWL5s+rSpTZqnPtK7fyi057iKRaoAAAn6SURBVIYOSuwqxu7d7ju+YOFHej3VpOmd06d9/eOPM/c5GJK4Z/cHzq5y7qN9BoYeDt27aNGC5J5/+WVJi9vb3vdA9+tvbPzE4w+HmZXPPjeceTj/cBWhfsOcR3t2OiLXkeHdaNz0zi8nTggpHga//GLC6FGvXHl1w3BKx+UvEDL4AO/zz4sWHHts/rSHYX74dsMec8Lb+N133zZucsd9D/QIV9Hrka5pT4XvR3S4+8FwVqVLlwsrycnBfZ7Vb76TwaKFC7Idnr3nI0+G+v166uRw3GuuvT5cRYmTT3u4x4Ph2xzJaRkzZry7Y5fwlVq7ZnUYv/Tya0LWlixVJrx7yQnvjBldtlzFPk88fVuTO9579+1w8ntfePi/6O57O3fv+UT4FsObo19LAAAA7F+6fwhWuw73Vax0zltvvt6y2fUPdf17WKA7wOTQgdmyZSt6UvHEruXisHoclh/D9k9zfjzjjLKZM2cOC7+nnHb6L78sDUk27r0x9RvemD//8Sl58l5z7XVhKTjEVcikMP+IXLly5MhZpep5yUXO/QkLocVLnHZe9QtCXpY586zzz79ozNujk08dfXS+AscXChvhZLJmyxYibfcXhiM2b9k2HDpnziPKlz/7558XhsE5s2etXLkirJQemTslFG+7DveH9e19Do4f/8Gpp50eLjBczumlypQtWyGcSXLPp5x6enKh9bjjChQrdvJnEz7e45x/nDUjJOUVVzY44ohcBQudUPvieh9+MDZ5LTXPr12mzFnhwqueUyNP3qMOcOGbNm1KvlFJmTNlDm/17hPC2xsW0hs2uimsDx91dL7rrr8tXMi8uXOSz4a14gwZMoSNs6ueF4p97tw5+zur33wnE7vyOyxZH3549rA99p03ateuV6z4yeEqwuBhWbOGb50kp4XF23DQww47LHxLJX/+guFAYfCMM86c+9Ps5IT6DW4Ib2m2bIcXKVI0rKv/vGjB3hce/i8KO8mcJcvppUqH754kAAAA9i/dPwQra9ZsoWTCn7DcOunLz3s/2vWR3gPy7ifPChQouHXrloUL5oVk+m761yG9cu7qnCJFi82c+f25552/Zcvmn2b/eE61muvXr9u0aWOHti12f/ny5cvCHpq3bPPkE4/MnPF94cJFbry5WTKn92n58l9zp6SkPcydkmfZsn0snIbw3rJ1y+4j4eiDB/ad/ePMMH/Hjh25ch2Z2HULbgjvZBmm2efg8mW/fjFxwt8a1EsbKV+h8t7HPfzww1esWLbHYDjiqlUrr2t4adpI8uirV61M/oivpD2OuPeek0vrSVu3bc2eI8d/X+D68PampORJPsyUKVPY+a+/Lk3e6f1fu8qeI7yNWzZv3udZ7WHvd3KPUw1fwSHP9g9/0kZ+/WXpHvMzZc6023bmsKib3P5swvgxb48KgZ38kHn4tkJi/8KZbPv3CwEAAPYp3QG8du3asL6a2FVEIYNHj3o5LM2FAM60s0D+3UI7diT/G5b1bm18e8/uD4RXlStfqW37+5J1dOVVDbt16diy+Y15UvKE+j23Ws2QnSGtezzyZJ48efc44hmly4Y/oYs+Hv/+U0/26vlov/2dW548R82bOzvt4bp1a/MecOE0zRujXl27dk04vbB6OXv2rEd7dkrsWhZes3p1OLHdi26fg2F59pxza4QrPfBRwtJx4RNO3GMwb96j8x1z7CO9+u8xnuvI3Kv+/VO+Ejvf0R0H2HNYi05bWU3svCN6YVjN3n1CWJoOS/Fr16094t8du/PNOSrfHvvZtm3bmtWr8qTkDe/2Ps8qvcJXs07dy8PSfSKdQrEP7P/4rY1bnlG6XDj58L9QAgAA4H8mfbdAz58/946WN0349KPQY0uXLH79tZc2bthQeNcq4gknFH1z9GthUTEs6qZ9XHPVyhVDnunf67FBg555qUnTO9Oq7Pmhgyqffc6TTw3t3K33BbXqJHYtG9Y8v/aLw5/dumVL2Pn4j95/etCTiV0/XOrhHg8uXbo4805ZQmb/+1z2sSIaQvqf/5w+fdrXiZ0fVV067t23a/37B0r9pnz5jslf4PhwGmkJXaRI0VCh7419K7Ez+9c88VjPqV9N2ufgOedU//bbqTNm/DOxc0X31x4P3b9kyc/Jncya+UNYXg4bIVDDduXK5+w69/+cfFjQPiLnEWPfeSOx807mjWGxNLy9yWsZ996Y5Ed/w9seFpmT88MSdLiutE/SJpUrVzFcdfJ29HDhY94aeVb5/1qCzpgx4/m16rw4fEh4e8PD1199sWDBwoX/vfz77bdfJQP71VeGH3dcgVDp+zur9Kp1Yd233nx9xfKd696zZv3QrfO9e5z5/oQT3r59264byHf+dLSQ9AkAAID/mfStAIdqatzkzi8mfjp82DMhbgsVLtLh7geTi4rX39h48MAn7ulw5+mlyoQFyV+WLg6D2XPk2LJlS/JO2ixZDitatFidS64Iy7lh0fPZp58Kf8L4UUflO71U6UbX3XrVNX8bNXLEPXffuW7dutKly11T/7rwbIixlJQ87Vo3CxUU+vmW21omzyQU2t0d7ji7SrUmzVqlnV5YlG7dtuPrr7zQ+9FuJxQpem2D60899fSDua4LL7qka+d77uvYZv26dWE7rBt373Zf+7seCFf39KC+I156LuRx2XIVTz6lZAizvQfD4uqdre56/bUXf/j+u4KFTjj/govSfjdyocIn9On10D+/+7bEyaeltrnnyNw779AOL8yYMdPfGtS75bYW51Y7P7VtxxEvDm3W+G8hrStUODv5OedQsKF1e/Z4cNHC+RfXuTz5k5kTu24MfmHYM8WKn7z7YvJRR+dreUe7QQMeD4vG4fsEdepeEfp5j2sMq+4jX3/p3ntS169bW+bMs1q1uSftqXz5jm11x61r1qwuXbpsq9b/Gt/nWaVX+FqH/n/8sR4L5s875dSS1za4IVOmTAfzwvCW1m9449/vbZ37yNzZc+S85NKrwnu+9/o5AADAwcuwef3KxP+ad94evWDBvJB5iV2/QzisIr71xuth1feudi1DXiZ/201YSX7yiYfDUm2l5OroX8gzT/fLlu3w+g1uSPxxQhW3b9O834DnD7Ikf1P7ts3rN7ixdJlyCQAAgL+0dP8U6HRZuHBepsyZkrfXZs6cZdPGTZmzZAlLgmGhckfiXx9qzZQ586bNm7NkyZLgIIz/x7irrmn0R9UvAABAPNL9Q7DSpe4lV74w/Jk2qU1SUvIsWfxzwUIn3H5H+9y5U66+5m8P93gwR46c27ZtCz1cvXqtcmdVSnAQ6l12dQIAAID0+9+9BRoAAAD+JP53b4EGAACAPwkBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFP4fAAAA//+Al8HRAAAABklEQVQDAN0nOS/6C+qsAAAAAElFTkSuQmCC",
      "mimeType": "image/png"
    }
  ]
}
```
