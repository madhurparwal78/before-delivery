
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
  "url": "http://127.0.0.1:4173/boards/KW-0005"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/boards/KW-0005\n- Page Title: Kerfwell Rack\n- Console: 2 errors, 0 warnings",
  "snapshot": "- generic [ref=e2]:\n  - banner [ref=e3]:\n    - link \"Kerfwell\" [ref=e4] [cursor=pointer]:\n      - /url: /\n    - navigation [ref=e5]:\n      - link \"Sign in\" [ref=e6] [cursor=pointer]:\n        - /url: /sign-in\n  - status \"Service notice\"\n  - main [ref=e7]:\n    - paragraph [ref=e9]: Loading board KW-0005…",
  "events": "- New console entries: evidence/reduced/console-2026-11-05T15-50-31-518Z.log#L1"
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
  "page": "- Page URL: http://127.0.0.1:4173/boards/KW-0005\n- Page Title: Kerfwell Rack\n- Console: 2 errors, 0 warnings",
  "inlineSnapshot": "- generic [ref=e2]:\n  - banner [ref=e3]:\n    - link \"Kerfwell\" [ref=e4] [cursor=pointer]:\n      - /url: /\n    - navigation [ref=e5]:\n      - link \"Sign in\" [ref=e6] [cursor=pointer]:\n        - /url: /sign-in\n  - status \"Service notice\"\n  - main [ref=e7]:\n    - generic [ref=e8]:\n      - generic [ref=e10]:\n        - heading \"KW-0005\" [level=1] [ref=e11]\n        - generic [ref=e12]: Available\n      - generic [ref=e13]:\n        - generic [ref=e14]: Heart pine · Select\n        - generic [ref=e15]: Pell Street shoe factory (1924)\n        - generic [ref=e16]: 1600 ¢/bd ft\n        - generic [ref=e17]: 3050 mm × 140 mm × 38 mm\n      - group \"Units\" [ref=e18]:\n        - radiogroup \"Units\" [ref=e20]:\n          - generic [ref=e21]:\n            - radio \"Millimetres\" [checked] [ref=e22]\n            - text: Millimetres\n          - generic [ref=e23]:\n            - radio \"Inches\" [ref=e24]\n            - text: Inches\n      - img \"Board elevation KW-0005\" [ref=e26]:\n        - generic [ref=e27]: \"0\"\n        - generic [ref=e28]: \"500\"\n        - generic [ref=e29]: \"1000\"\n        - generic [ref=e30]: \"1500\"\n        - generic [ref=e31]: \"2000\"\n        - generic [ref=e32]: \"2500\"\n        - generic [ref=e33]: \"3000\"\n      - region \"Layout\" [ref=e34]:\n        - group \"Cut list\"\n        - generic [ref=e35]:\n          - button \"Undo\" [disabled] [ref=e36]\n          - button \"Redo\" [disabled] [ref=e37]\n        - generic [ref=e38]:\n          - generic [ref=e39]:\n            - generic [ref=e40]: Piece label\n            - textbox \"Piece label\" [ref=e41]\n          - generic [ref=e42]:\n            - generic [ref=e43]: Piece length\n            - textbox \"Piece length\" [ref=e44]\n          - generic [ref=e45]:\n            - generic [ref=e46]: Piece width\n            - textbox \"Piece width\" [ref=e47]\n          - button \"Add piece\" [ref=e49] [cursor=pointer]\n        - button \"Fit check\" [ref=e51] [cursor=pointer]\n        - status \"Fit result\" [ref=e52]\n        - status \"Hold status\" [ref=e53]\n        - status \"Layout totals\" [ref=e54]: Add a piece to see the take and price.\n        - link \"Sign in to hold\" [ref=e56] [cursor=pointer]:\n          - /url: /sign-in?next=%2Fboards%2FKW-0005",
  "events": "- New console entries: evidence/reduced/console-2026-11-05T15-50-31-518Z.log#L2"
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
  "page": "- Page URL: http://127.0.0.1:4173/boards/KW-0005\n- Page Title: Kerfwell Rack\n- Console: 3 errors, 0 warnings",
  "inlineSnapshot": "- generic [ref=e2]:\n  - banner [ref=e3]:\n    - link \"Kerfwell\" [ref=e4] [cursor=pointer]:\n      - /url: /\n    - navigation [ref=e5]:\n      - link \"Sign in\" [ref=e6] [cursor=pointer]:\n        - /url: /sign-in\n  - status \"Service notice\"\n  - main [ref=e7]:\n    - generic [ref=e8]:\n      - generic [ref=e57]:\n        - heading \"KW-0005\" [level=1] [ref=e58]\n        - generic [ref=e59]: Available\n      - generic [ref=e60]:\n        - generic [ref=e61]: Heart pine · Select\n        - generic [ref=e62]: Pell Street shoe factory (1924)\n        - generic [ref=e63]: 1600 ¢/bd ft\n        - generic [ref=e64]: 3050 mm × 140 mm × 38 mm\n      - group \"Units\" [ref=e65]:\n        - radiogroup \"Units\" [ref=e67]:\n          - generic [ref=e68]:\n            - radio \"Millimetres\" [checked] [ref=e69]\n            - text: Millimetres\n          - generic [ref=e70]:\n            - radio \"Inches\" [ref=e71]\n            - text: Inches\n      - img \"Board elevation KW-0005\" [ref=e73]:\n        - generic [ref=e74]: \"0\"\n        - generic [ref=e75]: \"500\"\n        - generic [ref=e76]: \"1000\"\n        - generic [ref=e77]: \"1500\"\n        - generic [ref=e78]: \"2000\"\n        - generic [ref=e79]: \"2500\"\n        - generic [ref=e80]: \"3000\"\n      - region \"Layout\" [ref=e81]:\n        - group \"Cut list\"\n        - generic [ref=e82]:\n          - button \"Undo\" [disabled] [ref=e83]\n          - button \"Redo\" [disabled] [ref=e84]\n        - generic [ref=e85]:\n          - generic [ref=e86]:\n            - generic [ref=e87]: Piece label\n            - textbox \"Piece label\" [ref=e88]\n          - generic [ref=e89]:\n            - generic [ref=e90]: Piece length\n            - textbox \"Piece length\" [ref=e91]\n          - generic [ref=e92]:\n            - generic [ref=e93]: Piece width\n            - textbox \"Piece width\" [ref=e94]\n          - button \"Add piece\" [ref=e96] [cursor=pointer]\n        - button \"Fit check\" [ref=e98] [cursor=pointer]\n        - status \"Fit result\" [ref=e99]\n        - status \"Hold status\" [ref=e100]\n        - status \"Layout totals\" [ref=e101]: Add a piece to see the take and price.\n        - link \"Sign in to hold\" [ref=e103] [cursor=pointer]:\n          - /url: /sign-in?next=%2Fboards%2FKW-0005",
  "events": "- New console entries: evidence/reduced/console-2026-11-05T15-50-31-518Z.log#L3"
}
```

### Tool call: browser_evaluate
- Args
```json
{
  "function": "() => [...document.querySelectorAll('button,input')].map(e=>({tag:e.tagName,id:e.id,name:e.getAttribute('name'),text:e.textContent,aria:e.getAttribute('aria-label')}))"
}
```
- Result
```json
{
  "result": "[\n  {\n    \"tag\": \"INPUT\",\n    \"id\": \"\",\n    \"name\": \"units\",\n    \"text\": \"\",\n    \"aria\": null\n  },\n  {\n    \"tag\": \"INPUT\",\n    \"id\": \"\",\n    \"name\": \"units\",\n    \"text\": \"\",\n    \"aria\": null\n  },\n  {\n    \"tag\": \"BUTTON\",\n    \"id\": \"undo\",\n    \"name\": null,\n    \"text\": \"Undo\",\n    \"aria\": null\n  },\n  {\n    \"tag\": \"BUTTON\",\n    \"id\": \"redo\",\n    \"name\": null,\n    \"text\": \"Redo\",\n    \"aria\": null\n  },\n  {\n    \"tag\": \"INPUT\",\n    \"id\": \"piece-label\",\n    \"name\": null,\n    \"text\": \"\",\n    \"aria\": null\n  },\n  {\n    \"tag\": \"INPUT\",\n    \"id\": \"piece-length\",\n    \"name\": null,\n    \"text\": \"\",\n    \"aria\": null\n  },\n  {\n    \"tag\": \"INPUT\",\n    \"id\": \"piece-width\",\n    \"name\": null,\n    \"text\": \"\",\n    \"aria\": null\n  },\n  {\n    \"tag\": \"BUTTON\",\n    \"id\": \"add-piece\",\n    \"name\": null,\n    \"text\": \"Add piece\",\n    \"aria\": null\n  },\n  {\n    \"tag\": \"BUTTON\",\n    \"id\": \"fit-check\",\n    \"name\": null,\n    \"text\": \"Fit check\",\n    \"aria\": null\n  }\n]"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Add piece",
  "target": "#add-piece"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/boards/KW-0005\n- Page Title: Kerfwell Rack\n- Console: 4 errors, 0 warnings",
  "snapshot": "- generic [ref=e2]:\n  - banner [ref=e3]:\n    - link \"Kerfwell\" [ref=e4] [cursor=pointer]:\n      - /url: /\n    - navigation [ref=e5]:\n      - link \"Sign in\" [ref=e6] [cursor=pointer]:\n        - /url: /sign-in\n  - status \"Service notice\"\n  - main [ref=e7]:\n    - generic [ref=e8]:\n      - generic [ref=e104]:\n        - heading \"KW-0005\" [level=1] [ref=e105]\n        - generic [ref=e106]: Available\n      - generic [ref=e107]:\n        - generic [ref=e108]: Heart pine · Select\n        - generic [ref=e109]: Pell Street shoe factory (1924)\n        - generic [ref=e110]: 1600 ¢/bd ft\n        - generic [ref=e111]: 3050 mm × 140 mm × 38 mm\n      - group \"Units\" [ref=e112]:\n        - radiogroup \"Units\" [ref=e114]:\n          - generic [ref=e115]:\n            - radio \"Millimetres\" [checked] [ref=e116]\n            - text: Millimetres\n          - generic [ref=e117]:\n            - radio \"Inches\" [ref=e118]\n            - text: Inches\n      - img \"Board elevation KW-0005\" [ref=e120]:\n        - generic [ref=e121]: \"0\"\n        - generic [ref=e122]: \"500\"\n        - generic [ref=e123]: \"1000\"\n        - generic [ref=e124]: \"1500\"\n        - generic [ref=e125]: \"2000\"\n        - generic [ref=e126]: \"2500\"\n        - generic [ref=e127]: \"3000\"\n      - region \"Layout\" [ref=e128]:\n        - group \"Cut list\"\n        - generic [ref=e129]:\n          - button \"Undo\" [disabled] [ref=e130]\n          - button \"Redo\" [disabled] [ref=e131]\n        - generic [ref=e132]:\n          - generic [ref=e133]:\n            - generic [ref=e134]: Piece label\n            - textbox \"Piece label\" [ref=e135]\n          - generic [ref=e136]:\n            - generic [ref=e137]: Piece length\n            - textbox \"Piece length\" [ref=e138]\n          - generic [ref=e139]:\n            - generic [ref=e140]: Piece width\n            - textbox \"Piece width\" [ref=e141]\n          - button \"Add piece\" [ref=e143] [cursor=pointer]\n        - button \"Fit check\" [ref=e145] [cursor=pointer]\n        - status \"Fit result\" [ref=e146]\n        - status \"Hold status\" [ref=e147]\n        - status \"Layout totals\" [ref=e148]: Add a piece to see the take and price.\n        - link \"Sign in to hold\" [ref=e150] [cursor=pointer]:\n          - /url: /sign-in?next=%2Fboards%2FKW-0005",
  "events": "- New console entries: evidence/reduced/console-2026-11-05T15-50-31-518Z.log#L4"
}
```

### Tool call: browser_fill_form
- Args
```json
{
  "fields": [
    {
      "target": "#piece-label",
      "name": "Piece label",
      "type": "textbox",
      "value": "Shelf A"
    },
    {
      "target": "#piece-length",
      "name": "Piece length",
      "type": "textbox",
      "value": "600"
    },
    {
      "target": "#piece-width",
      "name": "Piece width",
      "type": "textbox",
      "value": "100"
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
  "element": "Add piece",
  "target": "#add-piece"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/boards/KW-0005\n- Page Title: Kerfwell Rack\n- Console: 4 errors, 0 warnings",
  "snapshot": "- generic [ref=e2]:\n  - banner [ref=e3]:\n    - link \"Kerfwell\" [ref=e4] [cursor=pointer]:\n      - /url: /\n    - navigation [ref=e5]:\n      - link \"Sign in\" [ref=e6] [cursor=pointer]:\n        - /url: /sign-in\n  - status \"Service notice\"\n  - main [ref=e7]:\n    - generic [ref=e8]:\n      - generic [ref=e151]:\n        - heading \"KW-0005\" [level=1] [ref=e152]\n        - generic [ref=e153]: Available\n      - generic [ref=e154]:\n        - generic [ref=e155]: Heart pine · Select\n        - generic [ref=e156]: Pell Street shoe factory (1924)\n        - generic [ref=e157]: 1600 ¢/bd ft\n        - generic [ref=e158]: 3050 mm × 140 mm × 38 mm\n      - group \"Units\" [ref=e159]:\n        - radiogroup \"Units\" [ref=e161]:\n          - generic [ref=e162]:\n            - radio \"Millimetres\" [checked] [ref=e163]\n            - text: Millimetres\n          - generic [ref=e164]:\n            - radio \"Inches\" [ref=e165]\n            - text: Inches\n      - img \"Board elevation KW-0005\" [ref=e167]:\n        - generic [ref=e168]: \"0\"\n        - generic [ref=e169]: \"500\"\n        - generic [ref=e170]: \"1000\"\n        - generic [ref=e171]: \"1500\"\n        - generic [ref=e172]: \"2000\"\n        - generic [ref=e173]: \"2500\"\n        - generic [ref=e174]: \"3000\"\n      - region \"Layout\" [ref=e175]:\n        - group \"Cut list\"\n        - generic [ref=e176]:\n          - button \"Undo\" [disabled] [ref=e177]\n          - button \"Redo\" [disabled] [ref=e178]\n        - generic [ref=e179]:\n          - generic [ref=e180]:\n            - generic [ref=e181]: Piece label\n            - textbox \"Piece label\" [ref=e182]\n          - generic [ref=e183]:\n            - generic [ref=e184]: Piece length\n            - textbox \"Piece length\" [ref=e185]\n          - generic [ref=e186]:\n            - generic [ref=e187]: Piece width\n            - textbox \"Piece width\" [ref=e188]\n          - button \"Add piece\" [active] [ref=e190] [cursor=pointer]\n        - button \"Fit check\" [ref=e192] [cursor=pointer]\n        - status \"Fit result\" [ref=e193]\n        - status \"Hold status\" [ref=e194]\n        - status \"Layout totals\" [ref=e195]: Add a piece to see the take and price.\n        - link \"Sign in to hold\" [ref=e197] [cursor=pointer]:\n          - /url: /sign-in?next=%2Fboards%2FKW-0005"
}
```

### Tool call: browser_fill_form
- Args
```json
{
  "fields": [
    {
      "target": "#piece-label",
      "name": "Piece label",
      "type": "textbox",
      "value": "Shelf B"
    },
    {
      "target": "#piece-length",
      "name": "Piece length",
      "type": "textbox",
      "value": "800"
    },
    {
      "target": "#piece-width",
      "name": "Piece width",
      "type": "textbox",
      "value": "100"
    }
  ]
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/boards/KW-0005\n- Page Title: Kerfwell Rack\n- Console: 5 errors, 0 warnings",
  "events": "- New console entries: evidence/reduced/console-2026-11-05T15-50-31-518Z.log#L5"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Add piece",
  "target": "#add-piece"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/boards/KW-0005\n- Page Title: Kerfwell Rack\n- Console: 6 errors, 0 warnings",
  "snapshot": "- generic [ref=e2]:\n  - banner [ref=e3]:\n    - link \"Kerfwell\" [ref=e4] [cursor=pointer]:\n      - /url: /\n    - navigation [ref=e5]:\n      - link \"Sign in\" [ref=e6] [cursor=pointer]:\n        - /url: /sign-in\n  - status \"Service notice\"\n  - main [ref=e7]:\n    - generic [ref=e8]:\n      - generic [ref=e198]:\n        - heading \"KW-0005\" [level=1] [ref=e199]\n        - generic [ref=e200]: Available\n      - generic [ref=e201]:\n        - generic [ref=e202]: Heart pine · Select\n        - generic [ref=e203]: Pell Street shoe factory (1924)\n        - generic [ref=e204]: 1600 ¢/bd ft\n        - generic [ref=e205]: 3050 mm × 140 mm × 38 mm\n      - group \"Units\" [ref=e206]:\n        - radiogroup \"Units\" [ref=e208]:\n          - generic [ref=e209]:\n            - radio \"Millimetres\" [checked] [ref=e210]\n            - text: Millimetres\n          - generic [ref=e211]:\n            - radio \"Inches\" [ref=e212]\n            - text: Inches\n      - img \"Board elevation KW-0005\" [ref=e214]:\n        - generic [ref=e215]: \"0\"\n        - generic [ref=e216]: \"500\"\n        - generic [ref=e217]: \"1000\"\n        - generic [ref=e218]: \"1500\"\n        - generic [ref=e219]: \"2000\"\n        - generic [ref=e220]: \"2500\"\n        - generic [ref=e221]: \"3000\"\n      - region \"Layout\" [ref=e222]:\n        - group \"Cut list\"\n        - generic [ref=e223]:\n          - button \"Undo\" [disabled] [ref=e224]\n          - button \"Redo\" [disabled] [ref=e225]\n        - generic [ref=e226]:\n          - generic [ref=e227]:\n            - generic [ref=e228]: Piece label\n            - textbox \"Piece label\" [ref=e229]\n          - generic [ref=e230]:\n            - generic [ref=e231]: Piece length\n            - textbox \"Piece length\" [ref=e232]\n          - generic [ref=e233]:\n            - generic [ref=e234]: Piece width\n            - textbox \"Piece width\" [ref=e235]\n          - button \"Add piece\" [ref=e237] [cursor=pointer]\n        - button \"Fit check\" [ref=e239] [cursor=pointer]\n        - status \"Fit result\" [ref=e240]\n        - status \"Hold status\" [ref=e241]\n        - status \"Layout totals\" [ref=e242]: Add a piece to see the take and price.\n        - link \"Sign in to hold\" [ref=e244] [cursor=pointer]:\n          - /url: /sign-in?next=%2Fboards%2FKW-0005",
  "events": "- New console entries: evidence/reduced/console-2026-11-05T15-50-31-518Z.log#L6"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Fit check",
  "target": "#fit-check"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/boards/KW-0005\n- Page Title: Kerfwell Rack\n- Console: 6 errors, 0 warnings",
  "snapshot": "- generic [ref=e2]:\n  - banner [ref=e3]:\n    - link \"Kerfwell\" [ref=e4] [cursor=pointer]:\n      - /url: /\n    - navigation [ref=e5]:\n      - link \"Sign in\" [ref=e6] [cursor=pointer]:\n        - /url: /sign-in\n  - status \"Service notice\"\n  - main [ref=e7]:\n    - generic [ref=e8]:\n      - generic [ref=e198]:\n        - heading \"KW-0005\" [level=1] [ref=e199]\n        - generic [ref=e200]: Available\n      - generic [ref=e201]:\n        - generic [ref=e202]: Heart pine · Select\n        - generic [ref=e203]: Pell Street shoe factory (1924)\n        - generic [ref=e204]: 1600 ¢/bd ft\n        - generic [ref=e205]: 3050 mm × 140 mm × 38 mm\n      - group \"Units\" [ref=e206]:\n        - radiogroup \"Units\" [ref=e208]:\n          - generic [ref=e209]:\n            - radio \"Millimetres\" [checked] [ref=e210]\n            - text: Millimetres\n          - generic [ref=e211]:\n            - radio \"Inches\" [ref=e212]\n            - text: Inches\n      - img \"Board elevation KW-0005\" [ref=e214]:\n        - generic [ref=e215]: \"0\"\n        - generic [ref=e216]: \"500\"\n        - generic [ref=e217]: \"1000\"\n        - generic [ref=e218]: \"1500\"\n        - generic [ref=e219]: \"2000\"\n        - generic [ref=e220]: \"2500\"\n        - generic [ref=e221]: \"3000\"\n      - region \"Layout\" [ref=e222]:\n        - group \"Cut list\"\n        - generic [ref=e223]:\n          - button \"Undo\" [disabled] [ref=e224]\n          - button \"Redo\" [disabled] [ref=e225]\n        - generic [ref=e226]:\n          - generic [ref=e227]:\n            - generic [ref=e228]: Piece label\n            - textbox \"Piece label\" [ref=e229]\n          - generic [ref=e230]:\n            - generic [ref=e231]: Piece length\n            - textbox \"Piece length\" [ref=e232]\n          - generic [ref=e233]:\n            - generic [ref=e234]: Piece width\n            - textbox \"Piece width\" [ref=e235]\n          - button \"Add piece\" [ref=e237] [cursor=pointer]\n        - button \"Fit check\" [active] [ref=e239] [cursor=pointer]\n        - status \"Fit result\" [ref=e240]\n        - status \"Hold status\" [ref=e241]\n        - status \"Layout totals\" [ref=e242]: Add a piece to see the take and price.\n        - link \"Sign in to hold\" [ref=e244] [cursor=pointer]:\n          - /url: /sign-in?next=%2Fboards%2FKW-0005"
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
  "page": "- Page URL: http://127.0.0.1:4173/boards/KW-0005\n- Page Title: Kerfwell Rack\n- Console: 6 errors, 0 warnings",
  "inlineSnapshot": "- generic [ref=e2]:\n  - banner [ref=e3]:\n    - link \"Kerfwell\" [ref=e4] [cursor=pointer]:\n      - /url: /\n    - navigation [ref=e5]:\n      - link \"Sign in\" [ref=e6] [cursor=pointer]:\n        - /url: /sign-in\n  - status \"Service notice\"\n  - main [ref=e7]:\n    - generic [ref=e8]:\n      - generic [ref=e245]:\n        - heading \"KW-0005\" [level=1] [ref=e246]\n        - generic [ref=e247]: Available\n      - generic [ref=e248]:\n        - generic [ref=e249]: Heart pine · Select\n        - generic [ref=e250]: Pell Street shoe factory (1924)\n        - generic [ref=e251]: 1600 ¢/bd ft\n        - generic [ref=e252]: 3050 mm × 140 mm × 38 mm\n      - group \"Units\" [ref=e253]:\n        - radiogroup \"Units\" [ref=e255]:\n          - generic [ref=e256]:\n            - radio \"Millimetres\" [checked] [ref=e257]\n            - text: Millimetres\n          - generic [ref=e258]:\n            - radio \"Inches\" [ref=e259]\n            - text: Inches\n      - img \"Board elevation KW-0005\" [ref=e261]:\n        - generic [ref=e262]: \"0\"\n        - generic [ref=e263]: \"500\"\n        - generic [ref=e264]: \"1000\"\n        - generic [ref=e265]: \"1500\"\n        - generic [ref=e266]: \"2000\"\n        - generic [ref=e267]: \"2500\"\n        - generic [ref=e268]: \"3000\"\n      - region \"Layout\" [ref=e269]:\n        - group \"Cut list\"\n        - generic [ref=e270]:\n          - button \"Undo\" [disabled] [ref=e271]\n          - button \"Redo\" [disabled] [ref=e272]\n        - generic [ref=e273]:\n          - generic [ref=e274]:\n            - generic [ref=e275]: Piece label\n            - textbox \"Piece label\" [ref=e276]\n          - generic [ref=e277]:\n            - generic [ref=e278]: Piece length\n            - textbox \"Piece length\" [ref=e279]\n          - generic [ref=e280]:\n            - generic [ref=e281]: Piece width\n            - textbox \"Piece width\" [ref=e282]\n          - button \"Add piece\" [ref=e284] [cursor=pointer]\n        - button \"Fit check\" [ref=e286] [cursor=pointer]\n        - status \"Fit result\" [ref=e287]\n        - status \"Hold status\" [ref=e288]\n        - status \"Layout totals\" [ref=e289]: Add a piece to see the take and price.\n        - link \"Sign in to hold\" [ref=e291] [cursor=pointer]:\n          - /url: /sign-in?next=%2Fboards%2FKW-0005"
}
```

### Tool call: browser_type
- Args
```json
{
  "element": "Piece label",
  "target": "#piece-label",
  "text": "Shelf A"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/boards/KW-0005\n- Page Title: Kerfwell Rack\n- Console: 7 errors, 0 warnings",
  "events": "- New console entries: evidence/reduced/console-2026-11-05T15-50-31-518Z.log#L7"
}
```

### Tool call: browser_type
- Args
```json
{
  "element": "Piece length",
  "target": "#piece-length",
  "text": "600"
}
```
- Result
```json
{}
```

### Tool call: browser_type
- Args
```json
{
  "element": "Piece width",
  "target": "#piece-width",
  "text": "100"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/boards/KW-0005\n- Page Title: Kerfwell Rack\n- Console: 8 errors, 0 warnings",
  "events": "- New console entries: evidence/reduced/console-2026-11-05T15-50-31-518Z.log#L8"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Add piece",
  "target": "#add-piece"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/boards/KW-0005\n- Page Title: Kerfwell Rack\n- Console: 8 errors, 0 warnings",
  "snapshot": "- generic [ref=e2]:\n  - banner [ref=e3]:\n    - link \"Kerfwell\" [ref=e4] [cursor=pointer]:\n      - /url: /\n    - navigation [ref=e5]:\n      - link \"Sign in\" [ref=e6] [cursor=pointer]:\n        - /url: /sign-in\n  - status \"Service notice\"\n  - main [ref=e7]:\n    - generic [ref=e8]:\n      - generic [ref=e292]:\n        - heading \"KW-0005\" [level=1] [ref=e293]\n        - generic [ref=e294]: Available\n      - generic [ref=e295]:\n        - generic [ref=e296]: Heart pine · Select\n        - generic [ref=e297]: Pell Street shoe factory (1924)\n        - generic [ref=e298]: 1600 ¢/bd ft\n        - generic [ref=e299]: 3050 mm × 140 mm × 38 mm\n      - group \"Units\" [ref=e300]:\n        - radiogroup \"Units\" [ref=e302]:\n          - generic [ref=e303]:\n            - radio \"Millimetres\" [checked] [ref=e304]\n            - text: Millimetres\n          - generic [ref=e305]:\n            - radio \"Inches\" [ref=e306]\n            - text: Inches\n      - img \"Board elevation KW-0005\" [ref=e308]:\n        - generic [ref=e309]: \"0\"\n        - generic [ref=e310]: \"500\"\n        - generic [ref=e311]: \"1000\"\n        - generic [ref=e312]: \"1500\"\n        - generic [ref=e313]: \"2000\"\n        - generic [ref=e314]: \"2500\"\n        - generic [ref=e315]: \"3000\"\n      - region \"Layout\" [ref=e316]:\n        - group \"Cut list\"\n        - generic [ref=e317]:\n          - button \"Undo\" [disabled] [ref=e318]\n          - button \"Redo\" [disabled] [ref=e319]\n        - generic [ref=e320]:\n          - generic [ref=e321]:\n            - generic [ref=e322]: Piece label\n            - textbox \"Piece label\" [ref=e323]\n          - generic [ref=e324]:\n            - generic [ref=e325]: Piece length\n            - textbox \"Piece length\" [ref=e326]\n          - generic [ref=e327]:\n            - generic [ref=e328]: Piece width\n            - textbox \"Piece width\" [ref=e329]\n          - button \"Add piece\" [active] [ref=e331] [cursor=pointer]\n        - button \"Fit check\" [ref=e333] [cursor=pointer]\n        - status \"Fit result\" [ref=e334]\n        - status \"Hold status\" [ref=e335]\n        - status \"Layout totals\" [ref=e336]: Add a piece to see the take and price.\n        - link \"Sign in to hold\" [ref=e338] [cursor=pointer]:\n          - /url: /sign-in?next=%2Fboards%2FKW-0005"
}
```

### Tool call: browser_evaluate
- Args
```json
{
  "function": "() => ({fit:document.querySelector('#fit-result')?.textContent, totals:document.querySelector('#layout-totals')?.textContent, errors:[...document.querySelectorAll('[role=alert]')].map(e=>e.textContent), pieces:[...document.querySelectorAll('[data-piece]')].map(e=>e.textContent),body:document.body.innerText.includes('Shelf A')})"
}
```
- Result
```json
{
  "result": "{\n  \"fit\": \"\",\n  \"totals\": \"Add a piece to see the take and price.\",\n  \"errors\": [],\n  \"pieces\": [],\n  \"body\": false\n}"
}
```

### Tool call: browser_fill_form
- Args
```json
{
  "fields": [
    {
      "target": "#piece-label",
      "name": "Piece label",
      "type": "textbox",
      "value": "Shelf A"
    },
    {
      "target": "#piece-length",
      "name": "Piece length",
      "type": "textbox",
      "value": "600"
    },
    {
      "target": "#piece-width",
      "name": "Piece width",
      "type": "textbox",
      "value": "100"
    }
  ]
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/boards/KW-0005\n- Page Title: Kerfwell Rack\n- Console: 9 errors, 0 warnings",
  "events": "- New console entries: evidence/reduced/console-2026-11-05T15-50-31-518Z.log#L9"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Add piece",
  "target": "#add-piece"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/boards/KW-0005\n- Page Title: Kerfwell Rack\n- Console: 10 errors, 0 warnings",
  "snapshot": "- generic [ref=e2]:\n  - banner [ref=e3]:\n    - link \"Kerfwell\" [ref=e4] [cursor=pointer]:\n      - /url: /\n    - navigation [ref=e5]:\n      - link \"Sign in\" [ref=e6] [cursor=pointer]:\n        - /url: /sign-in\n  - status \"Service notice\"\n  - main [ref=e7]:\n    - generic [ref=e8]:\n      - generic [ref=e339]:\n        - heading \"KW-0005\" [level=1] [ref=e340]\n        - generic [ref=e341]: Available\n      - generic [ref=e342]:\n        - generic [ref=e343]: Heart pine · Select\n        - generic [ref=e344]: Pell Street shoe factory (1924)\n        - generic [ref=e345]: 1600 ¢/bd ft\n        - generic [ref=e346]: 3050 mm × 140 mm × 38 mm\n      - group \"Units\" [ref=e347]:\n        - radiogroup \"Units\" [ref=e349]:\n          - generic [ref=e350]:\n            - radio \"Millimetres\" [checked] [ref=e351]\n            - text: Millimetres\n          - generic [ref=e352]:\n            - radio \"Inches\" [ref=e353]\n            - text: Inches\n      - img \"Board elevation KW-0005\" [ref=e355]:\n        - generic [ref=e356]: \"0\"\n        - generic [ref=e357]: \"500\"\n        - generic [ref=e358]: \"1000\"\n        - generic [ref=e359]: \"1500\"\n        - generic [ref=e360]: \"2000\"\n        - generic [ref=e361]: \"2500\"\n        - generic [ref=e362]: \"3000\"\n      - region \"Layout\" [ref=e363]:\n        - group \"Cut list\"\n        - generic [ref=e364]:\n          - button \"Undo\" [disabled] [ref=e365]\n          - button \"Redo\" [disabled] [ref=e366]\n        - generic [ref=e367]:\n          - generic [ref=e368]:\n            - generic [ref=e369]: Piece label\n            - textbox \"Piece label\" [ref=e370]\n          - generic [ref=e371]:\n            - generic [ref=e372]: Piece length\n            - textbox \"Piece length\" [ref=e373]\n          - generic [ref=e374]:\n            - generic [ref=e375]: Piece width\n            - textbox \"Piece width\" [ref=e376]\n          - button \"Add piece\" [active] [ref=e378] [cursor=pointer]\n        - button \"Fit check\" [ref=e380] [cursor=pointer]\n        - status \"Fit result\" [ref=e381]\n        - status \"Hold status\" [ref=e382]\n        - status \"Layout totals\" [ref=e383]: Add a piece to see the take and price.\n        - link \"Sign in to hold\" [ref=e385] [cursor=pointer]:\n          - /url: /sign-in?next=%2Fboards%2FKW-0005",
  "events": "- New console entries: evidence/reduced/console-2026-11-05T15-50-31-518Z.log#L10"
}
```

### Tool call: browser_fill_form
- Args
```json
{
  "fields": [
    {
      "target": "#piece-label",
      "name": "Piece label",
      "type": "textbox",
      "value": "Shelf B"
    },
    {
      "target": "#piece-length",
      "name": "Piece length",
      "type": "textbox",
      "value": "800"
    },
    {
      "target": "#piece-width",
      "name": "Piece width",
      "type": "textbox",
      "value": "100"
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
  "element": "Add piece",
  "target": "#add-piece"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/boards/KW-0005\n- Page Title: Kerfwell Rack\n- Console: 10 errors, 0 warnings",
  "snapshot": "- generic [ref=e2]:\n  - banner [ref=e3]:\n    - link \"Kerfwell\" [ref=e4] [cursor=pointer]:\n      - /url: /\n    - navigation [ref=e5]:\n      - link \"Sign in\" [ref=e6] [cursor=pointer]:\n        - /url: /sign-in\n  - status \"Service notice\"\n  - main [ref=e7]:\n    - generic [ref=e8]:\n      - generic [ref=e386]:\n        - heading \"KW-0005\" [level=1] [ref=e387]\n        - generic [ref=e388]: Available\n      - generic [ref=e389]:\n        - generic [ref=e390]: Heart pine · Select\n        - generic [ref=e391]: Pell Street shoe factory (1924)\n        - generic [ref=e392]: 1600 ¢/bd ft\n        - generic [ref=e393]: 3050 mm × 140 mm × 38 mm\n      - group \"Units\" [ref=e394]:\n        - radiogroup \"Units\" [ref=e396]:\n          - generic [ref=e397]:\n            - radio \"Millimetres\" [checked] [ref=e398]\n            - text: Millimetres\n          - generic [ref=e399]:\n            - radio \"Inches\" [ref=e400]\n            - text: Inches\n      - img \"Board elevation KW-0005\" [ref=e402]:\n        - generic [ref=e403]: \"0\"\n        - generic [ref=e404]: \"500\"\n        - generic [ref=e405]: \"1000\"\n        - generic [ref=e406]: \"1500\"\n        - generic [ref=e407]: \"2000\"\n        - generic [ref=e408]: \"2500\"\n        - generic [ref=e409]: \"3000\"\n      - region \"Layout\" [ref=e410]:\n        - group \"Cut list\"\n        - generic [ref=e411]:\n          - button \"Undo\" [disabled] [ref=e412]\n          - button \"Redo\" [disabled] [ref=e413]\n        - generic [ref=e414]:\n          - generic [ref=e415]:\n            - generic [ref=e416]: Piece label\n            - textbox \"Piece label\" [ref=e417]\n          - generic [ref=e418]:\n            - generic [ref=e419]: Piece length\n            - textbox \"Piece length\" [ref=e420]\n          - generic [ref=e421]:\n            - generic [ref=e422]: Piece width\n            - textbox \"Piece width\" [ref=e423]\n          - button \"Add piece\" [active] [ref=e425] [cursor=pointer]\n        - button \"Fit check\" [ref=e427] [cursor=pointer]\n        - status \"Fit result\" [ref=e428]\n        - status \"Hold status\" [ref=e429]\n        - status \"Layout totals\" [ref=e430]: Add a piece to see the take and price.\n        - link \"Sign in to hold\" [ref=e432] [cursor=pointer]:\n          - /url: /sign-in?next=%2Fboards%2FKW-0005"
}
```

### Tool call: browser_evaluate
- Args
```json
{
  "function": "() => ({kerfs:[...document.querySelectorAll('[data-kerf]')].map(e=>({stroke:e.getAttribute('stroke'),fill:e.getAttribute('fill'),computedStroke:getComputedStyle(e).stroke})),fitButton:{background:getComputedStyle(document.querySelector('#fit-check')).backgroundColor,border:getComputedStyle(document.querySelector('#fit-check')).borderColor},fitResult:document.querySelector('#fit-result')?.textContent,totals:document.querySelector('#layout-totals')?.textContent,undoDisabled:document.querySelector('#undo')?.disabled,redoDisabled:document.querySelector('#redo')?.disabled})"
}
```
- Result
```json
{
  "result": "{\n  \"kerfs\": [],\n  \"fitButton\": {\n    \"background\": \"rgb(250, 246, 238)\",\n    \"border\": \"rgb(43, 36, 32)\"\n  },\n  \"fitResult\": \"\",\n  \"totals\": \"Add a piece to see the take and price.\",\n  \"undoDisabled\": true,\n  \"redoDisabled\": true\n}",
  "page": "- Page URL: http://127.0.0.1:4173/boards/KW-0005\n- Page Title: Kerfwell Rack\n- Console: 26 errors, 0 warnings",
  "events": "- New console entries: evidence/reduced/console-2026-11-05T15-50-31-518Z.log#L11-L26"
}
```

### Tool call: browser_take_screenshot
- Args
```json
{
  "type": "png",
  "fullPage": false,
  "scale": "css"
}
```
- Result
```json
{
  "result": "- [Screenshot of viewport](evidence/reduced/page-2026-11-05T15-53-52-519Z.png)",
  "page": "- Page URL: http://127.0.0.1:4173/boards/KW-0005\n- Page Title: Kerfwell Rack\n- Console: 27 errors, 0 warnings",
  "events": "- New console entries: evidence/reduced/console-2026-11-05T15-50-31-518Z.log#L27",
  "attachments": [
    {
      "type": "image",
      "data": "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",
      "mimeType": "image/png"
    }
  ]
}
```
