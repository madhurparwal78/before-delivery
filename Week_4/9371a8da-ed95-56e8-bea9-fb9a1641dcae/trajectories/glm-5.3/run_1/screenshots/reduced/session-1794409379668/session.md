
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
  "events": "- New console entries: evidence/reduced/console-2026-11-11T15-05-52-294Z.log#L1-L2"
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
  "snapshot": "- generic [ref=e14]:\n  - generic [ref=e16]:\n    - button \"Ilse Varga\" [ref=e17] [cursor=pointer]\n    - button \"Sign out\" [ref=e18] [cursor=pointer]\n  - heading \"Projects\" [level=1] [ref=e19]\n  - generic [ref=e21]:\n    - generic [ref=e22]:\n      - link \"Annotation Practice in Multilingual Labs\" [ref=e23] [cursor=pointer]:\n        - /url: /p/p_8ceb10d2e44073813a2497f1?file=main.tex\n      - generic [ref=e24]: owner\n      - generic [ref=e25]: r1\n    - generic [ref=e26]:\n      - 'link \"Grant Proposal: Shared Margins\" [ref=e27] [cursor=pointer]':\n        - /url: /p/p_15b66bd5aa05e286d7d88900?file=main.tex\n      - generic [ref=e28]: owner\n      - generic [ref=e29]: r3\n    - generic [ref=e30]:\n      - link \"Run11112601\" [ref=e31] [cursor=pointer]:\n        - /url: /p/p_499e120743b75e37b9bd3861?file=main.tex\n      - generic [ref=e32]: owner\n      - generic [ref=e33]: r1\n    - generic [ref=e34]:\n      - link \"Run481729\" [ref=e35] [cursor=pointer]:\n        - /url: /p/p_a559d3dcd8e66821dadbf312?file=main.tex\n      - generic [ref=e36]: owner\n      - generic [ref=e37]: r1\n    - generic [ref=e38]:\n      - link \"Run846215\" [ref=e39] [cursor=pointer]:\n        - /url: /p/p_6adfdc8f1d8011ea1e3d10ea?file=main.tex\n      - generic [ref=e40]: owner\n      - generic [ref=e41]: r1\n    - generic [ref=e42]:\n      - link \"Share11112602\" [ref=e43] [cursor=pointer]:\n        - /url: /p/p_a6dba2794b9c317b18015894?file=main.tex\n      - generic [ref=e44]: owner\n      - generic [ref=e45]: r1\n    - generic [ref=e46]:\n      - link \"Share846215\" [ref=e47] [cursor=pointer]:\n        - /url: /p/p_7b85a9982a8648189467a4ef?file=main.tex\n      - generic [ref=e48]: owner\n      - generic [ref=e49]: r1\n    - generic [ref=e50]:\n      - link \"Share937154\" [ref=e51] [cursor=pointer]:\n        - /url: /p/p_d93f001bb37a17132e6fac8e?file=main.tex\n      - generic [ref=e52]: owner\n      - generic [ref=e53]: r1\n    - generic [ref=e54]:\n      - link \"Stub628405\" [ref=e55] [cursor=pointer]:\n        - /url: /p/p_f6b1c704a294b3bafa18029b?file=main.tex\n      - generic [ref=e56]: owner\n      - generic [ref=e57]: r2\n    - generic [ref=e58]:\n      - link \"Stub846215\" [ref=e59] [cursor=pointer]:\n        - /url: /p/p_7026e43f99cae347eb48f4d2?file=main.tex\n      - generic [ref=e60]: owner\n      - generic [ref=e61]: r2\n  - button \"New project\" [ref=e62] [cursor=pointer]\n  - status [ref=e63]"
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
  "inlineSnapshot": "- generic [ref=e14]:\n  - generic [ref=e16]:\n    - button \"Ilse Varga\" [ref=e17] [cursor=pointer]\n    - button \"Sign out\" [ref=e18] [cursor=pointer]\n  - heading \"Projects\" [level=1] [ref=e19]\n  - generic [ref=e21]:\n    - generic [ref=e22]\n    - generic [ref=e26]\n    - generic [ref=e30]\n    - generic [ref=e34]\n    - generic [ref=e38]\n    - generic [ref=e42]\n    - generic [ref=e46]\n    - generic [ref=e50]\n    - generic [ref=e54]\n    - generic [ref=e58]\n  - button \"New project\" [ref=e62] [cursor=pointer]\n  - status [ref=e63]"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "New project",
  "target": "e62"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/\n- Page Title: Marginalia\n- Console: 2 errors, 0 warnings",
  "snapshot": "- generic [ref=e64]:\n  - generic [ref=e66]:\n    - button \"Ilse Varga\" [ref=e67] [cursor=pointer]\n    - button \"Sign out\" [ref=e68] [cursor=pointer]\n  - heading \"Projects\" [level=1] [ref=e69]\n  - generic [ref=e71]:\n    - generic [ref=e72]:\n      - link \"Annotation Practice in Multilingual Labs\" [ref=e73] [cursor=pointer]:\n        - /url: /p/p_8ceb10d2e44073813a2497f1?file=main.tex\n      - generic [ref=e74]: owner\n      - generic [ref=e75]: r1\n    - generic [ref=e76]:\n      - 'link \"Grant Proposal: Shared Margins\" [ref=e77] [cursor=pointer]':\n        - /url: /p/p_15b66bd5aa05e286d7d88900?file=main.tex\n      - generic [ref=e78]: owner\n      - generic [ref=e79]: r3\n    - generic [ref=e80]:\n      - link \"Run11112601\" [ref=e81] [cursor=pointer]:\n        - /url: /p/p_499e120743b75e37b9bd3861?file=main.tex\n      - generic [ref=e82]: owner\n      - generic [ref=e83]: r1\n    - generic [ref=e84]:\n      - link \"Run481729\" [ref=e85] [cursor=pointer]:\n        - /url: /p/p_a559d3dcd8e66821dadbf312?file=main.tex\n      - generic [ref=e86]: owner\n      - generic [ref=e87]: r1\n    - generic [ref=e88]:\n      - link \"Run846215\" [ref=e89] [cursor=pointer]:\n        - /url: /p/p_6adfdc8f1d8011ea1e3d10ea?file=main.tex\n      - generic [ref=e90]: owner\n      - generic [ref=e91]: r1\n    - generic [ref=e92]:\n      - link \"Share11112602\" [ref=e93] [cursor=pointer]:\n        - /url: /p/p_a6dba2794b9c317b18015894?file=main.tex\n      - generic [ref=e94]: owner\n      - generic [ref=e95]: r1\n    - generic [ref=e96]:\n      - link \"Share846215\" [ref=e97] [cursor=pointer]:\n        - /url: /p/p_7b85a9982a8648189467a4ef?file=main.tex\n      - generic [ref=e98]: owner\n      - generic [ref=e99]: r1\n    - generic [ref=e100]:\n      - link \"Share937154\" [ref=e101] [cursor=pointer]:\n        - /url: /p/p_d93f001bb37a17132e6fac8e?file=main.tex\n      - generic [ref=e102]: owner\n      - generic [ref=e103]: r1\n    - generic [ref=e104]:\n      - link \"Stub628405\" [ref=e105] [cursor=pointer]:\n        - /url: /p/p_f6b1c704a294b3bafa18029b?file=main.tex\n      - generic [ref=e106]: owner\n      - generic [ref=e107]: r2\n    - generic [ref=e108]:\n      - link \"Stub846215\" [ref=e109] [cursor=pointer]:\n        - /url: /p/p_7026e43f99cae347eb48f4d2?file=main.tex\n      - generic [ref=e110]: owner\n      - generic [ref=e111]: r2\n  - button \"New project\" [ref=e112] [cursor=pointer]\n  - dialog [ref=e114]:\n    - heading \"New project\" [level=2] [ref=e116]\n    - generic [ref=e117]:\n      - generic [ref=e118]:\n        - generic [ref=e119]: Title\n        - textbox \"Title\" [active] [ref=e120]\n      - radiogroup \"Template\" [ref=e121]:\n        - generic [ref=e122]:\n          - radio \"Thesis, numbered chapters\" [checked] [ref=e123]\n          - text: Thesis, numbered chapters\n        - generic [ref=e124]:\n          - radio \"Article, single file\" [ref=e125]\n          - text: Article, single file\n      - button \"Create project\" [ref=e127] [cursor=pointer]\n  - status [ref=e128]"
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
  "inlineSnapshot": "- generic [ref=e64]:\n  - generic [ref=e66]:\n    - button \"Ilse Varga\" [ref=e67] [cursor=pointer]\n    - button \"Sign out\" [ref=e68] [cursor=pointer]\n  - heading \"Projects\" [level=1] [ref=e69]\n  - generic [ref=e71]:\n    - generic [ref=e72]:\n      - link \"Annotation Practice in Multilingual Labs\" [ref=e73] [cursor=pointer]:\n        - /url: /p/p_8ceb10d2e44073813a2497f1?file=main.tex\n      - generic [ref=e74]: owner\n      - generic [ref=e75]: r1\n    - generic [ref=e76]:\n      - 'link \"Grant Proposal: Shared Margins\" [ref=e77] [cursor=pointer]':\n        - /url: /p/p_15b66bd5aa05e286d7d88900?file=main.tex\n      - generic [ref=e78]: owner\n      - generic [ref=e79]: r3\n    - generic [ref=e80]:\n      - link \"Run11112601\" [ref=e81] [cursor=pointer]:\n        - /url: /p/p_499e120743b75e37b9bd3861?file=main.tex\n      - generic [ref=e82]: owner\n      - generic [ref=e83]: r1\n    - generic [ref=e84]:\n      - link \"Run481729\" [ref=e85] [cursor=pointer]:\n        - /url: /p/p_a559d3dcd8e66821dadbf312?file=main.tex\n      - generic [ref=e86]: owner\n      - generic [ref=e87]: r1\n    - generic [ref=e88]:\n      - link \"Run846215\" [ref=e89] [cursor=pointer]:\n        - /url: /p/p_6adfdc8f1d8011ea1e3d10ea?file=main.tex\n      - generic [ref=e90]: owner\n      - generic [ref=e91]: r1\n    - generic [ref=e92]:\n      - link \"Share11112602\" [ref=e93] [cursor=pointer]:\n        - /url: /p/p_a6dba2794b9c317b18015894?file=main.tex\n      - generic [ref=e94]: owner\n      - generic [ref=e95]: r1\n    - generic [ref=e96]:\n      - link \"Share846215\" [ref=e97] [cursor=pointer]:\n        - /url: /p/p_7b85a9982a8648189467a4ef?file=main.tex\n      - generic [ref=e98]: owner\n      - generic [ref=e99]: r1\n    - generic [ref=e100]:\n      - link \"Share937154\" [ref=e101] [cursor=pointer]:\n        - /url: /p/p_d93f001bb37a17132e6fac8e?file=main.tex\n      - generic [ref=e102]: owner\n      - generic [ref=e103]: r1\n    - generic [ref=e104]:\n      - link \"Stub628405\" [ref=e105] [cursor=pointer]:\n        - /url: /p/p_f6b1c704a294b3bafa18029b?file=main.tex\n      - generic [ref=e106]: owner\n      - generic [ref=e107]: r2\n    - generic [ref=e108]:\n      - link \"Stub846215\" [ref=e109] [cursor=pointer]:\n        - /url: /p/p_7026e43f99cae347eb48f4d2?file=main.tex\n      - generic [ref=e110]: owner\n      - generic [ref=e111]: r2\n  - button \"New project\" [ref=e112] [cursor=pointer]\n  - dialog \"New project\" [ref=e114]:\n    - heading \"New project\" [level=2] [ref=e116]\n    - generic [ref=e117]:\n      - generic [ref=e118]:\n        - generic [ref=e119]: Title\n        - textbox \"Title\" [active] [ref=e120]\n      - radiogroup \"Template\" [ref=e121]:\n        - generic [ref=e122]\n        - generic [ref=e124]\n      - button \"Create project\" [ref=e127] [cursor=pointer]\n  - status [ref=e128]"
}
```

### Tool call: browser_fill_form
- Args
```json
{
  "fields": [
    {
      "target": "e120",
      "name": "Title",
      "type": "textbox",
      "value": "Stub11112603"
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
  "target": "e127"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/p/p_4ad4dc304e1307b8f0ec63d7?file=main.tex\n- Page Title: Marginalia\n- Console: 2 errors, 0 warnings",
  "snapshot": "- generic [ref=e129]:\n  - link \"Skip to source\" [ref=e130] [cursor=pointer]:\n    - /url: \"#source-box\"\n  - generic [ref=e131]:\n    - link \"Projects\" [ref=e132] [cursor=pointer]:\n      - /url: /\n    - generic [ref=e133]: Stub11112603\n    - button \"Save\" [ref=e134] [cursor=pointer]\n    - button \"Suggest edit\" [ref=e135] [cursor=pointer]\n    - button \"Comment\" [disabled] [ref=e136]\n    - button \"New file\" [ref=e137] [cursor=pointer]\n    - button \"Upload file\" [ref=e138] [cursor=pointer]\n    - button \"Citation warnings\" [ref=e139] [cursor=pointer]\n    - generic [ref=e140]: No undefined citations\n    - button \"History\" [ref=e141] [cursor=pointer]\n    - button \"People and sharing\" [ref=e142] [cursor=pointer]\n    - button \"Submission check\" [ref=e143] [cursor=pointer]\n  - generic [ref=e144]:\n    - complementary [ref=e145]:\n      - tree \"Project files\" [ref=e146]:\n        - group \"chapters\" [ref=e147]:\n          - treeitem \"▾ chapters/\" [expanded] [ref=e148]\n          - treeitem \"01-introduction.tex\" [ref=e149]\n          - treeitem \"02-background.tex\" [ref=e150]\n          - treeitem \"03-method.tex\" [ref=e151]\n          - treeitem \"04-results.tex\" [ref=e152]\n          - treeitem \"05-conclusion.tex\" [ref=e153]\n        - group \"figures\" [ref=e154]:\n          - treeitem \"▾ figures/\" [expanded] [ref=e155]\n          - treeitem \"placeholder-plot.svg\" [ref=e156]\n        - group \"frontmatter\" [ref=e157]:\n          - treeitem \"▾ frontmatter/\" [expanded] [ref=e158]\n          - treeitem \"abstract.tex\" [ref=e159]\n          - treeitem \"acknowledgements.tex\" [ref=e160]\n        - treeitem \"main.tex\" [selected] [ref=e161]\n        - treeitem \"preamble.tex\" [ref=e162]\n        - treeitem \"references.bib\" [ref=e163]\n      - navigation \"Sections\":\n        - list \"Sections\"\n    - generic [ref=e165]:\n      - generic [ref=e166]:\n        - generic [ref=e167]: main.tex\n        - button \"Delete main.tex\" [ref=e168] [cursor=pointer]\n      - generic [ref=e170]:\n        - generic [aria-hidden] [ref=e171]:\n          - generic [ref=e172]: \"1\"\n          - generic [ref=e173]: \"2\"\n          - generic [ref=e174]: \"3\"\n          - generic [ref=e175]: \"4\"\n          - generic [ref=e176]: \"5\"\n          - generic [ref=e177]: \"6\"\n          - generic [ref=e178]: \"7\"\n          - generic [ref=e179]: \"8\"\n          - generic [ref=e180]: \"9\"\n          - generic [ref=e181]: \"10\"\n          - generic [ref=e182]: \"11\"\n          - generic [ref=e183]: \"12\"\n          - generic [ref=e184]: \"13\"\n          - generic [ref=e185]: \"14\"\n          - generic [ref=e186]: \"15\"\n          - generic [ref=e187]: \"16\"\n          - generic [ref=e188]: \"17\"\n          - generic [ref=e189]: \"18\"\n          - generic [ref=e190]: \"19\"\n          - generic [ref=e191]: \"20\"\n          - generic [ref=e192]: \"21\"\n          - generic [ref=e193]: \"22\"\n          - generic [ref=e194]: \"23\"\n        - textbox \"Source of main.tex\" [active] [ref=e195]: \"\\\\documentclass[12pt,a4paper]{report} \\\\input{preamble} \\\\title{Working Title of the Thesis} \\\\author{Student Name} \\\\date{\\\\today} \\\\begin{document} \\\\maketitle \\\\include{frontmatter/abstract} \\\\include{frontmatter/acknowledgements} \\\\tableofcontents \\\\include{chapters/01-introduction} \\\\include{chapters/02-background} \\\\include{chapters/03-method} \\\\include{chapters/04-results} \\\\include{chapters/05-conclusion} \\\\bibliographystyle{plainnat} \\\\bibliography{references} \\\\end{document}\"\n    - complementary \"Margin\" [ref=e196]\n  - generic [ref=e197]:\n    - status\n    - status"
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
  "page": "- Page URL: http://127.0.0.1:4173/p/p_4ad4dc304e1307b8f0ec63d7?file=main.tex\n- Page Title: Marginalia\n- Console: 2 errors, 0 warnings",
  "inlineSnapshot": "- generic [ref=e129]:\n  - link \"Skip to source\" [ref=e130] [cursor=pointer]:\n    - /url: \"#source-box\"\n  - generic [ref=e131]:\n    - link \"Projects\" [ref=e132] [cursor=pointer]:\n      - /url: /\n    - generic [ref=e133]: Stub11112603\n    - button \"Save\" [ref=e134] [cursor=pointer]\n    - button \"Suggest edit\" [ref=e135] [cursor=pointer]\n    - button \"Comment\" [disabled] [ref=e136]\n    - button \"New file\" [ref=e137] [cursor=pointer]\n    - button \"Upload file\" [ref=e138] [cursor=pointer]\n    - button \"Citation warnings\" [ref=e139] [cursor=pointer]\n    - generic [ref=e140]: No undefined citations\n    - button \"History\" [ref=e141] [cursor=pointer]\n    - button \"People and sharing\" [ref=e142] [cursor=pointer]\n    - button \"Submission check\" [ref=e143] [cursor=pointer]\n  - generic [ref=e144]:\n    - complementary [ref=e145]:\n      - tree \"Project files\" [ref=e146]:\n        - group \"chapters\" [ref=e147]\n        - group \"figures\" [ref=e154]\n        - group \"frontmatter\" [ref=e157]\n        - treeitem \"main.tex\" [selected] [ref=e161]\n        - treeitem \"preamble.tex\" [ref=e162]\n        - treeitem \"references.bib\" [ref=e163]\n      - navigation \"Sections\":\n        - list \"Sections\"\n    - generic [ref=e165]:\n      - generic [ref=e166]:\n        - generic [ref=e167]: main.tex\n        - button \"Delete main.tex\" [ref=e168] [cursor=pointer]\n      - generic [ref=e170]:\n        - generic [aria-hidden] [ref=e171]\n        - textbox \"Source of main.tex\" [active] [ref=e195]: \"\\\\documentclass[12pt,a4paper]{report} \\\\input{preamble} \\\\title{Working Title of the Thesis} \\\\author{Student Name} \\\\date{\\\\today} \\\\begin{document} \\\\maketitle \\\\include{frontmatter/abstract} \\\\include{frontmatter/acknowledgements} \\\\tableofcontents \\\\include{chapters/01-introduction} \\\\include{chapters/02-background} \\\\include{chapters/03-method} \\\\include{chapters/04-results} \\\\include{chapters/05-conclusion} \\\\bibliographystyle{plainnat} \\\\bibliography{references} \\\\end{document}\"\n    - complementary \"Margin\" [ref=e196]\n  - generic [ref=e197]:\n    - status\n    - status"
}
```

### Tool call: browser_snapshot
- Args
```json
{
  "target": "e146",
  "depth": 4
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/p/p_4ad4dc304e1307b8f0ec63d7?file=main.tex\n- Page Title: Marginalia\n- Console: 2 errors, 0 warnings",
  "inlineSnapshot": "- tree \"Project files\" [ref=e146]:\n  - group \"chapters\" [ref=e147]:\n    - treeitem \"▾ chapters/\" [expanded] [ref=e148]\n    - treeitem \"01-introduction.tex\" [ref=e149]\n    - treeitem \"02-background.tex\" [ref=e150]\n    - treeitem \"03-method.tex\" [ref=e151]\n    - treeitem \"04-results.tex\" [ref=e152]\n    - treeitem \"05-conclusion.tex\" [ref=e153]\n  - group \"figures\" [ref=e154]:\n    - treeitem \"▾ figures/\" [expanded] [ref=e155]\n    - treeitem \"placeholder-plot.svg\" [ref=e156]\n  - group \"frontmatter\" [ref=e157]:\n    - treeitem \"▾ frontmatter/\" [expanded] [ref=e158]\n    - treeitem \"abstract.tex\" [ref=e159]\n    - treeitem \"acknowledgements.tex\" [ref=e160]\n  - treeitem \"main.tex\" [selected] [ref=e161]\n  - treeitem \"preamble.tex\" [ref=e162]\n  - treeitem \"references.bib\" [ref=e163]"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "03-method.tex",
  "target": "e151"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/p/p_4ad4dc304e1307b8f0ec63d7?file=chapters%2F03-method.tex\n- Page Title: Marginalia\n- Console: 2 errors, 0 warnings",
  "snapshot": "- generic [ref=e198]:\n  - link \"Skip to source\" [ref=e199] [cursor=pointer]:\n    - /url: \"#source-box\"\n  - generic [ref=e200]:\n    - link \"Projects\" [ref=e201] [cursor=pointer]:\n      - /url: /\n    - generic [ref=e202]: Stub11112603\n    - button \"Save\" [ref=e203] [cursor=pointer]\n    - button \"Suggest edit\" [ref=e204] [cursor=pointer]\n    - button \"Comment\" [disabled] [ref=e205]\n    - button \"New file\" [ref=e206] [cursor=pointer]\n    - button \"Upload file\" [ref=e207] [cursor=pointer]\n    - button \"Citation warnings\" [ref=e208] [cursor=pointer]\n    - generic [ref=e209]: No undefined citations\n    - button \"History\" [ref=e210] [cursor=pointer]\n    - button \"People and sharing\" [ref=e211] [cursor=pointer]\n    - button \"Submission check\" [ref=e212] [cursor=pointer]\n  - generic [ref=e213]:\n    - complementary [ref=e214]:\n      - tree \"Project files\" [ref=e215]:\n        - group \"chapters\" [ref=e216]:\n          - treeitem \"▾ chapters/\" [expanded] [ref=e217]\n          - treeitem \"01-introduction.tex\" [ref=e218]\n          - treeitem \"02-background.tex\" [ref=e219]\n          - treeitem \"03-method.tex\" [selected] [ref=e220]\n          - treeitem \"04-results.tex\" [ref=e221]\n          - treeitem \"05-conclusion.tex\" [ref=e222]\n        - group \"figures\" [ref=e223]:\n          - treeitem \"▾ figures/\" [expanded] [ref=e224]\n          - treeitem \"placeholder-plot.svg\" [ref=e225]\n        - group \"frontmatter\" [ref=e226]:\n          - treeitem \"▾ frontmatter/\" [expanded] [ref=e227]\n          - treeitem \"abstract.tex\" [ref=e228]\n          - treeitem \"acknowledgements.tex\" [ref=e229]\n        - treeitem \"main.tex\" [ref=e230]\n        - treeitem \"preamble.tex\" [ref=e231]\n        - treeitem \"references.bib\" [ref=e232]\n      - navigation \"Sections\" [ref=e233]:\n        - list \"Sections\" [ref=e234]:\n          - listitem [ref=e235]:\n            - link \"Method\" [ref=e236] [cursor=pointer]:\n              - /url: \"#\"\n    - generic [ref=e238]:\n      - generic [ref=e239]:\n        - generic [ref=e240]: chapters/03-method.tex\n        - button \"Delete chapters/03-method.tex\" [ref=e241] [cursor=pointer]\n      - generic [ref=e243]:\n        - generic [aria-hidden] [ref=e244]:\n          - generic [ref=e245]: \"1\"\n          - generic [ref=e246]: \"2\"\n          - generic [ref=e247]: \"3\"\n          - generic [ref=e248]: \"4\"\n          - generic [ref=e249]: \"5\"\n        - textbox \"Source of chapters/03-method.tex\" [ref=e250]: \"\\\\chapter{Method} \\\\label{ch:method} Describe the method so that another lab could repeat it.\"\n    - complementary \"Margin\" [ref=e251]\n  - generic [ref=e252]:\n    - status\n    - status"
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
  "page": "- Page URL: http://127.0.0.1:4173/p/p_4ad4dc304e1307b8f0ec63d7?file=chapters%2F03-method.tex\n- Page Title: Marginalia\n- Console: 2 errors, 0 warnings",
  "inlineSnapshot": "- generic [ref=e198]:\n  - link \"Skip to source\" [ref=e199] [cursor=pointer]:\n    - /url: \"#source-box\"\n  - generic [ref=e200]:\n    - link \"Projects\" [ref=e201] [cursor=pointer]:\n      - /url: /\n    - generic [ref=e202]: Stub11112603\n    - button \"Save\" [ref=e203] [cursor=pointer]\n    - button \"Suggest edit\" [ref=e204] [cursor=pointer]\n    - button \"Comment\" [disabled] [ref=e205]\n    - button \"New file\" [ref=e206] [cursor=pointer]\n    - button \"Upload file\" [ref=e207] [cursor=pointer]\n    - button \"Citation warnings\" [ref=e208] [cursor=pointer]\n    - generic [ref=e209]: No undefined citations\n    - button \"History\" [ref=e210] [cursor=pointer]\n    - button \"People and sharing\" [ref=e211] [cursor=pointer]\n    - button \"Submission check\" [ref=e212] [cursor=pointer]\n  - generic [ref=e213]:\n    - complementary [ref=e214]:\n      - tree \"Project files\" [ref=e215]:\n        - group \"chapters\" [ref=e216]:\n          - treeitem \"▾ chapters/\" [expanded] [ref=e217]\n          - treeitem \"01-introduction.tex\" [ref=e218]\n          - treeitem \"02-background.tex\" [ref=e219]\n          - treeitem \"03-method.tex\" [selected] [ref=e220]\n          - treeitem \"04-results.tex\" [ref=e221]\n          - treeitem \"05-conclusion.tex\" [ref=e222]\n        - group \"figures\" [ref=e223]:\n          - treeitem \"▾ figures/\" [expanded] [ref=e224]\n          - treeitem \"placeholder-plot.svg\" [ref=e225]\n        - group \"frontmatter\" [ref=e226]:\n          - treeitem \"▾ frontmatter/\" [expanded] [ref=e227]\n          - treeitem \"abstract.tex\" [ref=e228]\n          - treeitem \"acknowledgements.tex\" [ref=e229]\n        - treeitem \"main.tex\" [ref=e230]\n        - treeitem \"preamble.tex\" [ref=e231]\n        - treeitem \"references.bib\" [ref=e232]\n      - navigation \"Sections\" [ref=e233]:\n        - list \"Sections\" [ref=e234]:\n          - listitem [ref=e235]\n    - generic [ref=e238]:\n      - generic [ref=e239]:\n        - generic [ref=e240]: chapters/03-method.tex\n        - button \"Delete chapters/03-method.tex\" [ref=e241] [cursor=pointer]\n      - generic [ref=e243]:\n        - generic [aria-hidden] [ref=e244]:\n          - generic [ref=e245]: \"1\"\n          - generic [ref=e246]: \"2\"\n          - generic [ref=e247]: \"3\"\n          - generic [ref=e248]: \"4\"\n          - generic [ref=e249]: \"5\"\n        - textbox \"Source of chapters/03-method.tex\" [ref=e250]: \"\\\\chapter{Method} \\\\label{ch:method} Describe the method so that another lab could repeat it.\"\n    - complementary \"Margin\" [ref=e251]\n  - generic [ref=e252]:\n    - status\n    - status"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "source textbox",
  "target": "e250"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/p/p_4ad4dc304e1307b8f0ec63d7?file=chapters%2F03-method.tex\n- Page Title: Marginalia\n- Console: 2 errors, 0 warnings",
  "snapshot": "- generic [ref=e198]:\n  - link \"Skip to source\" [ref=e199] [cursor=pointer]:\n    - /url: \"#source-box\"\n  - generic [ref=e200]:\n    - link \"Projects\" [ref=e201] [cursor=pointer]:\n      - /url: /\n    - generic [ref=e202]: Stub11112603\n    - button \"Save\" [ref=e203] [cursor=pointer]\n    - button \"Suggest edit\" [ref=e204] [cursor=pointer]\n    - button \"Comment\" [disabled] [ref=e205]\n    - button \"New file\" [ref=e206] [cursor=pointer]\n    - button \"Upload file\" [ref=e207] [cursor=pointer]\n    - button \"Citation warnings\" [ref=e208] [cursor=pointer]\n    - generic [ref=e209]: No undefined citations\n    - button \"History\" [ref=e210] [cursor=pointer]\n    - button \"People and sharing\" [ref=e211] [cursor=pointer]\n    - button \"Submission check\" [ref=e212] [cursor=pointer]\n  - generic [ref=e213]:\n    - complementary [ref=e214]:\n      - tree \"Project files\" [ref=e215]:\n        - group \"chapters\" [ref=e216]:\n          - treeitem \"▾ chapters/\" [expanded] [ref=e217]\n          - treeitem \"01-introduction.tex\" [ref=e218]\n          - treeitem \"02-background.tex\" [ref=e219]\n          - treeitem \"03-method.tex\" [selected] [ref=e220]\n          - treeitem \"04-results.tex\" [ref=e221]\n          - treeitem \"05-conclusion.tex\" [ref=e222]\n        - group \"figures\" [ref=e223]:\n          - treeitem \"▾ figures/\" [expanded] [ref=e224]\n          - treeitem \"placeholder-plot.svg\" [ref=e225]\n        - group \"frontmatter\" [ref=e226]:\n          - treeitem \"▾ frontmatter/\" [expanded] [ref=e227]\n          - treeitem \"abstract.tex\" [ref=e228]\n          - treeitem \"acknowledgements.tex\" [ref=e229]\n        - treeitem \"main.tex\" [ref=e230]\n        - treeitem \"preamble.tex\" [ref=e231]\n        - treeitem \"references.bib\" [ref=e232]\n      - navigation \"Sections\" [ref=e233]:\n        - list \"Sections\" [ref=e234]:\n          - listitem [ref=e235]:\n            - link \"Method\" [ref=e236] [cursor=pointer]:\n              - /url: \"#\"\n    - generic [ref=e238]:\n      - generic [ref=e239]:\n        - generic [ref=e240]: chapters/03-method.tex\n        - button \"Delete chapters/03-method.tex\" [ref=e241] [cursor=pointer]\n      - generic [ref=e243]:\n        - generic [aria-hidden] [ref=e244]:\n          - generic [ref=e245]: \"1\"\n          - generic [ref=e246]: \"2\"\n          - generic [ref=e247]: \"3\"\n          - generic [ref=e248]: \"4\"\n          - generic [ref=e249]: \"5\"\n        - textbox \"Source of chapters/03-method.tex\" [active] [ref=e250]: \"\\\\chapter{Method} \\\\label{ch:method} Describe the method so that another lab could repeat it.\"\n    - complementary \"Margin\" [ref=e251]\n  - generic [ref=e252]:\n    - status\n    - status"
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
  "element": "source textbox",
  "target": "e250",
  "function": "e=>({start:e.selectionStart,end:e.selectionEnd,selected:e.value.slice(e.selectionStart,e.selectionEnd)})"
}
```
- Result
```json
{
  "result": "{\n  \"start\": 89,\n  \"end\": 92,\n  \"selected\": \"it.\"\n}"
}
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
  "element": "source textbox",
  "target": "e250",
  "function": "e=>({start:e.selectionStart,end:e.selectionEnd,selected:e.value.slice(e.selectionStart,e.selectionEnd)})"
}
```
- Result
```json
{
  "result": "{\n  \"start\": 82,\n  \"end\": 92,\n  \"selected\": \"repeat it.\"\n}"
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
  "element": "source textbox",
  "target": "e250",
  "function": "e=>e.value.slice(e.selectionStart,e.selectionEnd)"
}
```
- Result
```json
{
  "result": "\"repeat it\""
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Suggest edit",
  "target": "e204"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/p/p_4ad4dc304e1307b8f0ec63d7?file=chapters%2F03-method.tex\n- Page Title: Marginalia\n- Console: 2 errors, 0 warnings",
  "snapshot": "- generic [ref=e253]:\n  - link \"Skip to source\" [ref=e254] [cursor=pointer]:\n    - /url: \"#source-box\"\n  - generic [ref=e255]:\n    - link \"Projects\" [ref=e256] [cursor=pointer]:\n      - /url: /\n    - generic [ref=e257]: Stub11112603\n    - button \"Save\" [ref=e258] [cursor=pointer]\n    - button \"Suggest edit\" [ref=e259] [cursor=pointer]\n    - button \"Comment\" [ref=e260] [cursor=pointer]\n    - button \"New file\" [ref=e261] [cursor=pointer]\n    - button \"Upload file\" [ref=e262] [cursor=pointer]\n    - button \"Citation warnings\" [ref=e263] [cursor=pointer]\n    - generic [ref=e264]: No undefined citations\n    - button \"History\" [ref=e265] [cursor=pointer]\n    - button \"People and sharing\" [ref=e266] [cursor=pointer]\n    - button \"Submission check\" [ref=e267] [cursor=pointer]\n  - generic [ref=e268]:\n    - complementary [ref=e269]:\n      - tree \"Project files\" [ref=e270]:\n        - group \"chapters\" [ref=e271]:\n          - treeitem \"▾ chapters/\" [expanded] [ref=e272]\n          - treeitem \"01-introduction.tex\" [ref=e273]\n          - treeitem \"02-background.tex\" [ref=e274]\n          - treeitem \"03-method.tex\" [selected] [ref=e275]\n          - treeitem \"04-results.tex\" [ref=e276]\n          - treeitem \"05-conclusion.tex\" [ref=e277]\n        - group \"figures\" [ref=e278]:\n          - treeitem \"▾ figures/\" [expanded] [ref=e279]\n          - treeitem \"placeholder-plot.svg\" [ref=e280]\n        - group \"frontmatter\" [ref=e281]:\n          - treeitem \"▾ frontmatter/\" [expanded] [ref=e282]\n          - treeitem \"abstract.tex\" [ref=e283]\n          - treeitem \"acknowledgements.tex\" [ref=e284]\n        - treeitem \"main.tex\" [ref=e285]\n        - treeitem \"preamble.tex\" [ref=e286]\n        - treeitem \"references.bib\" [ref=e287]\n      - navigation \"Sections\" [ref=e288]:\n        - list \"Sections\" [ref=e289]:\n          - listitem [ref=e290]:\n            - link \"Method\" [ref=e291] [cursor=pointer]:\n              - /url: \"#\"\n    - generic [ref=e293]:\n      - generic [ref=e294]:\n        - generic [ref=e295]: chapters/03-method.tex\n        - button \"Delete chapters/03-method.tex\" [ref=e296] [cursor=pointer]\n      - generic [ref=e298]:\n        - generic [aria-hidden] [ref=e299]:\n          - generic [ref=e300]: \"1\"\n          - generic [ref=e301]: \"2\"\n          - generic [ref=e302]: \"3\"\n          - generic [ref=e303]: \"4\"\n          - generic [ref=e304]: \"5\"\n        - textbox \"Source of chapters/03-method.tex\" [ref=e250]: \"\\\\chapter{Method} \\\\label{ch:method} Describe the method so that another lab could repeat it.\"\n    - complementary \"Margin\" [ref=e305]\n  - generic [ref=e306]:\n    - status\n    - status\n  - dialog [ref=e308]:\n    - heading \"Suggest edit\" [level=2] [ref=e310]\n    - generic [ref=e311]:\n      - blockquote [ref=e312]: repeat it\n      - generic [ref=e313]:\n        - generic [ref=e314]: Replacement text\n        - textbox \"Replacement text\" [active] [ref=e315]\n      - button \"Add suggestion\" [ref=e317] [cursor=pointer]"
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
  "page": "- Page URL: http://127.0.0.1:4173/p/p_4ad4dc304e1307b8f0ec63d7?file=chapters%2F03-method.tex\n- Page Title: Marginalia\n- Console: 2 errors, 0 warnings",
  "inlineSnapshot": "- generic [ref=e253]:\n  - link \"Skip to source\" [ref=e254] [cursor=pointer]:\n    - /url: \"#source-box\"\n  - generic [ref=e255]:\n    - link \"Projects\" [ref=e256] [cursor=pointer]:\n      - /url: /\n    - generic [ref=e257]: Stub11112603\n    - button \"Save\" [ref=e258] [cursor=pointer]\n    - button \"Suggest edit\" [ref=e259] [cursor=pointer]\n    - button \"Comment\" [ref=e260] [cursor=pointer]\n    - button \"New file\" [ref=e261] [cursor=pointer]\n    - button \"Upload file\" [ref=e262] [cursor=pointer]\n    - button \"Citation warnings\" [ref=e263] [cursor=pointer]\n    - generic [ref=e264]: No undefined citations\n    - button \"History\" [ref=e265] [cursor=pointer]\n    - button \"People and sharing\" [ref=e266] [cursor=pointer]\n    - button \"Submission check\" [ref=e267] [cursor=pointer]\n  - generic [ref=e268]:\n    - complementary [ref=e269]:\n      - tree \"Project files\" [ref=e270]:\n        - group \"chapters\" [ref=e271]\n        - group \"figures\" [ref=e278]\n        - group \"frontmatter\" [ref=e281]\n        - treeitem \"main.tex\" [ref=e285]\n        - treeitem \"preamble.tex\" [ref=e286]\n        - treeitem \"references.bib\" [ref=e287]\n      - navigation \"Sections\" [ref=e288]:\n        - list \"Sections\" [ref=e289]\n    - generic [ref=e293]:\n      - generic [ref=e294]:\n        - generic [ref=e295]: chapters/03-method.tex\n        - button \"Delete chapters/03-method.tex\" [ref=e296] [cursor=pointer]\n      - generic [ref=e298]:\n        - generic [aria-hidden] [ref=e299]\n        - textbox \"Source of chapters/03-method.tex\" [ref=e250]: \"\\\\chapter{Method} \\\\label{ch:method} Describe the method so that another lab could repeat it.\"\n    - complementary \"Margin\" [ref=e305]\n  - generic [ref=e306]:\n    - status\n    - status\n  - dialog \"Suggest edit\" [ref=e308]:\n    - heading \"Suggest edit\" [level=2] [ref=e310]\n    - generic [ref=e311]:\n      - blockquote [ref=e312]: repeat it\n      - generic [ref=e313]:\n        - generic [ref=e314]: Replacement text\n        - textbox \"Replacement text\" [active] [ref=e315]\n      - button \"Add suggestion\" [ref=e317] [cursor=pointer]"
}
```

### Tool call: browser_fill_form
- Args
```json
{
  "fields": [
    {
      "target": "e315",
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
  "target": "e317"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/p/p_4ad4dc304e1307b8f0ec63d7?file=chapters%2F03-method.tex\n- Page Title: Marginalia\n- Console: 2 errors, 0 warnings",
  "snapshot": "- generic [ref=e318]:\n  - link \"Skip to source\" [ref=e319] [cursor=pointer]:\n    - /url: \"#source-box\"\n  - generic [ref=e320]:\n    - link \"Projects\" [ref=e321] [cursor=pointer]:\n      - /url: /\n    - generic [ref=e322]: Stub11112603\n    - button \"Save\" [ref=e323] [cursor=pointer]\n    - button \"Suggest edit\" [ref=e324] [cursor=pointer]\n    - button \"Comment\" [ref=e325] [cursor=pointer]\n    - button \"New file\" [ref=e326] [cursor=pointer]\n    - button \"Upload file\" [ref=e327] [cursor=pointer]\n    - button \"Citation warnings\" [ref=e328] [cursor=pointer]\n    - generic [ref=e329]: No undefined citations\n    - button \"History\" [ref=e330] [cursor=pointer]\n    - button \"People and sharing\" [ref=e331] [cursor=pointer]\n    - button \"Submission check\" [ref=e332] [cursor=pointer]\n  - generic [ref=e333]:\n    - complementary [ref=e334]:\n      - tree \"Project files\" [ref=e335]:\n        - group \"chapters\" [ref=e336]:\n          - treeitem \"▾ chapters/\" [expanded] [ref=e337]\n          - treeitem \"01-introduction.tex\" [ref=e338]\n          - treeitem \"02-background.tex\" [ref=e339]\n          - treeitem \"03-method.tex\" [selected] [ref=e340]\n          - treeitem \"04-results.tex\" [ref=e341]\n          - treeitem \"05-conclusion.tex\" [ref=e342]\n        - group \"figures\" [ref=e343]:\n          - treeitem \"▾ figures/\" [expanded] [ref=e344]\n          - treeitem \"placeholder-plot.svg\" [ref=e345]\n        - group \"frontmatter\" [ref=e346]:\n          - treeitem \"▾ frontmatter/\" [expanded] [ref=e347]\n          - treeitem \"abstract.tex\" [ref=e348]\n          - treeitem \"acknowledgements.tex\" [ref=e349]\n        - treeitem \"main.tex\" [ref=e350]\n        - treeitem \"preamble.tex\" [ref=e351]\n        - treeitem \"references.bib\" [ref=e352]\n      - navigation \"Sections\" [ref=e353]:\n        - list \"Sections\" [ref=e354]:\n          - listitem [ref=e355]:\n            - link \"Method\" [ref=e356] [cursor=pointer]:\n              - /url: \"#\"\n    - generic [ref=e358]:\n      - generic [ref=e359]:\n        - generic [ref=e360]: chapters/03-method.tex\n        - button \"Delete chapters/03-method.tex\" [ref=e361] [cursor=pointer]\n      - generic [ref=e363]:\n        - generic [aria-hidden] [ref=e364]:\n          - generic [ref=e365]: \"1\"\n          - generic [ref=e366]: \"2\"\n          - generic [ref=e367]: \"3\"\n          - generic [ref=e368]: \"4\"\n          - generic [ref=e369]: \"5\"\n        - textbox \"Source of chapters/03-method.tex\" [ref=e250]: \"\\\\chapter{Method} \\\\label{ch:method} Describe the method so that another lab could repeat it.\"\n    - complementary \"Margin\" [ref=e370]\n  - generic [ref=e371]:\n    - status [ref=e372]: Suggestion added\n    - status"
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
  "page": "- Page URL: http://127.0.0.1:4173/p/p_4ad4dc304e1307b8f0ec63d7?file=chapters%2F03-method.tex\n- Page Title: Marginalia\n- Console: 2 errors, 0 warnings",
  "inlineSnapshot": "- generic [ref=e318]:\n  - link \"Skip to source\" [ref=e319] [cursor=pointer]:\n    - /url: \"#source-box\"\n  - generic [ref=e320]:\n    - link \"Projects\" [ref=e321] [cursor=pointer]:\n      - /url: /\n    - generic [ref=e322]: Stub11112603\n    - button \"Save\" [ref=e323] [cursor=pointer]\n    - button \"Suggest edit\" [ref=e324] [cursor=pointer]\n    - button \"Comment\" [ref=e325] [cursor=pointer]\n    - button \"New file\" [ref=e326] [cursor=pointer]\n    - button \"Upload file\" [ref=e327] [cursor=pointer]\n    - button \"Citation warnings\" [ref=e328] [cursor=pointer]\n    - generic [ref=e329]: No undefined citations\n    - button \"History\" [ref=e330] [cursor=pointer]\n    - button \"People and sharing\" [ref=e331] [cursor=pointer]\n    - button \"Submission check\" [ref=e332] [cursor=pointer]\n  - generic [ref=e333]:\n    - complementary [ref=e334]:\n      - tree \"Project files\" [ref=e335]:\n        - group \"chapters\" [ref=e336]:\n          - treeitem \"▾ chapters/\" [expanded] [ref=e337]\n          - treeitem \"01-introduction.tex\" [ref=e338]\n          - treeitem \"02-background.tex\" [ref=e339]\n          - treeitem \"03-method.tex\" [selected] [ref=e340]\n          - treeitem \"04-results.tex\" [ref=e341]\n          - treeitem \"05-conclusion.tex\" [ref=e342]\n        - group \"figures\" [ref=e343]:\n          - treeitem \"▾ figures/\" [expanded] [ref=e344]\n          - treeitem \"placeholder-plot.svg\" [ref=e345]\n        - group \"frontmatter\" [ref=e346]:\n          - treeitem \"▾ frontmatter/\" [expanded] [ref=e347]\n          - treeitem \"abstract.tex\" [ref=e348]\n          - treeitem \"acknowledgements.tex\" [ref=e349]\n        - treeitem \"main.tex\" [ref=e350]\n        - treeitem \"preamble.tex\" [ref=e351]\n        - treeitem \"references.bib\" [ref=e352]\n      - navigation \"Sections\" [ref=e353]:\n        - list \"Sections\" [ref=e354]:\n          - listitem [ref=e355]\n    - generic [ref=e358]:\n      - generic [ref=e359]:\n        - generic [ref=e360]: chapters/03-method.tex\n        - button \"Delete chapters/03-method.tex\" [ref=e361] [cursor=pointer]\n      - generic [ref=e363]:\n        - generic [aria-hidden] [ref=e364]:\n          - generic [ref=e365]: \"1\"\n          - generic [ref=e366]: \"2\"\n          - generic [ref=e367]: \"3\"\n          - generic [ref=e368]: \"4\"\n          - generic [ref=e369]: \"5\"\n        - textbox \"Source of chapters/03-method.tex\" [ref=e250]: \"\\\\chapter{Method} \\\\label{ch:method} Describe the method so that another lab could repeat it.\"\n    - complementary \"Margin\" [ref=e370]\n  - generic [ref=e371]:\n    - status [ref=e372]: Suggestion added\n    - status"
}
```

### Tool call: browser_snapshot
- Args
```json
{
  "depth": 7
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/p/p_4ad4dc304e1307b8f0ec63d7?file=chapters%2F03-method.tex\n- Page Title: Marginalia\n- Console: 2 errors, 0 warnings",
  "inlineSnapshot": "- generic [ref=e318]:\n  - link \"Skip to source\" [ref=e319] [cursor=pointer]:\n    - /url: \"#source-box\"\n  - generic [ref=e320]:\n    - link \"Projects\" [ref=e321] [cursor=pointer]:\n      - /url: /\n    - generic [ref=e322]: Stub11112603\n    - button \"Save\" [ref=e323] [cursor=pointer]\n    - button \"Suggest edit\" [ref=e324] [cursor=pointer]\n    - button \"Comment\" [ref=e325] [cursor=pointer]\n    - button \"New file\" [ref=e326] [cursor=pointer]\n    - button \"Upload file\" [ref=e327] [cursor=pointer]\n    - button \"Citation warnings\" [ref=e328] [cursor=pointer]\n    - generic [ref=e329]: No undefined citations\n    - button \"History\" [ref=e330] [cursor=pointer]\n    - button \"People and sharing\" [ref=e331] [cursor=pointer]\n    - button \"Submission check\" [ref=e332] [cursor=pointer]\n  - generic [ref=e333]:\n    - complementary [ref=e334]:\n      - tree \"Project files\" [ref=e335]:\n        - group \"chapters\" [ref=e336]:\n          - treeitem \"▾ chapters/\" [expanded] [ref=e337]\n          - treeitem \"01-introduction.tex\" [ref=e338]\n          - treeitem \"02-background.tex\" [ref=e339]\n          - treeitem \"03-method.tex\" [selected] [ref=e340]\n          - treeitem \"04-results.tex\" [ref=e341]\n          - treeitem \"05-conclusion.tex\" [ref=e342]\n        - group \"figures\" [ref=e343]:\n          - treeitem \"▾ figures/\" [expanded] [ref=e344]\n          - treeitem \"placeholder-plot.svg\" [ref=e345]\n        - group \"frontmatter\" [ref=e346]:\n          - treeitem \"▾ frontmatter/\" [expanded] [ref=e347]\n          - treeitem \"abstract.tex\" [ref=e348]\n          - treeitem \"acknowledgements.tex\" [ref=e349]\n        - treeitem \"main.tex\" [ref=e350]\n        - treeitem \"preamble.tex\" [ref=e351]\n        - treeitem \"references.bib\" [ref=e352]\n      - navigation \"Sections\" [ref=e353]:\n        - list \"Sections\" [ref=e354]:\n          - listitem [ref=e355]:\n            - link \"Method\" [ref=e356] [cursor=pointer]:\n              - /url: \"#\"\n    - generic [ref=e358]:\n      - generic [ref=e359]:\n        - generic [ref=e360]: chapters/03-method.tex\n        - button \"Delete chapters/03-method.tex\" [ref=e361] [cursor=pointer]\n      - generic [ref=e363]:\n        - generic [aria-hidden] [ref=e364]:\n          - generic [ref=e365]: \"1\"\n          - generic [ref=e366]: \"2\"\n          - generic [ref=e367]: \"3\"\n          - generic [ref=e368]: \"4\"\n          - generic [ref=e369]: \"5\"\n        - textbox \"Source of chapters/03-method.tex\" [ref=e250]: \"\\\\chapter{Method} \\\\label{ch:method} Describe the method so that another lab could repeat it.\"\n    - complementary \"Margin\" [ref=e370]\n  - generic [ref=e371]:\n    - status [ref=e372]: Suggestion added\n    - status"
}
```

### Tool call: browser_navigate
- Args
```json
{
  "url": "http://127.0.0.1:4173/p/p_4ad4dc304e1307b8f0ec63d7?file=chapters%2F03-method.tex"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/p/p_4ad4dc304e1307b8f0ec63d7?file=chapters%2F03-method.tex\n- Page Title: Marginalia",
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
  "page": "- Page URL: http://127.0.0.1:4173/p/p_4ad4dc304e1307b8f0ec63d7?file=chapters%2F03-method.tex\n- Page Title: Marginalia",
  "inlineSnapshot": "- generic [ref=f1e22]:\n  - link \"Skip to source\" [ref=f1e23] [cursor=pointer]:\n    - /url: \"#source-box\"\n  - generic [ref=f1e24]:\n    - link \"Projects\" [ref=f1e25] [cursor=pointer]:\n      - /url: /\n    - generic [ref=f1e26]: Stub11112603\n    - button \"Save\" [ref=f1e27] [cursor=pointer]\n    - button \"Suggest edit\" [disabled] [ref=f1e28]\n    - button \"Comment\" [disabled] [ref=f1e29]\n    - button \"New file\" [ref=f1e30] [cursor=pointer]\n    - button \"Upload file\" [ref=f1e31] [cursor=pointer]\n    - button \"Citation warnings\" [ref=f1e32] [cursor=pointer]\n    - generic [ref=f1e33]: No undefined citations\n    - button \"History\" [ref=f1e34] [cursor=pointer]\n    - button \"People and sharing\" [ref=f1e35] [cursor=pointer]\n    - button \"Submission check\" [ref=f1e36] [cursor=pointer]\n  - generic [ref=f1e37]:\n    - complementary [ref=f1e38]:\n      - tree \"Project files\" [ref=f1e39]:\n        - group \"chapters\" [ref=f1e40]:\n          - treeitem \"▾ chapters/\" [expanded] [ref=f1e41]\n          - treeitem \"01-introduction.tex\" [ref=f1e42]\n          - treeitem \"02-background.tex\" [ref=f1e43]\n          - treeitem \"03-method.tex\" [selected] [ref=f1e44]\n          - treeitem \"04-results.tex\" [ref=f1e45]\n          - treeitem \"05-conclusion.tex\" [ref=f1e46]\n        - group \"figures\" [ref=f1e47]:\n          - treeitem \"▾ figures/\" [expanded] [ref=f1e48]\n          - treeitem \"placeholder-plot.svg\" [ref=f1e49]\n        - group \"frontmatter\" [ref=f1e50]:\n          - treeitem \"▾ frontmatter/\" [expanded] [ref=f1e51]\n          - treeitem \"abstract.tex\" [ref=f1e52]\n          - treeitem \"acknowledgements.tex\" [ref=f1e53]\n        - treeitem \"main.tex\" [ref=f1e54]\n        - treeitem \"preamble.tex\" [ref=f1e55]\n        - treeitem \"references.bib\" [ref=f1e56]\n      - navigation \"Sections\" [ref=f1e57]:\n        - list \"Sections\" [ref=f1e58]:\n          - listitem [ref=f1e59]:\n            - link \"Method\" [ref=f1e60] [cursor=pointer]:\n              - /url: \"#\"\n    - generic [ref=f1e62]:\n      - generic [ref=f1e63]:\n        - generic [ref=f1e64]: chapters/03-method.tex\n        - button \"Delete chapters/03-method.tex\" [ref=f1e65] [cursor=pointer]\n      - generic [ref=f1e67]:\n        - generic [aria-hidden] [ref=f1e68]:\n          - generic [ref=f1e69]: \"1\"\n          - generic [ref=f1e70]: \"2\"\n          - generic [ref=f1e71]: \"3\"\n          - generic [ref=f1e72]: \"4\"\n          - generic [ref=f1e73]: \"5\"\n        - textbox \"Source of chapters/03-method.tex\" [ref=f1e74]: \"\\\\chapter{Method} \\\\label{ch:method} Describe the method so that another lab could repeat it.\"\n    - complementary \"Margin\" [ref=f1e75]:\n      - article \"Suggestion by Ilse Varga\" [ref=f1e76]:\n        - heading \"Ilse Varga @ilsevarga\" [level=3] [ref=f1e77]\n        - blockquote [ref=f1e78]: repeat it\n        - paragraph [ref=f1e79]:\n          - deletion [ref=f1e80]: repeat it\n          - insertion [ref=f1e81]: reproduce it\n        - generic [ref=f1e82]:\n          - button \"Accept\" [ref=f1e83] [cursor=pointer]\n          - button \"Reject\" [ref=f1e84] [cursor=pointer]\n  - generic [ref=f1e85]:\n    - status\n    - status"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Accept suggestion",
  "target": "f1e83"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/p/p_4ad4dc304e1307b8f0ec63d7?file=chapters%2F03-method.tex\n- Page Title: Marginalia",
  "snapshot": "- generic [ref=f1e86]:\n  - link \"Skip to source\" [ref=f1e87] [cursor=pointer]:\n    - /url: \"#source-box\"\n  - generic [ref=f1e88]:\n    - link \"Projects\" [ref=f1e89] [cursor=pointer]:\n      - /url: /\n    - generic [ref=f1e90]: Stub11112603\n    - button \"Save\" [ref=f1e91] [cursor=pointer]\n    - button \"Suggest edit\" [ref=f1e92] [cursor=pointer]\n    - button \"Comment\" [disabled] [ref=f1e93]\n    - button \"New file\" [ref=f1e94] [cursor=pointer]\n    - button \"Upload file\" [ref=f1e95] [cursor=pointer]\n    - button \"Citation warnings\" [ref=f1e96] [cursor=pointer]\n    - generic [ref=f1e97]: No undefined citations\n    - button \"History\" [ref=f1e98] [cursor=pointer]\n    - button \"People and sharing\" [ref=f1e99] [cursor=pointer]\n    - button \"Submission check\" [ref=f1e100] [cursor=pointer]\n  - generic [ref=f1e101]:\n    - complementary [ref=f1e102]:\n      - tree \"Project files\" [ref=f1e103]:\n        - group \"chapters\" [ref=f1e104]:\n          - treeitem \"▾ chapters/\" [expanded] [ref=f1e105]\n          - treeitem \"01-introduction.tex\" [ref=f1e106]\n          - treeitem \"02-background.tex\" [ref=f1e107]\n          - treeitem \"03-method.tex\" [selected] [ref=f1e108]\n          - treeitem \"04-results.tex\" [ref=f1e109]\n          - treeitem \"05-conclusion.tex\" [ref=f1e110]\n        - group \"figures\" [ref=f1e111]:\n          - treeitem \"▾ figures/\" [expanded] [ref=f1e112]\n          - treeitem \"placeholder-plot.svg\" [ref=f1e113]\n        - group \"frontmatter\" [ref=f1e114]:\n          - treeitem \"▾ frontmatter/\" [expanded] [ref=f1e115]\n          - treeitem \"abstract.tex\" [ref=f1e116]\n          - treeitem \"acknowledgements.tex\" [ref=f1e117]\n        - treeitem \"main.tex\" [ref=f1e118]\n        - treeitem \"preamble.tex\" [ref=f1e119]\n        - treeitem \"references.bib\" [ref=f1e120]\n      - navigation \"Sections\" [ref=f1e121]:\n        - list \"Sections\" [ref=f1e122]:\n          - listitem [ref=f1e123]:\n            - link \"Method\" [ref=f1e124] [cursor=pointer]:\n              - /url: \"#\"\n    - generic [ref=f1e126]:\n      - generic [ref=f1e127]:\n        - generic [ref=f1e128]: chapters/03-method.tex\n        - button \"Delete chapters/03-method.tex\" [ref=f1e129] [cursor=pointer]\n      - generic [ref=f1e131]:\n        - generic [aria-hidden] [ref=f1e132]:\n          - generic [ref=f1e133]: \"1\"\n          - generic [ref=f1e134]: \"2\"\n          - generic [ref=f1e135]: \"3\"\n          - generic [ref=f1e136]: \"4\"\n          - generic [ref=f1e137]: \"5\"\n        - textbox \"Source of chapters/03-method.tex\" [active] [ref=f1e74]: \"\\\\chapter{Method} \\\\label{ch:method} Describe the method so that another lab could repeat it.\"\n    - complementary \"Margin\" [ref=f1e138]:\n      - article \"Suggestion by Ilse Varga\" [ref=f1e139]:\n        - paragraph [ref=f1e140]: Accepted by Ilse Varga\n  - generic [ref=f1e141]:\n    - status [ref=f1e142]: Suggestion accepted, 0 open remain\n    - status"
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
  "page": "- Page URL: http://127.0.0.1:4173/p/p_4ad4dc304e1307b8f0ec63d7?file=chapters%2F03-method.tex\n- Page Title: Marginalia",
  "inlineSnapshot": "- generic [ref=f1e86]:\n  - link \"Skip to source\" [ref=f1e87] [cursor=pointer]:\n    - /url: \"#source-box\"\n  - generic [ref=f1e88]:\n    - link \"Projects\" [ref=f1e89] [cursor=pointer]:\n      - /url: /\n    - generic [ref=f1e90]: Stub11112603\n    - button \"Save\" [ref=f1e91] [cursor=pointer]\n    - button \"Suggest edit\" [ref=f1e92] [cursor=pointer]\n    - button \"Comment\" [disabled] [ref=f1e93]\n    - button \"New file\" [ref=f1e94] [cursor=pointer]\n    - button \"Upload file\" [ref=f1e95] [cursor=pointer]\n    - button \"Citation warnings\" [ref=f1e96] [cursor=pointer]\n    - generic [ref=f1e97]: No undefined citations\n    - button \"History\" [ref=f1e98] [cursor=pointer]\n    - button \"People and sharing\" [ref=f1e99] [cursor=pointer]\n    - button \"Submission check\" [ref=f1e100] [cursor=pointer]\n  - generic [ref=f1e101]:\n    - complementary [ref=f1e102]:\n      - tree \"Project files\" [ref=f1e103]:\n        - group \"chapters\" [ref=f1e104]:\n          - treeitem \"▾ chapters/\" [expanded] [ref=f1e105]\n          - treeitem \"01-introduction.tex\" [ref=f1e106]\n          - treeitem \"02-background.tex\" [ref=f1e107]\n          - treeitem \"03-method.tex\" [selected] [ref=f1e108]\n          - treeitem \"04-results.tex\" [ref=f1e109]\n          - treeitem \"05-conclusion.tex\" [ref=f1e110]\n        - group \"figures\" [ref=f1e111]:\n          - treeitem \"▾ figures/\" [expanded] [ref=f1e112]\n          - treeitem \"placeholder-plot.svg\" [ref=f1e113]\n        - group \"frontmatter\" [ref=f1e114]:\n          - treeitem \"▾ frontmatter/\" [expanded] [ref=f1e115]\n          - treeitem \"abstract.tex\" [ref=f1e116]\n          - treeitem \"acknowledgements.tex\" [ref=f1e117]\n        - treeitem \"main.tex\" [ref=f1e118]\n        - treeitem \"preamble.tex\" [ref=f1e119]\n        - treeitem \"references.bib\" [ref=f1e120]\n      - navigation \"Sections\" [ref=f1e121]:\n        - list \"Sections\" [ref=f1e122]:\n          - listitem [ref=f1e123]:\n            - link \"Method\" [ref=f1e124] [cursor=pointer]:\n              - /url: \"#\"\n    - generic [ref=f1e126]:\n      - generic [ref=f1e127]:\n        - generic [ref=f1e128]: chapters/03-method.tex\n        - button \"Delete chapters/03-method.tex\" [ref=f1e129] [cursor=pointer]\n      - generic [ref=f1e131]:\n        - generic [aria-hidden] [ref=f1e132]:\n          - generic [ref=f1e133]: \"1\"\n          - generic [ref=f1e134]: \"2\"\n          - generic [ref=f1e135]: \"3\"\n          - generic [ref=f1e136]: \"4\"\n          - generic [ref=f1e137]: \"5\"\n        - textbox \"Source of chapters/03-method.tex\" [active] [ref=f1e74]: \"\\\\chapter{Method} \\\\label{ch:method} Describe the method so that another lab could repeat it.\"\n    - complementary \"Margin\" [ref=f1e138]:\n      - article \"Suggestion by Ilse Varga\" [ref=f1e139]:\n        - paragraph [ref=f1e140]: Accepted by Ilse Varga\n  - generic [ref=f1e141]:\n    - status [ref=f1e142]: Suggestion accepted, 0 open remain\n    - status"
}
```

### Tool call: browser_take_screenshot
- Args
```json
{
  "scale": "css"
}
```
- Result
```json
{
  "result": "- [Screenshot of viewport](evidence/reduced/page-2026-11-11T15-09-13-311Z.png)",
  "attachments": [
    {
      "type": "image",
      "data": "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sh7ivLDk+/zY5xcsWJC8Ezg0ZPg7rHCGv0M3JueExktJSUluhxXUDrd2CDEZllUzZcqUtp8sWbKkPcyXki95w/A///nPsDiZfjk3FPWML2aEZczQlpMmTQojH334UZWquzvzH//4R/Xq1cOek9mZXnI/NWvUTD+4aPGi8Pe3336bPvyyZvvXhYeoPuaYY956663GjRuvWrnqs08/+/P1fw7jYdl5zuw5ZU4vk35X4XoLnVgoeRXJkeT1pj0Mrbt6zeqDn0n6+bv3kC9l5aqViX0ce+yxZcqUadSoUWjXEwufeP7554fzTBzYrl27vvrqq9QOqekHK1SokNwIS81XXH5FuKiwwJ7+ywEAABCPQwrgsEzau1fvfv36VateLU+ePEOGDPlu7n8+6xvSa++mypTYvn179uzZm13b7K4773pu7HPpk29fYQ/7Gdy5e/Dss8/u179f2Pj4k4/bt9/9AeCed+++3feLGV+0a9dur5eE6s6cJfOXX3657972+gBtmnCSw4cPv+aaa8IFHnHEEU2aNgklvHv+jp1Vq1YdMXJE4lc5yJkcovCWPvvcsyHC3w3eeff+Ifc/88wzYZn9QPPD27Vjx45RT46qWLHifs9n567d70DaB6oBAABic0i3QIfl05w5c9a7sF6o30S6iCpSpEj4e+nSpcmHIbKmT5++e2tXImvWrAPvHRgWgdeuXTts2LCD77948eIhF8NR0ka++eab5IJwgeMKpORNCUuXc+fMrVC+QvizdNnSsL66devWk046aa/9nHLKKeHv9D+Ia+bMmcmNk08++ccff0wbT/uJVsGdd905dOjQmbNmTv98etpvISp1aql58+YlP2+cvLRZs2YlDtlBzuTQhbeuRMkSLVu1HD5ieMmSJT+a/NFBJoc3sFSpUiGY00a+nvV1yPjkdviuQZHCRa5pfE3H1I4H+l4AAADAH9shBXCpkqXWb1ifjNvvv//+nUnvJMePPfbYUMWpHVK//vrrRYsWdevabXdf7YmuzJkzh1Xf7Dmyh7x89JFH586de5D958uXr1WrVt27dZ8xY8aKFSv69O6zadOmUGvJZytXqRwCtUrVKqHxwp+wJvzA/Q+Etei0l2fKnCltPy1btOzapWsI5mXLlj388MM33XjTunXrwlMhIx944IHXX389lPPHkz9OfoY52LJ5S1hMDlf36R5pkVyn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cL/XOPmjyY0bN570zqTG1zQOlfvWW2/tO2f+/PmFCxcO++nZq+e777w7eNDgBAAAAL97GQjgSy695NYOt4YF1Tx58jw/9vlLLrmkTp06YVW2TJkyN95441NPPrXvSw4+LTU19brrrqtatWrYDtXauk3r8uXLh9XUWrVq1buw3tNPP52cFtZ1ixUrljVr1gsuuKBatWpTPpkSBsNa9JtvvNmrd6/SpUuH1dqw2vzY448dZD9LliwpWLBgoUKF8ufPHw7aunXr/V5jrfNqJS/w8isuDyU8bty4fecUKVKkUaNGefPmrVKlSvfbuk+YMGHnjp0JAAAAft8y8Bng9Df6fvnll1OmTBkzZkz6CTt27MiSJUv6kYNPS9vhrl27vvrqq9QOqemnVahQIbmRfp8p+VJWrloZNn744Yfwd4kSJZLj2bJlS0lJOch+ateu3aZNm59/+rlsubLlypWrXr16Yn/SH+vU0059feLrB58T8nv9+vULFy0sWrRoAgAAgN+xX/lDsHbs3NGufbtWrVr9JtN27dwVqnjUk6MqVqyYyIhQvMlPFP/ifs4595xp06ZNfGPi7G9nd+nc5cL6F95xxx2/uP8d23ckDkE4aAIAAIDft1/5e4BLlSo1Z86ctIdLlixZtXLVr56WOUvm3TNn/2fm17O+Pvh9xUWKFAl/L126NPlw586d06dPP8h+1q1bl+2IbJdddlmXrl0G3jvwjYlv7He3mzZtSttevGhxyZIlDz5n0aJFRx555IknnpgAAADg9+1XBnDz5s2nfDJl5MiRIWg//PDDzp06jxo16ldPCzp17vTQQw+9+caba9aseenFl9q2bTv548kHOYFjjz223oX1Ujukfv3116FCu3Xt1jG1Y2jdA+3nrz3+Gv4k2/XTTz895phjwsaGDRvq1ql7//33p+32ow8/mjp16pbNW15+6eURI0Y0b9F830OH6n7xhRfDqu+UKVNu637bDX+54YgjjkgAAADw+/Yrb4EOATls+LAOHToMum9QlixZrr/++nbt2/3qaUG1atW6du3ao0ePjRs35s2bt2PHjjVq1Dj4OfTs2XNA/wHt2rVbvmx5mTJlho8YHlaAD7Sf3n16P/zww40aNfp+/vdh8t09707s+eRwmJb+FxfXrFlz2NBhkydPLn166dtuv61y5cr7HrdYsWILFy6sUKHC8ccdHyL8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BgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAYAACAKAhgAAIAoCGAAAACiIIABAACIggAGAAAgCgIYAACAKAhgAAAAoiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAYAACAKAhgAAIAoCGAAAACiIIABAACIggAGAAAgCgIYAACAKAhgAAAAoiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAYAACAKAhgAAIAoCGAAAACiIIABAACIggAGAAAgCgIYAACAKAhgAAAAoiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAYAACAKAhgAAIAoCGAAAACiIIABAACIggAGAAAgCgIYAACAKAhgAAAAoiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAYAACAKAhgAAIAoCGAAAACiIIABAACIggAGAAAgCgIYAACAKAhgAAAAoiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAYAACAKAhgAAIAoCGAAAACiIIABAACIggAGAAAgCgIYAACAKAhgAAAAoiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAYAACAKAhgAAIAoCGAAAACiIIABAACIggAGAAAgCgIYAACAKAhgAAAAoiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAYAACAKAhgAAIAoCGAAAACiIIABAACIggAGAAAgCgIYAACAKAhgAAAAoiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAYAACAKAhgAAIAoCGAAAACiIIABAACIggAGAAAgCgIYAACAKAhgAAAAoiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAYAACAKAhgAAIAoCGAAAACiIIABAACIggAGAAAgCgIYAACAKAhgAAAAoiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAYAACAKAhgAAIAoCGAAAACiIIABAACIggAGAAAgCgIYAACAKAhgAAAAoiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAYAACAKAhgAAIAoCGAAAACiIIABAACIggAGAAAgCgIYAACAKAhgAAAAoiCAAQAAiIIA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",
      "mimeType": "image/png"
    }
  ]
}
```
