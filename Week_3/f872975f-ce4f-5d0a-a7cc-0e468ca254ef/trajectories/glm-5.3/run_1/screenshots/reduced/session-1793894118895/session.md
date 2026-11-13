
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
  "events": "- New console entries: evidence/reduced/console-2026-11-05T15-56-15-825Z.log#L1"
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
  "page": "- Page URL: http://127.0.0.1:4173/boards/KW-0005\n- Page Title: Kerfwell Rack\n- Console: 2 errors, 0 warnings",
  "inlineSnapshot": "- generic [ref=e2]:\n  - banner [ref=e3]:\n    - link \"Kerfwell\" [ref=e4] [cursor=pointer]:\n      - /url: /\n    - navigation [ref=e5]:\n      - link \"Sign in\" [ref=e6] [cursor=pointer]:\n        - /url: /sign-in\n  - status \"Service notice\"\n  - main [ref=e7]:\n    - generic [ref=e8]:\n      - generic [ref=e10]:\n        - heading \"KW-0005\" [level=1] [ref=e11]\n        - generic [ref=e12]: Available\n      - generic [ref=e13]:\n        - generic [ref=e14]: Heart pine · Select\n        - generic [ref=e15]: Pell Street shoe factory (1924)\n        - generic [ref=e16]: 1600 ¢/bd ft\n        - generic [ref=e17]: 3050 mm × 140 mm × 38 mm\n      - group \"Units\" [ref=e18]:\n        - radiogroup \"Units\" [ref=e20]:\n          - generic [ref=e21]:\n            - radio \"Millimetres\" [checked] [ref=e22]\n            - text: Millimetres\n          - generic [ref=e23]:\n            - radio \"Inches\" [ref=e24]\n            - text: Inches\n      - img \"Board elevation KW-0005\" [ref=e26]:\n        - generic [ref=e27]: \"0\"\n        - generic [ref=e28]: \"500\"\n        - generic [ref=e29]: \"1000\"\n        - generic [ref=e30]: \"1500\"\n        - generic [ref=e31]: \"2000\"\n        - generic [ref=e32]: \"2500\"\n        - generic [ref=e33]: \"3000\"\n      - region \"Layout\" [ref=e34]:\n        - group \"Cut list\"\n        - generic [ref=e35]:\n          - button \"Undo\" [disabled] [ref=e36]\n          - button \"Redo\" [disabled] [ref=e37]\n        - generic [ref=e38]:\n          - generic [ref=e39]:\n            - generic [ref=e40]: Piece label\n            - textbox \"Piece label\" [ref=e41]\n          - generic [ref=e42]:\n            - generic [ref=e43]: Piece length\n            - textbox \"Piece length\" [ref=e44]\n          - generic [ref=e45]:\n            - generic [ref=e46]: Piece width\n            - textbox \"Piece width\" [ref=e47]\n          - button \"Add piece\" [ref=e49] [cursor=pointer]\n        - button \"Fit check\" [ref=e51] [cursor=pointer]\n        - status \"Fit result\" [ref=e52]\n        - status \"Hold status\" [ref=e53]\n        - status \"Layout totals\" [ref=e54]: Add a piece to see the take and price.\n        - link \"Sign in to hold\" [ref=e56] [cursor=pointer]:\n          - /url: /sign-in?next=%2Fboards%2FKW-0005",
  "events": "- New console entries: evidence/reduced/console-2026-11-05T15-56-15-825Z.log#L2"
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
  "page": "- Page URL: http://127.0.0.1:4173/boards/KW-0005\n- Page Title: Kerfwell Rack\n- Console: 3 errors, 0 warnings",
  "inlineSnapshot": "- generic [ref=e2]:\n  - banner [ref=e3]:\n    - link \"Kerfwell\" [ref=e4] [cursor=pointer]:\n      - /url: /\n    - navigation [ref=e5]:\n      - link \"Sign in\" [ref=e6] [cursor=pointer]:\n        - /url: /sign-in\n  - status \"Service notice\"\n  - main [ref=e7]:\n    - generic [ref=e8]:\n      - generic [ref=e57]:\n        - heading \"KW-0005\" [level=1] [ref=e58]\n        - generic [ref=e59]: Available\n      - generic [ref=e60]:\n        - generic [ref=e61]: Heart pine · Select\n        - generic [ref=e62]: Pell Street shoe factory (1924)\n        - generic [ref=e63]: 1600 ¢/bd ft\n        - generic [ref=e64]: 3050 mm × 140 mm × 38 mm\n      - group \"Units\" [ref=e65]:\n        - radiogroup \"Units\" [ref=e67]:\n          - generic [ref=e68]:\n            - radio \"Millimetres\" [checked] [ref=e69]\n            - text: Millimetres\n          - generic [ref=e70]:\n            - radio \"Inches\" [ref=e71]\n            - text: Inches\n      - img \"Board elevation KW-0005\" [ref=e73]:\n        - generic [ref=e74]: \"0\"\n        - generic [ref=e75]: \"500\"\n        - generic [ref=e76]: \"1000\"\n        - generic [ref=e77]: \"1500\"\n        - generic [ref=e78]: \"2000\"\n        - generic [ref=e79]: \"2500\"\n        - generic [ref=e80]: \"3000\"\n      - region \"Layout\" [ref=e81]:\n        - group \"Cut list\"\n        - generic [ref=e82]:\n          - button \"Undo\" [disabled] [ref=e83]\n          - button \"Redo\" [disabled] [ref=e84]\n        - generic [ref=e85]:\n          - generic [ref=e86]:\n            - generic [ref=e87]: Piece label\n            - textbox \"Piece label\" [ref=e88]\n          - generic [ref=e89]:\n            - generic [ref=e90]: Piece length\n            - textbox \"Piece length\" [ref=e91]\n          - generic [ref=e92]:\n            - generic [ref=e93]: Piece width\n            - textbox \"Piece width\" [ref=e94]\n          - button \"Add piece\" [ref=e96] [cursor=pointer]\n        - button \"Fit check\" [ref=e98] [cursor=pointer]\n        - status \"Fit result\" [ref=e99]\n        - status \"Hold status\" [ref=e100]\n        - status \"Layout totals\" [ref=e101]: Add a piece to see the take and price.\n        - link \"Sign in to hold\" [ref=e103] [cursor=pointer]:\n          - /url: /sign-in?next=%2Fboards%2FKW-0005",
  "events": "- New console entries: evidence/reduced/console-2026-11-05T15-56-15-825Z.log#L3"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Add piece",
  "target": "e96"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/boards/KW-0005\n- Page Title: Kerfwell Rack\n- Console: 3 errors, 0 warnings",
  "snapshot": "- generic [ref=e2]:\n  - banner [ref=e3]:\n    - link \"Kerfwell\" [ref=e4] [cursor=pointer]:\n      - /url: /\n    - navigation [ref=e5]:\n      - link \"Sign in\" [ref=e6] [cursor=pointer]:\n        - /url: /sign-in\n  - status \"Service notice\"\n  - main [ref=e7]:\n    - generic [ref=e8]:\n      - generic [ref=e57]:\n        - heading \"KW-0005\" [level=1] [ref=e58]\n        - generic [ref=e59]: Available\n      - generic [ref=e60]:\n        - generic [ref=e61]: Heart pine · Select\n        - generic [ref=e62]: Pell Street shoe factory (1924)\n        - generic [ref=e63]: 1600 ¢/bd ft\n        - generic [ref=e64]: 3050 mm × 140 mm × 38 mm\n      - group \"Units\" [ref=e65]:\n        - radiogroup \"Units\" [ref=e67]:\n          - generic [ref=e68]:\n            - radio \"Millimetres\" [checked] [ref=e69]\n            - text: Millimetres\n          - generic [ref=e70]:\n            - radio \"Inches\" [ref=e71]\n            - text: Inches\n      - img \"Board elevation KW-0005\" [ref=e73]:\n        - generic [ref=e74]: \"0\"\n        - generic [ref=e75]: \"500\"\n        - generic [ref=e76]: \"1000\"\n        - generic [ref=e77]: \"1500\"\n        - generic [ref=e78]: \"2000\"\n        - generic [ref=e79]: \"2500\"\n        - generic [ref=e80]: \"3000\"\n      - region \"Layout\" [ref=e81]:\n        - group \"Cut list\"\n        - generic [ref=e82]:\n          - button \"Undo\" [disabled] [ref=e83]\n          - button \"Redo\" [disabled] [ref=e84]\n        - generic [ref=e85]:\n          - generic [ref=e86]:\n            - generic [ref=e87]: Piece label\n            - textbox \"Piece label\" [ref=e88]\n          - generic [ref=e89]:\n            - generic [ref=e90]: Piece length\n            - textbox \"Piece length\" [ref=e91]\n          - generic [ref=e92]:\n            - generic [ref=e93]: Piece width\n            - textbox \"Piece width\" [ref=e94]\n          - button \"Add piece\" [active] [ref=e96] [cursor=pointer]\n        - button \"Fit check\" [ref=e98] [cursor=pointer]\n        - status \"Fit result\" [ref=e99]\n        - status \"Hold status\" [ref=e100]\n        - status \"Layout totals\" [ref=e101]: Add a piece to see the take and price.\n        - link \"Sign in to hold\" [ref=e103] [cursor=pointer]:\n          - /url: /sign-in?next=%2Fboards%2FKW-0005"
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
  "page": "- Page URL: http://127.0.0.1:4173/boards/KW-0005\n- Page Title: Kerfwell Rack\n- Console: 3 errors, 0 warnings",
  "inlineSnapshot": "- generic [ref=e2]:\n  - banner [ref=e3]:\n    - link \"Kerfwell\" [ref=e4] [cursor=pointer]:\n      - /url: /\n    - navigation [ref=e5]:\n      - link \"Sign in\" [ref=e6] [cursor=pointer]:\n        - /url: /sign-in\n  - status \"Service notice\"\n  - main [ref=e7]:\n    - generic [ref=e8]:\n      - generic [ref=e104]:\n        - heading \"KW-0005\" [level=1] [ref=e105]\n        - generic [ref=e106]: Available\n      - generic [ref=e107]:\n        - generic [ref=e108]: Heart pine · Select\n        - generic [ref=e109]: Pell Street shoe factory (1924)\n        - generic [ref=e110]: 1600 ¢/bd ft\n        - generic [ref=e111]: 3050 mm × 140 mm × 38 mm\n      - group \"Units\" [ref=e112]:\n        - radiogroup \"Units\" [ref=e114]:\n          - generic [ref=e115]:\n            - radio \"Millimetres\" [checked] [ref=e116]\n            - text: Millimetres\n          - generic [ref=e117]:\n            - radio \"Inches\" [ref=e118]\n            - text: Inches\n      - img \"Board elevation KW-0005\" [ref=e120]:\n        - generic [ref=e121]: \"0\"\n        - generic [ref=e122]: \"500\"\n        - generic [ref=e123]: \"1000\"\n        - generic [ref=e124]: \"1500\"\n        - generic [ref=e125]: \"2000\"\n        - generic [ref=e126]: \"2500\"\n        - generic [ref=e127]: \"3000\"\n      - region \"Layout\" [ref=e128]:\n        - group \"Cut list\"\n        - generic [ref=e129]:\n          - button \"Undo\" [disabled] [ref=e130]\n          - button \"Redo\" [disabled] [ref=e131]\n        - generic [ref=e132]:\n          - generic [ref=e133]:\n            - generic [ref=e134]: Piece label\n            - textbox \"Piece label\" [ref=e135]\n          - generic [ref=e136]:\n            - generic [ref=e137]: Piece length\n            - textbox \"Piece length\" [ref=e138]\n          - generic [ref=e139]:\n            - generic [ref=e140]: Piece width\n            - textbox \"Piece width\" [ref=e141]\n          - button \"Add piece\" [ref=e143] [cursor=pointer]\n        - button \"Fit check\" [ref=e145] [cursor=pointer]\n        - status \"Fit result\" [ref=e146]\n        - status \"Hold status\" [ref=e147]\n        - status \"Layout totals\" [ref=e148]: Add a piece to see the take and price.\n        - link \"Sign in to hold\" [ref=e150] [cursor=pointer]:\n          - /url: /sign-in?next=%2Fboards%2FKW-0005"
}
```

### Tool call: browser_evaluate
- Args
```json
{
  "function": "() => [...document.querySelectorAll('input')].map(e=>({outer:e.outerHTML}))"
}
```
- Result
```json
{
  "result": "[\n  {\n    \"outer\": \"<input type=\\\"radio\\\" name=\\\"units\\\" value=\\\"mm\\\" checked=\\\"\\\">\"\n  },\n  {\n    \"outer\": \"<input type=\\\"radio\\\" name=\\\"units\\\" value=\\\"in\\\">\"\n  },\n  {\n    \"outer\": \"<input id=\\\"piece-label\\\" maxlength=\\\"40\\\" autocomplete=\\\"off\\\">\"\n  },\n  {\n    \"outer\": \"<input id=\\\"piece-length\\\" inputmode=\\\"decimal\\\" autocomplete=\\\"off\\\">\"\n  },\n  {\n    \"outer\": \"<input id=\\\"piece-width\\\" inputmode=\\\"decimal\\\" autocomplete=\\\"off\\\">\"\n  }\n]",
  "page": "- Page URL: http://127.0.0.1:4173/boards/KW-0005\n- Page Title: Kerfwell Rack\n- Console: 4 errors, 0 warnings",
  "events": "- New console entries: evidence/reduced/console-2026-11-05T15-56-15-825Z.log#L4"
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
  "page": "- Page URL: http://127.0.0.1:4173/boards/KW-0005\n- Page Title: Kerfwell Rack\n- Console: 5 errors, 0 warnings",
  "events": "- New console entries: evidence/reduced/console-2026-11-05T15-56-15-825Z.log#L5"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Add piece",
  "target": "button[type=\"submit\"]"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/boards/KW-0005\n- Page Title: Kerfwell Rack\n- Console: 5 errors, 0 warnings",
  "snapshot": "- generic [ref=e2]:\n  - banner [ref=e3]:\n    - link \"Kerfwell\" [ref=e4] [cursor=pointer]:\n      - /url: /\n    - navigation [ref=e5]:\n      - link \"Sign in\" [ref=e6] [cursor=pointer]:\n        - /url: /sign-in\n  - status \"Service notice\"\n  - main [ref=e7]:\n    - generic [ref=e8]:\n      - generic [ref=e151]:\n        - heading \"KW-0005\" [level=1] [ref=e152]\n        - generic [ref=e153]: Available\n      - generic [ref=e154]:\n        - generic [ref=e155]: Heart pine · Select\n        - generic [ref=e156]: Pell Street shoe factory (1924)\n        - generic [ref=e157]: 1600 ¢/bd ft\n        - generic [ref=e158]: 3050 mm × 140 mm × 38 mm\n      - group \"Units\" [ref=e159]:\n        - radiogroup \"Units\" [ref=e161]:\n          - generic [ref=e162]:\n            - radio \"Millimetres\" [checked] [ref=e163]\n            - text: Millimetres\n          - generic [ref=e164]:\n            - radio \"Inches\" [ref=e165]\n            - text: Inches\n      - img \"Board elevation KW-0005\" [ref=e167]:\n        - generic [ref=e168]: \"0\"\n        - generic [ref=e169]: \"500\"\n        - generic [ref=e170]: \"1000\"\n        - generic [ref=e171]: \"1500\"\n        - generic [ref=e172]: \"2000\"\n        - generic [ref=e173]: \"2500\"\n        - generic [ref=e174]: \"3000\"\n      - region \"Layout\" [ref=e175]:\n        - group \"Cut list\"\n        - generic [ref=e176]:\n          - button \"Undo\" [disabled] [ref=e177]\n          - button \"Redo\" [disabled] [ref=e178]\n        - generic [ref=e179]:\n          - generic [ref=e180]:\n            - generic [ref=e181]: Piece label\n            - textbox \"Piece label\" [ref=e182]\n          - generic [ref=e183]:\n            - generic [ref=e184]: Piece length\n            - textbox \"Piece length\" [ref=e185]\n          - generic [ref=e186]:\n            - generic [ref=e187]: Piece width\n            - textbox \"Piece width\" [ref=e188]\n          - button \"Add piece\" [active] [ref=e190] [cursor=pointer]\n        - button \"Fit check\" [ref=e192] [cursor=pointer]\n        - status \"Fit result\" [ref=e193]\n        - status \"Hold status\" [ref=e194]\n        - status \"Layout totals\" [ref=e195]: Add a piece to see the take and price.\n        - link \"Sign in to hold\" [ref=e197] [cursor=pointer]:\n          - /url: /sign-in?next=%2Fboards%2FKW-0005"
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
  "page": "- Page URL: http://127.0.0.1:4173/boards/KW-0005\n- Page Title: Kerfwell Rack\n- Console: 5 errors, 0 warnings",
  "inlineSnapshot": "- generic [ref=e2]:\n  - banner [ref=e3]:\n    - link \"Kerfwell\" [ref=e4] [cursor=pointer]:\n      - /url: /\n    - navigation [ref=e5]:\n      - link \"Sign in\" [ref=e6] [cursor=pointer]:\n        - /url: /sign-in\n  - status \"Service notice\"\n  - main [ref=e7]:\n    - generic [ref=e8]:\n      - generic [ref=e151]:\n        - heading \"KW-0005\" [level=1] [ref=e152]\n        - generic [ref=e153]: Available\n      - generic [ref=e154]:\n        - generic [ref=e155]: Heart pine · Select\n        - generic [ref=e156]: Pell Street shoe factory (1924)\n        - generic [ref=e157]: 1600 ¢/bd ft\n        - generic [ref=e158]: 3050 mm × 140 mm × 38 mm\n      - group \"Units\" [ref=e159]:\n        - radiogroup \"Units\" [ref=e161]:\n          - generic [ref=e162]:\n            - radio \"Millimetres\" [checked] [ref=e163]\n            - text: Millimetres\n          - generic [ref=e164]:\n            - radio \"Inches\" [ref=e165]\n            - text: Inches\n      - img \"Board elevation KW-0005\" [ref=e167]:\n        - generic [ref=e168]: \"0\"\n        - generic [ref=e169]: \"500\"\n        - generic [ref=e170]: \"1000\"\n        - generic [ref=e171]: \"1500\"\n        - generic [ref=e172]: \"2000\"\n        - generic [ref=e173]: \"2500\"\n        - generic [ref=e174]: \"3000\"\n      - region \"Layout\" [ref=e175]:\n        - group \"Cut list\"\n        - generic [ref=e176]:\n          - button \"Undo\" [disabled] [ref=e177]\n          - button \"Redo\" [disabled] [ref=e178]\n        - generic [ref=e179]:\n          - generic [ref=e180]:\n            - generic [ref=e181]: Piece label\n            - textbox \"Piece label\" [ref=e182]\n          - generic [ref=e183]:\n            - generic [ref=e184]: Piece length\n            - textbox \"Piece length\" [ref=e185]\n          - generic [ref=e186]:\n            - generic [ref=e187]: Piece width\n            - textbox \"Piece width\" [ref=e188]\n          - button \"Add piece\" [active] [ref=e190] [cursor=pointer]\n        - button \"Fit check\" [ref=e192] [cursor=pointer]\n        - status \"Fit result\" [ref=e193]\n        - status \"Hold status\" [ref=e194]\n        - status \"Layout totals\" [ref=e195]: Add a piece to see the take and price.\n        - link \"Sign in to hold\" [ref=e197] [cursor=pointer]:\n          - /url: /sign-in?next=%2Fboards%2FKW-0005"
}
```

### Tool call: browser_evaluate
- Args
```json
{
  "function": "() => ({inputs:[...document.querySelectorAll('input')].map(e=>({id:e.id,value:e.value})),buttons:[...document.querySelectorAll('button')].map((e,i)=>({i,text:e.textContent.trim(),type:e.type,outer:e.outerHTML}))})"
}
```
- Result
```json
{
  "result": "{\n  \"inputs\": [\n    {\n      \"id\": \"\",\n      \"value\": \"mm\"\n    },\n    {\n      \"id\": \"\",\n      \"value\": \"in\"\n    },\n    {\n      \"id\": \"piece-label\",\n      \"value\": \"\"\n    },\n    {\n      \"id\": \"piece-length\",\n      \"value\": \"\"\n    },\n    {\n      \"id\": \"piece-width\",\n      \"value\": \"\"\n    }\n  ],\n  \"buttons\": [\n    {\n      \"i\": 0,\n      \"text\": \"Undo\",\n      \"type\": \"submit\",\n      \"outer\": \"<button id=\\\"undo\\\" disabled=\\\"\\\">Undo</button>\"\n    },\n    {\n      \"i\": 1,\n      \"text\": \"Redo\",\n      \"type\": \"submit\",\n      \"outer\": \"<button id=\\\"redo\\\" disabled=\\\"\\\">Redo</button>\"\n    },\n    {\n      \"i\": 2,\n      \"text\": \"Add piece\",\n      \"type\": \"submit\",\n      \"outer\": \"<button type=\\\"submit\\\" id=\\\"add-piece\\\">Add piece</button>\"\n    },\n    {\n      \"i\": 3,\n      \"text\": \"Fit check\",\n      \"type\": \"submit\",\n      \"outer\": \"<button id=\\\"fit-check\\\">Fit check</button>\"\n    }\n  ]\n}",
  "page": "- Page URL: http://127.0.0.1:4173/boards/KW-0005\n- Page Title: Kerfwell Rack\n- Console: 6 errors, 0 warnings",
  "events": "- New console entries: evidence/reduced/console-2026-11-05T15-56-15-825Z.log#L6"
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
  "page": "- Page URL: http://127.0.0.1:4173/boards/KW-0005\n- Page Title: Kerfwell Rack\n- Console: 7 errors, 0 warnings",
  "snapshot": "- generic [ref=e2]:\n  - banner [ref=e3]:\n    - link \"Kerfwell\" [ref=e4] [cursor=pointer]:\n      - /url: /\n    - navigation [ref=e5]:\n      - link \"Sign in\" [ref=e6] [cursor=pointer]:\n        - /url: /sign-in\n  - status \"Service notice\"\n  - main [ref=e7]:\n    - generic [ref=e8]:\n      - generic [ref=e198]:\n        - heading \"KW-0005\" [level=1] [ref=e199]\n        - generic [ref=e200]: Available\n      - generic [ref=e201]:\n        - generic [ref=e202]: Heart pine · Select\n        - generic [ref=e203]: Pell Street shoe factory (1924)\n        - generic [ref=e204]: 1600 ¢/bd ft\n        - generic [ref=e205]: 3050 mm × 140 mm × 38 mm\n      - group \"Units\" [ref=e206]:\n        - radiogroup \"Units\" [ref=e208]:\n          - generic [ref=e209]:\n            - radio \"Millimetres\" [checked] [ref=e210]\n            - text: Millimetres\n          - generic [ref=e211]:\n            - radio \"Inches\" [ref=e212]\n            - text: Inches\n      - img \"Board elevation KW-0005\" [ref=e214]:\n        - generic [ref=e215]: \"0\"\n        - generic [ref=e216]: \"500\"\n        - generic [ref=e217]: \"1000\"\n        - generic [ref=e218]: \"1500\"\n        - generic [ref=e219]: \"2000\"\n        - generic [ref=e220]: \"2500\"\n        - generic [ref=e221]: \"3000\"\n      - region \"Layout\" [ref=e222]:\n        - group \"Cut list\"\n        - generic [ref=e223]:\n          - button \"Undo\" [disabled] [ref=e224]\n          - button \"Redo\" [disabled] [ref=e225]\n        - generic [ref=e226]:\n          - generic [ref=e227]:\n            - generic [ref=e228]: Piece label\n            - textbox \"Piece label\" [ref=e229]\n          - generic [ref=e230]:\n            - generic [ref=e231]: Piece length\n            - textbox \"Piece length\" [ref=e232]\n          - generic [ref=e233]:\n            - generic [ref=e234]: Piece width\n            - textbox \"Piece width\" [ref=e235]\n          - button \"Add piece\" [active] [ref=e237] [cursor=pointer]\n        - button \"Fit check\" [ref=e239] [cursor=pointer]\n        - status \"Fit result\" [ref=e240]\n        - status \"Hold status\" [ref=e241]\n        - status \"Layout totals\" [ref=e242]: Add a piece to see the take and price.\n        - link \"Sign in to hold\" [ref=e244] [cursor=pointer]:\n          - /url: /sign-in?next=%2Fboards%2FKW-0005",
  "events": "- New console entries: evidence/reduced/console-2026-11-05T15-56-15-825Z.log#L7"
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
  "page": "- Page URL: http://127.0.0.1:4173/boards/KW-0005\n- Page Title: Kerfwell Rack\n- Console: 7 errors, 0 warnings",
  "inlineSnapshot": "- generic [ref=e2]:\n  - banner [ref=e3]:\n    - link \"Kerfwell\" [ref=e4] [cursor=pointer]:\n      - /url: /\n    - navigation [ref=e5]:\n      - link \"Sign in\" [ref=e6] [cursor=pointer]:\n        - /url: /sign-in\n  - status \"Service notice\"\n  - main [ref=e7]:\n    - generic [ref=e8]:\n      - generic [ref=e198]:\n        - heading \"KW-0005\" [level=1] [ref=e199]\n        - generic [ref=e200]: Available\n      - generic [ref=e201]:\n        - generic [ref=e202]: Heart pine · Select\n        - generic [ref=e203]: Pell Street shoe factory (1924)\n        - generic [ref=e204]: 1600 ¢/bd ft\n        - generic [ref=e205]: 3050 mm × 140 mm × 38 mm\n      - group \"Units\" [ref=e206]:\n        - radiogroup \"Units\" [ref=e208]:\n          - generic [ref=e209]:\n            - radio \"Millimetres\" [checked] [ref=e210]\n            - text: Millimetres\n          - generic [ref=e211]:\n            - radio \"Inches\" [ref=e212]\n            - text: Inches\n      - img \"Board elevation KW-0005\" [ref=e214]:\n        - generic [ref=e215]: \"0\"\n        - generic [ref=e216]: \"500\"\n        - generic [ref=e217]: \"1000\"\n        - generic [ref=e218]: \"1500\"\n        - generic [ref=e219]: \"2000\"\n        - generic [ref=e220]: \"2500\"\n        - generic [ref=e221]: \"3000\"\n      - region \"Layout\" [ref=e222]:\n        - group \"Cut list\"\n        - generic [ref=e223]:\n          - button \"Undo\" [disabled] [ref=e224]\n          - button \"Redo\" [disabled] [ref=e225]\n        - generic [ref=e226]:\n          - generic [ref=e227]:\n            - generic [ref=e228]: Piece label\n            - textbox \"Piece label\" [ref=e229]\n          - generic [ref=e230]:\n            - generic [ref=e231]: Piece length\n            - textbox \"Piece length\" [ref=e232]\n          - generic [ref=e233]:\n            - generic [ref=e234]: Piece width\n            - textbox \"Piece width\" [ref=e235]\n          - button \"Add piece\" [active] [ref=e237] [cursor=pointer]\n        - button \"Fit check\" [ref=e239] [cursor=pointer]\n        - status \"Fit result\" [ref=e240]\n        - status \"Hold status\" [ref=e241]\n        - status \"Layout totals\" [ref=e242]: Add a piece to see the take and price.\n        - link \"Sign in to hold\" [ref=e244] [cursor=pointer]:\n          - /url: /sign-in?next=%2Fboards%2FKW-0005"
}
```

### Tool call: browser_console_messages
- Args
```json
{
  "level": "error",
  "all": true
}
```
- Result
```json
{
  "result": "Total messages: 7 (Errors: 7, Warnings: 0)\n\n[ERROR] Failed to load resource: the server responded with a status of 401 (Unauthorized) @ http://127.0.0.1:4173/api/session:0\n[ERROR] Failed to load resource: the server responded with a status of 401 (Unauthorized) @ http://127.0.0.1:4173/api/session:0\n[ERROR] Failed to load resource: the server responded with a status of 401 (Unauthorized) @ http://127.0.0.1:4173/api/session:0\n[ERROR] Failed to load resource: the server responded with a status of 401 (Unauthorized) @ http://127.0.0.1:4173/api/session:0\n[ERROR] Failed to load resource: the server responded with a status of 401 (Unauthorized) @ http://127.0.0.1:4173/api/session:0\n[ERROR] Failed to load resource: the server responded with a status of 401 (Unauthorized) @ http://127.0.0.1:4173/api/session:0\n[ERROR] Failed to load resource: the server responded with a status of 401 (Unauthorized) @ http://127.0.0.1:4173/api/session:0"
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
{}
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
{
  "page": "- Page URL: http://127.0.0.1:4173/boards/KW-0005\n- Page Title: Kerfwell Rack\n- Console: 8 errors, 0 warnings",
  "events": "- New console entries: evidence/reduced/console-2026-11-05T15-56-15-825Z.log#L8"
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
  "events": "- New console entries: evidence/reduced/console-2026-11-05T15-56-15-825Z.log#L9"
}
```

### Tool call: browser_evaluate
- Args
```json
{
  "function": "() => [...document.querySelectorAll('#piece-label,#piece-length,#piece-width')].map(e=>e.value)"
}
```
- Result
```json
{
  "result": "[\n  \"Shelf A\",\n  \"600\",\n  \"100\"\n]"
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
  "page": "- Page URL: http://127.0.0.1:4173/boards/KW-0005\n- Page Title: Kerfwell Rack\n- Console: 27 errors, 0 warnings",
  "events": "- New console entries: evidence/reduced/console-2026-11-05T15-56-15-825Z.log#L10-L27"
}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "Enter"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/boards/KW-0005\n- Page Title: Kerfwell Rack\n- Console: 27 errors, 0 warnings",
  "snapshot": "- generic [ref=e2]:\n  - banner [ref=e3]:\n    - link \"Kerfwell\" [ref=e4] [cursor=pointer]:\n      - /url: /\n    - navigation [ref=e5]:\n      - link \"Sign in\" [ref=e6] [cursor=pointer]:\n        - /url: /sign-in\n  - status \"Service notice\"\n  - main [ref=e7]:\n    - generic [ref=e8]:\n      - generic [ref=e245]:\n        - heading \"KW-0005\" [level=1] [ref=e246]\n        - generic [ref=e247]: Available\n      - generic [ref=e248]:\n        - generic [ref=e249]: Heart pine · Select\n        - generic [ref=e250]: Pell Street shoe factory (1924)\n        - generic [ref=e251]: 1600 ¢/bd ft\n        - generic [ref=e252]: 3050 mm × 140 mm × 38 mm\n      - group \"Units\" [ref=e253]:\n        - radiogroup \"Units\" [ref=e255]:\n          - generic [ref=e256]:\n            - radio \"Millimetres\" [checked] [ref=e257]\n            - text: Millimetres\n          - generic [ref=e258]:\n            - radio \"Inches\" [ref=e259]\n            - text: Inches\n      - img \"Board elevation KW-0005\" [ref=e261]:\n        - generic [ref=e263]: \"0\"\n        - generic [ref=e264]: \"500\"\n        - generic [ref=e265]: \"1000\"\n        - generic [ref=e266]: \"1500\"\n        - generic [ref=e267]: \"2000\"\n        - generic [ref=e268]: \"2500\"\n        - generic [ref=e269]: \"3000\"\n      - region \"Layout\" [ref=e270]:\n        - group \"Cut list\" [ref=e271]:\n          - button \"Shelf A, 600 mm at 0 mm\" [ref=e272] [cursor=pointer]\n        - generic [ref=e273]:\n          - button \"Undo\" [ref=e274] [cursor=pointer]\n          - button \"Redo\" [disabled] [ref=e275]\n        - generic [ref=e276]:\n          - generic [ref=e277]:\n            - generic [ref=e278]: Piece label\n            - textbox \"Piece label\" [active] [ref=e279]\n          - generic [ref=e280]:\n            - generic [ref=e281]: Piece length\n            - textbox \"Piece length\" [ref=e282]\n          - generic [ref=e283]:\n            - generic [ref=e284]: Piece width\n            - textbox \"Piece width\" [ref=e285]\n          - button \"Add piece\" [ref=e287] [cursor=pointer]\n        - button \"Fit check\" [ref=e289] [cursor=pointer]\n        - status \"Fit result\" [ref=e290]\n        - status \"Hold status\" [ref=e291]\n        - status \"Layout totals\" [ref=e292]: Fix the layout to see the take and price.\n        - link \"Sign in to hold\" [ref=e294] [cursor=pointer]:\n          - /url: /sign-in?next=%2Fboards%2FKW-0005"
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
  "page": "- Page URL: http://127.0.0.1:4173/boards/KW-0005\n- Page Title: Kerfwell Rack\n- Console: 27 errors, 0 warnings",
  "inlineSnapshot": "- generic [ref=e2]:\n  - banner [ref=e3]:\n    - link \"Kerfwell\" [ref=e4] [cursor=pointer]:\n      - /url: /\n    - navigation [ref=e5]:\n      - link \"Sign in\" [ref=e6] [cursor=pointer]:\n        - /url: /sign-in\n  - status \"Service notice\"\n  - main [ref=e7]:\n    - generic [ref=e8]:\n      - generic [ref=e295]:\n        - heading \"KW-0005\" [level=1] [ref=e296]\n        - generic [ref=e297]: Available\n      - generic [ref=e298]:\n        - generic [ref=e299]: Heart pine · Select\n        - generic [ref=e300]: Pell Street shoe factory (1924)\n        - generic [ref=e301]: 1600 ¢/bd ft\n        - generic [ref=e302]: 3050 mm × 140 mm × 38 mm\n      - group \"Units\" [ref=e303]:\n        - radiogroup \"Units\" [ref=e305]:\n          - generic [ref=e306]:\n            - radio \"Millimetres\" [checked] [ref=e307]\n            - text: Millimetres\n          - generic [ref=e308]:\n            - radio \"Inches\" [ref=e309]\n            - text: Inches\n      - img \"Board elevation KW-0005\" [ref=e311]:\n        - generic [ref=e313]: \"0\"\n        - generic [ref=e314]: \"500\"\n        - generic [ref=e315]: \"1000\"\n        - generic [ref=e316]: \"1500\"\n        - generic [ref=e317]: \"2000\"\n        - generic [ref=e318]: \"2500\"\n        - generic [ref=e319]: \"3000\"\n      - region \"Layout\" [ref=e320]:\n        - group \"Cut list\" [ref=e321]:\n          - button \"Shelf A, 600 mm at 0 mm\" [ref=e322] [cursor=pointer]\n        - generic [ref=e323]:\n          - button \"Undo\" [ref=e324] [cursor=pointer]\n          - button \"Redo\" [disabled] [ref=e325]\n        - generic [ref=e326]:\n          - generic [ref=e327]:\n            - generic [ref=e328]: Piece label\n            - textbox \"Piece label\" [ref=e329]\n          - generic [ref=e330]:\n            - generic [ref=e331]: Piece length\n            - textbox \"Piece length\" [ref=e332]\n          - generic [ref=e333]:\n            - generic [ref=e334]: Piece width\n            - textbox \"Piece width\" [ref=e335]\n          - button \"Add piece\" [ref=e337] [cursor=pointer]\n        - button \"Fit check\" [ref=e339] [cursor=pointer]\n        - status \"Fit result\" [ref=e340]\n        - status \"Hold status\" [ref=e341]\n        - status \"Layout totals\" [ref=e342]: Fix the layout to see the take and price.\n        - link \"Sign in to hold\" [ref=e344] [cursor=pointer]:\n          - /url: /sign-in?next=%2Fboards%2FKW-0005"
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
  "page": "- Page URL: http://127.0.0.1:4173/boards/KW-0005\n- Page Title: Kerfwell Rack\n- Console: 28 errors, 0 warnings",
  "events": "- New console entries: evidence/reduced/console-2026-11-05T15-56-15-825Z.log#L28"
}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "Enter"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/boards/KW-0005\n- Page Title: Kerfwell Rack\n- Console: 29 errors, 0 warnings",
  "snapshot": "- generic [ref=e2]:\n  - banner [ref=e3]:\n    - link \"Kerfwell\" [ref=e4] [cursor=pointer]:\n      - /url: /\n    - navigation [ref=e5]:\n      - link \"Sign in\" [ref=e6] [cursor=pointer]:\n        - /url: /sign-in\n  - status \"Service notice\"\n  - main [ref=e7]:\n    - generic [ref=e8]:\n      - generic [ref=e345]:\n        - heading \"KW-0005\" [level=1] [ref=e346]\n        - generic [ref=e347]: Available\n      - generic [ref=e348]:\n        - generic [ref=e349]: Heart pine · Select\n        - generic [ref=e350]: Pell Street shoe factory (1924)\n        - generic [ref=e351]: 1600 ¢/bd ft\n        - generic [ref=e352]: 3050 mm × 140 mm × 38 mm\n      - group \"Units\" [ref=e353]:\n        - radiogroup \"Units\" [ref=e355]:\n          - generic [ref=e356]:\n            - radio \"Millimetres\" [checked] [ref=e357]\n            - text: Millimetres\n          - generic [ref=e358]:\n            - radio \"Inches\" [ref=e359]\n            - text: Inches\n      - img \"Board elevation KW-0005\" [ref=e361]:\n        - generic [ref=e363]: \"0\"\n        - generic [ref=e364]: \"500\"\n        - generic [ref=e365]: \"1000\"\n        - generic [ref=e366]: \"1500\"\n        - generic [ref=e367]: \"2000\"\n        - generic [ref=e368]: \"2500\"\n        - generic [ref=e369]: \"3000\"\n      - region \"Layout\" [ref=e370]:\n        - group \"Cut list\" [ref=e371]:\n          - button \"Shelf A, 600 mm at 0 mm\" [ref=e372] [cursor=pointer]\n        - generic [ref=e373]:\n          - button \"Undo\" [ref=e374] [cursor=pointer]\n          - button \"Redo\" [disabled] [ref=e375]\n        - generic [ref=e376]:\n          - generic [ref=e377]:\n            - generic [ref=e378]: Piece label\n            - textbox \"Piece label\" [ref=e379]\n          - generic [ref=e380]:\n            - generic [ref=e381]: Piece length\n            - textbox \"Piece length\" [ref=e382]\n          - generic [ref=e383]:\n            - generic [ref=e384]: Piece width\n            - textbox \"Piece width\" [ref=e385]\n          - button \"Add piece\" [ref=e387] [cursor=pointer]\n        - button \"Fit check\" [ref=e389] [cursor=pointer]\n        - status \"Fit result\" [ref=e390]\n        - status \"Hold status\" [ref=e391]\n        - status \"Layout totals\" [ref=e392]: Fix the layout to see the take and price.\n        - link \"Sign in to hold\" [ref=e394] [cursor=pointer]:\n          - /url: /sign-in?next=%2Fboards%2FKW-0005",
  "events": "- New console entries: evidence/reduced/console-2026-11-05T15-56-15-825Z.log#L29"
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
  "page": "- Page URL: http://127.0.0.1:4173/boards/KW-0005\n- Page Title: Kerfwell Rack\n- Console: 29 errors, 0 warnings",
  "snapshot": "- generic [ref=e2]:\n  - banner [ref=e3]:\n    - link \"Kerfwell\" [ref=e4] [cursor=pointer]:\n      - /url: /\n    - navigation [ref=e5]:\n      - link \"Sign in\" [ref=e6] [cursor=pointer]:\n        - /url: /sign-in\n  - status \"Service notice\"\n  - main [ref=e7]:\n    - generic [ref=e8]:\n      - generic [ref=e395]:\n        - heading \"KW-0005\" [level=1] [ref=e396]\n        - generic [ref=e397]: Available\n      - generic [ref=e398]:\n        - generic [ref=e399]: Heart pine · Select\n        - generic [ref=e400]: Pell Street shoe factory (1924)\n        - generic [ref=e401]: 1600 ¢/bd ft\n        - generic [ref=e402]: 3050 mm × 140 mm × 38 mm\n      - group \"Units\" [ref=e403]:\n        - radiogroup \"Units\" [ref=e405]:\n          - generic [ref=e406]:\n            - radio \"Millimetres\" [checked] [ref=e407]\n            - text: Millimetres\n          - generic [ref=e408]:\n            - radio \"Inches\" [ref=e409]\n            - text: Inches\n      - img \"Board elevation KW-0005\" [ref=e411]:\n        - generic [ref=e414]: offcut 2446 mm\n        - generic [ref=e415]: \"0\"\n        - generic [ref=e416]: \"500\"\n        - generic [ref=e417]: \"1000\"\n        - generic [ref=e418]: \"1500\"\n        - generic [ref=e419]: \"2000\"\n        - generic [ref=e420]: \"2500\"\n        - generic [ref=e421]: \"3000\"\n      - region \"Layout\" [ref=e422]:\n        - group \"Cut list\" [ref=e423]:\n          - button \"Shelf A, 600 mm at 0 mm\" [ref=e424] [cursor=pointer]\n        - generic [ref=e425]:\n          - button \"Undo\" [ref=e426] [cursor=pointer]\n          - button \"Redo\" [disabled] [ref=e427]\n        - generic [ref=e428]:\n          - generic [ref=e429]:\n            - generic [ref=e430]: Piece label\n            - textbox \"Piece label\" [ref=e431]\n          - generic [ref=e432]:\n            - generic [ref=e433]: Piece length\n            - textbox \"Piece length\" [ref=e434]\n          - generic [ref=e435]:\n            - generic [ref=e436]: Piece width\n            - textbox \"Piece width\" [ref=e437]\n          - button \"Add piece\" [ref=e439] [cursor=pointer]\n        - button \"Fit check\" [ref=e441] [cursor=pointer]\n        - status \"Fit result\" [ref=e442]: 1 of 1 cuts fit clear of defects, offcut 2446 mm\n        - status \"Hold status\" [ref=e443]\n        - status \"Layout totals\" [ref=e444]: Take 600 mm · Board feet 1.35 bd ft · Price $21.64 · Clear offcut 2446 mm\n        - link \"Sign in to hold\" [ref=e446] [cursor=pointer]:\n          - /url: /sign-in?next=%2Fboards%2FKW-0005"
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
  "page": "- Page URL: http://127.0.0.1:4173/boards/KW-0005\n- Page Title: Kerfwell Rack\n- Console: 29 errors, 0 warnings",
  "inlineSnapshot": "- generic [ref=e2]:\n  - banner [ref=e3]:\n    - link \"Kerfwell\" [ref=e4] [cursor=pointer]:\n      - /url: /\n    - navigation [ref=e5]:\n      - link \"Sign in\" [ref=e6] [cursor=pointer]:\n        - /url: /sign-in\n  - status \"Service notice\"\n  - main [ref=e7]:\n    - generic [ref=e8]:\n      - generic [ref=e395]:\n        - heading \"KW-0005\" [level=1] [ref=e396]\n        - generic [ref=e397]: Available\n      - generic [ref=e398]:\n        - generic [ref=e399]: Heart pine · Select\n        - generic [ref=e400]: Pell Street shoe factory (1924)\n        - generic [ref=e401]: 1600 ¢/bd ft\n        - generic [ref=e402]: 3050 mm × 140 mm × 38 mm\n      - group \"Units\" [ref=e403]:\n        - radiogroup \"Units\" [ref=e405]:\n          - generic [ref=e406]:\n            - radio \"Millimetres\" [checked] [ref=e407]\n            - text: Millimetres\n          - generic [ref=e408]:\n            - radio \"Inches\" [ref=e409]\n            - text: Inches\n      - img \"Board elevation KW-0005\" [ref=e411]:\n        - generic [ref=e414]: offcut 2446 mm\n        - generic [ref=e415]: \"0\"\n        - generic [ref=e416]: \"500\"\n        - generic [ref=e417]: \"1000\"\n        - generic [ref=e418]: \"1500\"\n        - generic [ref=e419]: \"2000\"\n        - generic [ref=e420]: \"2500\"\n        - generic [ref=e421]: \"3000\"\n      - region \"Layout\" [ref=e422]:\n        - group \"Cut list\" [ref=e423]:\n          - button \"Shelf A, 600 mm at 0 mm\" [ref=e424] [cursor=pointer]\n        - generic [ref=e425]:\n          - button \"Undo\" [ref=e426] [cursor=pointer]\n          - button \"Redo\" [disabled] [ref=e427]\n        - generic [ref=e428]:\n          - generic [ref=e429]:\n            - generic [ref=e430]: Piece label\n            - textbox \"Piece label\" [ref=e431]\n          - generic [ref=e432]:\n            - generic [ref=e433]: Piece length\n            - textbox \"Piece length\" [ref=e434]\n          - generic [ref=e435]:\n            - generic [ref=e436]: Piece width\n            - textbox \"Piece width\" [ref=e437]\n          - button \"Add piece\" [ref=e439] [cursor=pointer]\n        - button \"Fit check\" [ref=e441] [cursor=pointer]\n        - status \"Fit result\" [ref=e442]: 1 of 1 cuts fit clear of defects, offcut 2446 mm\n        - status \"Hold status\" [ref=e443]\n        - status \"Layout totals\" [ref=e444]: Take 600 mm · Board feet 1.35 bd ft · Price $21.64 · Clear offcut 2446 mm\n        - link \"Sign in to hold\" [ref=e446] [cursor=pointer]:\n          - /url: /sign-in?next=%2Fboards%2FKW-0005"
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
  "page": "- Page URL: http://127.0.0.1:4173/boards/KW-0005\n- Page Title: Kerfwell Rack\n- Console: 30 errors, 0 warnings",
  "events": "- New console entries: evidence/reduced/console-2026-11-05T15-56-15-825Z.log#L30"
}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "Enter"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/boards/KW-0005\n- Page Title: Kerfwell Rack\n- Console: 30 errors, 0 warnings",
  "snapshot": "- generic [ref=e2]:\n  - banner [ref=e3]:\n    - link \"Kerfwell\" [ref=e4] [cursor=pointer]:\n      - /url: /\n    - navigation [ref=e5]:\n      - link \"Sign in\" [ref=e6] [cursor=pointer]:\n        - /url: /sign-in\n  - status \"Service notice\"\n  - main [ref=e7]:\n    - generic [ref=e8]:\n      - generic [ref=e447]:\n        - heading \"KW-0005\" [level=1] [ref=e448]\n        - generic [ref=e449]: Available\n      - generic [ref=e450]:\n        - generic [ref=e451]: Heart pine · Select\n        - generic [ref=e452]: Pell Street shoe factory (1924)\n        - generic [ref=e453]: 1600 ¢/bd ft\n        - generic [ref=e454]: 3050 mm × 140 mm × 38 mm\n      - group \"Units\" [ref=e455]:\n        - radiogroup \"Units\" [ref=e457]:\n          - generic [ref=e458]:\n            - radio \"Millimetres\" [checked] [ref=e459]\n            - text: Millimetres\n          - generic [ref=e460]:\n            - radio \"Inches\" [ref=e461]\n            - text: Inches\n      - img \"Board elevation KW-0005\" [ref=e463]:\n        - generic [ref=e466]: \"0\"\n        - generic [ref=e467]: \"500\"\n        - generic [ref=e468]: \"1000\"\n        - generic [ref=e469]: \"1500\"\n        - generic [ref=e470]: \"2000\"\n        - generic [ref=e471]: \"2500\"\n        - generic [ref=e472]: \"3000\"\n      - region \"Layout\" [ref=e473]:\n        - group \"Cut list\" [ref=e474]:\n          - button \"Shelf A, 600 mm at 0 mm\" [ref=e475] [cursor=pointer]\n          - button \"Shelf B, 800 mm at 610 mm\" [ref=e476] [cursor=pointer]\n        - generic [ref=e477]:\n          - button \"Undo\" [ref=e478] [cursor=pointer]\n          - button \"Redo\" [disabled] [ref=e479]\n        - generic [ref=e480]:\n          - generic [ref=e481]:\n            - generic [ref=e482]: Piece label\n            - textbox \"Piece label\" [active] [ref=e483]\n          - generic [ref=e484]:\n            - generic [ref=e485]: Piece length\n            - textbox \"Piece length\" [ref=e486]\n          - generic [ref=e487]:\n            - generic [ref=e488]: Piece width\n            - textbox \"Piece width\" [ref=e489]\n          - button \"Add piece\" [ref=e491] [cursor=pointer]\n        - button \"Fit check\" [ref=e493] [cursor=pointer]\n        - status \"Fit result\" [ref=e494]: 1 of 1 cuts fit clear of defects, offcut 2446 mm\n        - status \"Hold status\" [ref=e495]\n        - status \"Layout totals\" [ref=e496]: Fix the layout to see the take and price.\n        - link \"Sign in to hold\" [ref=e498] [cursor=pointer]:\n          - /url: /sign-in?next=%2Fboards%2FKW-0005"
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
  "page": "- Page URL: http://127.0.0.1:4173/boards/KW-0005\n- Page Title: Kerfwell Rack\n- Console: 31 errors, 0 warnings",
  "snapshot": "- generic [ref=e2]:\n  - banner [ref=e3]:\n    - link \"Kerfwell\" [ref=e4] [cursor=pointer]:\n      - /url: /\n    - navigation [ref=e5]:\n      - link \"Sign in\" [ref=e6] [cursor=pointer]:\n        - /url: /sign-in\n  - status \"Service notice\"\n  - main [ref=e7]:\n    - generic [ref=e8]:\n      - generic [ref=e499]:\n        - heading \"KW-0005\" [level=1] [ref=e500]\n        - generic [ref=e501]: Available\n      - generic [ref=e502]:\n        - generic [ref=e503]: Heart pine · Select\n        - generic [ref=e504]: Pell Street shoe factory (1924)\n        - generic [ref=e505]: 1600 ¢/bd ft\n        - generic [ref=e506]: 3050 mm × 140 mm × 38 mm\n      - group \"Units\" [ref=e507]:\n        - radiogroup \"Units\" [ref=e509]:\n          - generic [ref=e510]:\n            - radio \"Millimetres\" [checked] [ref=e511]\n            - text: Millimetres\n          - generic [ref=e512]:\n            - radio \"Inches\" [ref=e513]\n            - text: Inches\n      - img \"Board elevation KW-0005\" [ref=e515]:\n        - generic [ref=e519]: offcut 1636 mm\n        - generic [ref=e520]: \"0\"\n        - generic [ref=e521]: \"500\"\n        - generic [ref=e522]: \"1000\"\n        - generic [ref=e523]: \"1500\"\n        - generic [ref=e524]: \"2000\"\n        - generic [ref=e525]: \"2500\"\n        - generic [ref=e526]: \"3000\"\n      - region \"Layout\" [ref=e527]:\n        - group \"Cut list\" [ref=e528]:\n          - button \"Shelf A, 600 mm at 0 mm\" [ref=e529] [cursor=pointer]\n          - button \"Shelf B, 800 mm at 610 mm\" [ref=e530] [cursor=pointer]\n        - generic [ref=e531]:\n          - button \"Undo\" [ref=e532] [cursor=pointer]\n          - button \"Redo\" [disabled] [ref=e533]\n        - generic [ref=e534]:\n          - generic [ref=e535]:\n            - generic [ref=e536]: Piece label\n            - textbox \"Piece label\" [ref=e537]\n          - generic [ref=e538]:\n            - generic [ref=e539]: Piece length\n            - textbox \"Piece length\" [ref=e540]\n          - generic [ref=e541]:\n            - generic [ref=e542]: Piece width\n            - textbox \"Piece width\" [ref=e543]\n          - button \"Add piece\" [ref=e545] [cursor=pointer]\n        - button \"Fit check\" [ref=e547] [cursor=pointer]\n        - status \"Fit result\" [ref=e548]: 2 of 2 cuts fit clear of defects, offcut 1636 mm\n        - status \"Hold status\" [ref=e549]\n        - status \"Layout totals\" [ref=e550]: Take 1410 mm · Board feet 3.18 bd ft · Price $50.86 · Clear offcut 1636 mm\n        - link \"Sign in to hold\" [ref=e552] [cursor=pointer]:\n          - /url: /sign-in?next=%2Fboards%2FKW-0005",
  "events": "- New console entries: evidence/reduced/console-2026-11-05T15-56-15-825Z.log#L31"
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
  "page": "- Page URL: http://127.0.0.1:4173/boards/KW-0005\n- Page Title: Kerfwell Rack\n- Console: 31 errors, 0 warnings",
  "inlineSnapshot": "- generic [ref=e2]:\n  - banner [ref=e3]:\n    - link \"Kerfwell\" [ref=e4] [cursor=pointer]:\n      - /url: /\n    - navigation [ref=e5]:\n      - link \"Sign in\" [ref=e6] [cursor=pointer]:\n        - /url: /sign-in\n  - status \"Service notice\"\n  - main [ref=e7]:\n    - generic [ref=e8]:\n      - generic [ref=e499]:\n        - heading \"KW-0005\" [level=1] [ref=e500]\n        - generic [ref=e501]: Available\n      - generic [ref=e502]:\n        - generic [ref=e503]: Heart pine · Select\n        - generic [ref=e504]: Pell Street shoe factory (1924)\n        - generic [ref=e505]: 1600 ¢/bd ft\n        - generic [ref=e506]: 3050 mm × 140 mm × 38 mm\n      - group \"Units\" [ref=e507]:\n        - radiogroup \"Units\" [ref=e509]:\n          - generic [ref=e510]:\n            - radio \"Millimetres\" [checked] [ref=e511]\n            - text: Millimetres\n          - generic [ref=e512]:\n            - radio \"Inches\" [ref=e513]\n            - text: Inches\n      - img \"Board elevation KW-0005\" [ref=e515]:\n        - generic [ref=e519]: offcut 1636 mm\n        - generic [ref=e520]: \"0\"\n        - generic [ref=e521]: \"500\"\n        - generic [ref=e522]: \"1000\"\n        - generic [ref=e523]: \"1500\"\n        - generic [ref=e524]: \"2000\"\n        - generic [ref=e525]: \"2500\"\n        - generic [ref=e526]: \"3000\"\n      - region \"Layout\" [ref=e527]:\n        - group \"Cut list\" [ref=e528]:\n          - button \"Shelf A, 600 mm at 0 mm\" [ref=e529] [cursor=pointer]\n          - button \"Shelf B, 800 mm at 610 mm\" [ref=e530] [cursor=pointer]\n        - generic [ref=e531]:\n          - button \"Undo\" [ref=e532] [cursor=pointer]\n          - button \"Redo\" [disabled] [ref=e533]\n        - generic [ref=e534]:\n          - generic [ref=e535]:\n            - generic [ref=e536]: Piece label\n            - textbox \"Piece label\" [ref=e537]\n          - generic [ref=e538]:\n            - generic [ref=e539]: Piece length\n            - textbox \"Piece length\" [ref=e540]\n          - generic [ref=e541]:\n            - generic [ref=e542]: Piece width\n            - textbox \"Piece width\" [ref=e543]\n          - button \"Add piece\" [ref=e545] [cursor=pointer]\n        - button \"Fit check\" [ref=e547] [cursor=pointer]\n        - status \"Fit result\" [ref=e548]: 2 of 2 cuts fit clear of defects, offcut 1636 mm\n        - status \"Hold status\" [ref=e549]\n        - status \"Layout totals\" [ref=e550]: Take 1410 mm · Board feet 3.18 bd ft · Price $50.86 · Clear offcut 1636 mm\n        - link \"Sign in to hold\" [ref=e552] [cursor=pointer]:\n          - /url: /sign-in?next=%2Fboards%2FKW-0005"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Undo",
  "target": "#undo"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/boards/KW-0005\n- Page Title: Kerfwell Rack\n- Console: 31 errors, 0 warnings",
  "snapshot": "- generic [ref=e2]:\n  - banner [ref=e3]:\n    - link \"Kerfwell\" [ref=e4] [cursor=pointer]:\n      - /url: /\n    - navigation [ref=e5]:\n      - link \"Sign in\" [ref=e6] [cursor=pointer]:\n        - /url: /sign-in\n  - status \"Service notice\"\n  - main [ref=e7]:\n    - generic [ref=e8]:\n      - generic [ref=e553]:\n        - heading \"KW-0005\" [level=1] [ref=e554]\n        - generic [ref=e555]: Available\n      - generic [ref=e556]:\n        - generic [ref=e557]: Heart pine · Select\n        - generic [ref=e558]: Pell Street shoe factory (1924)\n        - generic [ref=e559]: 1600 ¢/bd ft\n        - generic [ref=e560]: 3050 mm × 140 mm × 38 mm\n      - group \"Units\" [ref=e561]:\n        - radiogroup \"Units\" [ref=e563]:\n          - generic [ref=e564]:\n            - radio \"Millimetres\" [checked] [ref=e565]\n            - text: Millimetres\n          - generic [ref=e566]:\n            - radio \"Inches\" [ref=e567]\n            - text: Inches\n      - img \"Board elevation KW-0005\" [ref=e569]:\n        - generic [ref=e571]: \"0\"\n        - generic [ref=e572]: \"500\"\n        - generic [ref=e573]: \"1000\"\n        - generic [ref=e574]: \"1500\"\n        - generic [ref=e575]: \"2000\"\n        - generic [ref=e576]: \"2500\"\n        - generic [ref=e577]: \"3000\"\n      - region \"Layout\" [ref=e578]:\n        - group \"Cut list\" [ref=e579]:\n          - button \"Shelf A, 600 mm at 0 mm\" [ref=e580] [cursor=pointer]\n        - generic [ref=e581]:\n          - button \"Undo\" [ref=e582] [cursor=pointer]\n          - button \"Redo\" [ref=e583] [cursor=pointer]\n        - generic [ref=e584]:\n          - generic [ref=e585]:\n            - generic [ref=e586]: Piece label\n            - textbox \"Piece label\" [ref=e587]\n          - generic [ref=e588]:\n            - generic [ref=e589]: Piece length\n            - textbox \"Piece length\" [ref=e590]\n          - generic [ref=e591]:\n            - generic [ref=e592]: Piece width\n            - textbox \"Piece width\" [ref=e593]\n          - button \"Add piece\" [ref=e595] [cursor=pointer]\n        - button \"Fit check\" [ref=e597] [cursor=pointer]\n        - status \"Fit result\" [ref=e598]: 2 of 2 cuts fit clear of defects, offcut 1636 mm\n        - status \"Hold status\" [ref=e599]\n        - status \"Layout totals\" [ref=e600]: Fix the layout to see the take and price.\n        - link \"Sign in to hold\" [ref=e602] [cursor=pointer]:\n          - /url: /sign-in?next=%2Fboards%2FKW-0005"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Redo",
  "target": "#redo"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/boards/KW-0005\n- Page Title: Kerfwell Rack\n- Console: 32 errors, 0 warnings",
  "snapshot": "- generic [ref=e2]:\n  - banner [ref=e3]:\n    - link \"Kerfwell\" [ref=e4] [cursor=pointer]:\n      - /url: /\n    - navigation [ref=e5]:\n      - link \"Sign in\" [ref=e6] [cursor=pointer]:\n        - /url: /sign-in\n  - status \"Service notice\"\n  - main [ref=e7]:\n    - generic [ref=e8]:\n      - generic [ref=e603]:\n        - heading \"KW-0005\" [level=1] [ref=e604]\n        - generic [ref=e605]: Available\n      - generic [ref=e606]:\n        - generic [ref=e607]: Heart pine · Select\n        - generic [ref=e608]: Pell Street shoe factory (1924)\n        - generic [ref=e609]: 1600 ¢/bd ft\n        - generic [ref=e610]: 3050 mm × 140 mm × 38 mm\n      - group \"Units\" [ref=e611]:\n        - radiogroup \"Units\" [ref=e613]:\n          - generic [ref=e614]:\n            - radio \"Millimetres\" [checked] [ref=e615]\n            - text: Millimetres\n          - generic [ref=e616]:\n            - radio \"Inches\" [ref=e617]\n            - text: Inches\n      - img \"Board elevation KW-0005\" [ref=e619]:\n        - generic [ref=e622]: \"0\"\n        - generic [ref=e623]: \"500\"\n        - generic [ref=e624]: \"1000\"\n        - generic [ref=e625]: \"1500\"\n        - generic [ref=e626]: \"2000\"\n        - generic [ref=e627]: \"2500\"\n        - generic [ref=e628]: \"3000\"\n      - region \"Layout\" [ref=e629]:\n        - group \"Cut list\" [ref=e630]:\n          - button \"Shelf A, 600 mm at 0 mm\" [ref=e631] [cursor=pointer]\n          - button \"Shelf B, 800 mm at 610 mm\" [ref=e632] [cursor=pointer]\n        - generic [ref=e633]:\n          - button \"Undo\" [ref=e634] [cursor=pointer]\n          - button \"Redo\" [disabled] [ref=e635]\n        - generic [ref=e636]:\n          - generic [ref=e637]:\n            - generic [ref=e638]: Piece label\n            - textbox \"Piece label\" [ref=e639]\n          - generic [ref=e640]:\n            - generic [ref=e641]: Piece length\n            - textbox \"Piece length\" [ref=e642]\n          - generic [ref=e643]:\n            - generic [ref=e644]: Piece width\n            - textbox \"Piece width\" [ref=e645]\n          - button \"Add piece\" [ref=e647] [cursor=pointer]\n        - button \"Fit check\" [ref=e649] [cursor=pointer]\n        - status \"Fit result\" [ref=e650]: 2 of 2 cuts fit clear of defects, offcut 1636 mm\n        - status \"Hold status\" [ref=e651]\n        - status \"Layout totals\" [ref=e652]: Fix the layout to see the take and price.\n        - link \"Sign in to hold\" [ref=e654] [cursor=pointer]:\n          - /url: /sign-in?next=%2Fboards%2FKW-0005",
  "events": "- New console entries: evidence/reduced/console-2026-11-05T15-56-15-825Z.log#L32"
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
  "page": "- Page URL: http://127.0.0.1:4173/boards/KW-0005\n- Page Title: Kerfwell Rack\n- Console: 32 errors, 0 warnings",
  "snapshot": "- generic [ref=e2]:\n  - banner [ref=e3]:\n    - link \"Kerfwell\" [ref=e4] [cursor=pointer]:\n      - /url: /\n    - navigation [ref=e5]:\n      - link \"Sign in\" [ref=e6] [cursor=pointer]:\n        - /url: /sign-in\n  - status \"Service notice\"\n  - main [ref=e7]:\n    - generic [ref=e8]:\n      - generic [ref=e603]:\n        - heading \"KW-0005\" [level=1] [ref=e604]\n        - generic [ref=e605]: Available\n      - generic [ref=e606]:\n        - generic [ref=e607]: Heart pine · Select\n        - generic [ref=e608]: Pell Street shoe factory (1924)\n        - generic [ref=e609]: 1600 ¢/bd ft\n        - generic [ref=e610]: 3050 mm × 140 mm × 38 mm\n      - group \"Units\" [ref=e611]:\n        - radiogroup \"Units\" [ref=e613]:\n          - generic [ref=e614]:\n            - radio \"Millimetres\" [checked] [ref=e615]\n            - text: Millimetres\n          - generic [ref=e616]:\n            - radio \"Inches\" [ref=e617]\n            - text: Inches\n      - img \"Board elevation KW-0005\" [ref=e655]:\n        - generic [ref=e659]: offcut 1636 mm\n        - generic [ref=e660]: \"0\"\n        - generic [ref=e661]: \"500\"\n        - generic [ref=e662]: \"1000\"\n        - generic [ref=e663]: \"1500\"\n        - generic [ref=e664]: \"2000\"\n        - generic [ref=e665]: \"2500\"\n        - generic [ref=e666]: \"3000\"\n      - region \"Layout\" [ref=e629]:\n        - group \"Cut list\" [ref=e630]:\n          - button \"Shelf A, 600 mm at 0 mm\" [ref=e667] [cursor=pointer]\n          - button \"Shelf B, 800 mm at 610 mm\" [ref=e668] [cursor=pointer]\n        - generic [ref=e633]:\n          - button \"Undo\" [ref=e634] [cursor=pointer]\n          - button \"Redo\" [disabled] [ref=e635]\n        - generic [ref=e636]:\n          - generic [ref=e637]:\n            - generic [ref=e638]: Piece label\n            - textbox \"Piece label\" [ref=e639]\n          - generic [ref=e640]:\n            - generic [ref=e641]: Piece length\n            - textbox \"Piece length\" [ref=e642]\n          - generic [ref=e643]:\n            - generic [ref=e644]: Piece width\n            - textbox \"Piece width\" [ref=e645]\n          - button \"Add piece\" [ref=e647] [cursor=pointer]\n        - button \"Fit check\" [ref=e649] [cursor=pointer]\n        - status \"Fit result\" [ref=e650]: 2 of 2 cuts fit clear of defects, offcut 1636 mm\n        - status \"Hold status\" [ref=e651]\n        - status \"Layout totals\" [ref=e652]: Take 1410 mm · Board feet 3.18 bd ft · Price $50.86 · Clear offcut 1636 mm\n        - link \"Sign in to hold\" [ref=e669] [cursor=pointer]:\n          - /url: /sign-in?next=%2Fboards%2FKW-0005"
}
```

### Tool call: browser_evaluate
- Args
```json
{
  "function": "() => {const ks=[...document.querySelectorAll('[data-kerf]')];const b=document.querySelector('#fit-check');return {kerfs:ks.map(e=>({stroke:getComputedStyle(e).stroke,fill:getComputedStyle(e).fill,outer:e.outerHTML})),button:{background:getComputedStyle(b).backgroundColor,border:getComputedStyle(b).borderColor,color:getComputedStyle(b).color},fit:document.querySelector('#fit-result')?.textContent}}"
}
```
- Result
```json
{
  "result": "{\n  \"kerfs\": [\n    {\n      \"stroke\": \"rgb(193, 68, 14)\",\n      \"fill\": \"rgb(0, 0, 0)\",\n      \"outer\": \"<line class=\\\"kerf-line\\\" data-kerf=\\\"600\\\" x1=\\\"173.11\\\" y1=\\\"0\\\" x2=\\\"173.11\\\" y2=\\\"92\\\"></line>\"\n    },\n    {\n      \"stroke\": \"rgb(193, 68, 14)\",\n      \"fill\": \"rgb(0, 0, 0)\",\n      \"outer\": \"<line class=\\\"kerf-line\\\" data-kerf=\\\"610\\\" x1=\\\"176.00\\\" y1=\\\"0\\\" x2=\\\"176.00\\\" y2=\\\"92\\\"></line>\"\n    },\n    {\n      \"stroke\": \"rgb(193, 68, 14)\",\n      \"fill\": \"rgb(0, 0, 0)\",\n      \"outer\": \"<line class=\\\"kerf-line\\\" data-kerf=\\\"1410\\\" x1=\\\"406.82\\\" y1=\\\"0\\\" x2=\\\"406.82\\\" y2=\\\"92\\\"></line>\"\n    }\n  ],\n  \"button\": {\n    \"background\": \"rgba(193, 68, 14, 0.1)\",\n    \"border\": \"rgb(193, 68, 14)\",\n    \"color\": \"rgb(193, 68, 14)\"\n  },\n  \"fit\": \"2 of 2 cuts fit clear of defects, offcut 1636 mm\"\n}",
  "page": "- Page URL: http://127.0.0.1:4173/boards/KW-0005\n- Page Title: Kerfwell Rack\n- Console: 33 errors, 0 warnings",
  "events": "- New console entries: evidence/reduced/console-2026-11-05T15-56-15-825Z.log#L33"
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
  "result": "- [Screenshot of viewport](evidence/reduced/page-2026-11-05T16-00-28-588Z.png)",
  "attachments": [
    {
      "type": "image",
      "data": "iVBORw0KGgoAAAANSUhEUgAABQAAAAMgCAIAAADz+lisAAAQAElEQVR4nOzdBVwU6R/H8SFEBRUxEAMDRVFRwe44uzvPOs9uvfPs0wv17G7P9oyzu7vPFuxODBBUUBDl/2Pnbv/rEmKjz+d9vLjZZ56dnZ2ZlfnOb2bWOiTITwMAAAAA4GtnqQEAAAAAoAACMAAAAABACQRgAAAAAIASCMAAAAAAACUQgAEAAAAASiAAAwAAAACUQAAGAAAAACiBAAwAAAAAUAIBGAAAAACgBAIwAAAAAEAJBGAAAAAAgBIIwAAAAAAAJRCAAQAAAABKIAADAAAAAJRAAAYAAAAAKIEADAAAAABQAgEYAAAAAKCEdwnAbVq28cyZu2SxUsaWUSNHS4v8HD9+Qntv165d69e3f81qtfLnKRDgH6B9UBvWb9BndeaMmXqLvJA8LFOqrAYAAAAA+HpZa2/v5atX4b9fvtQf3rp1e+GChTJQuHAhT08P7f08e/asbat29+7d0x/axLXRPqiECRP+O5Do9QELDQAAAADwFXuXAGxm0oRJoaGhMtC1e1ftvV04f0FPv3nz5f2+ZYv48eNrAAAAAAC8t/e9BvjihYsb1m+QgfIVyrtmdtXe2927d/WBOnXrFCxUUAMAAAAAxErBwcHDhg6vULZiqeLfDPx5oL+/vzQO+n1w6ZJlvL28tXdy8eKlMt+U7d/3Z+0jeN8APGb02PCpWFp27NzRbNTWLVu/a9aiaOFiJYuVatmi1f59+42jJDbrF+JOmzKtT6++RQoWHfTbIGn/c8afvXv20fv0+qmXdLh167YMd2jXUYabNGqqj/p14G/ysF7tevrD8eMmyMOihYrF5KUBAAAAAB/EtKnTFy5Y6OHpkS17tlUrVw8dMkwafe76+Pn5PX/+XHsnwcHPfR/6Gq+K/bDe5RRoCwsL/ffx4yf0bFm3Xp00aVKb9lm7Zq1pZD965Kj8jBk/pkSJ4lr4VcT/Xj+8du26mzduGrvZ2MQ1e6E4ccLnMJNrJnmhM2fOvHr1SsK2t3f4sQQ5MPDs2bP48eOf8T4jDzP/V3+O/qUBAAAAAB/EgX37c+TM8cewITLctVPXPbv3yMDAXwfcunkrl0cu7Z24u7vPmTc7VapU2kfwLhXgsLAw+f3ixYtRw0fJQJw4cVq1aWXWZ+L4ifqoTp07tm7bWgbk4VhDudiUpN/EiRPnyZunQMEC8rBJ08a/DfpVHzVi1IhjJ4+mSJFCC18E2eW3pN/r167L76tXrup9pJIsvy9duhTeJ4f7W700AAAAAOB9vHgRGhwcrA8XL1ncLavby5cvly5Z2rzpd76+vpohrDVt3Kx4kRIjho0oXKBIvz79NMMpvXk980lw+6ZE6Ub1G509e850mpL4vmvWYurUaTK8bu16z5y55bnVq9SoWK6iFDu19/Pup0BLRdvLy0sz3A5a3rbpqAD/AB+f8IL1N6VLtWjZol37tqW+KSkPr129FhIcYtozefLkK1YvnzFzepmyZaJ5rRw5c+oDsviuXLki2Vt/eOHCRSkCP3zwUIazu7u/1UsDAAAAAN6HpK0L5y8sX7ZchmvVriXJzsrKSo+H+u+hQ4adP3dectndu3clu+m3T5ZAJynyjPeZlq2/v3zlyoihw02nKQVXycChhtCnR789u/c2bd7UwtLy918HBQYGau/hfa8B1gwBffHCRaYtTwOf6gP29on1gcSJHTTDO3n8+LFpzzLlykgFWHsTJ6cUyZInkwGp/V66GF7vlcUqvy9dvGg8WpArV863emkAAAAAwPto066NlB5/++X39m07PHnyxGyspLDjx46XKFmi4bcNBw0ZpF9La/Tr7782+rZRiRIlTp48pZ9lHJV2HdrWrlOrWfNmUm3W8+A7e68A7OHpkcUtiwysWL4yJCSS+uqSxUv0m13JQKRTMH4r7xvlyhV+BrmUfy9dvKyFH2kopRlOgb5sOP9ZUrRTSqe3emkAAAAAwPuQwuSIUSN69vrpyD9HGtRtaHqDJ81QK5VKr52drQzHixdPvzrVKGmypPJbxkof6RnNqyRN+m9P+S1lZO09vHsAtrS0/HlA/3r168pwQEDAurXrYvQsq3d8Rf0S38uXruhX/FapVkV+S/n38qXwPOyZ2/ONU3jnlwYAAAAARErqug0aNRg/cdyjR496/PiTFru9y12gdba2thlcMqROk3rUyNGBTwPnzZ1fs1ZNsz716tfr3beX9iHkMATga9eu6ddS582TRw4Y+D703W24z5h+l6yP9NIAAAAAgIh+7jcgWbKknbt2LlCwQO06tebPWyAxWIvF3rcoamNjU6NGdc1wda5UvfXGBAkS6APGs8DnzJ7TskWrDu06au9KKsBScw4NDZUFmjJVSrsEdq6u4d97dPfOXc3kFtAf46UBAAAAABHduHFj7569+rCENakG29naGcdKgrO2tvb19ZNhyXGRXjb7ib17BdiofoP6fy1YGBYWtmjhorz58mrhN6Cyd3JK4eNzb+uWra6umVKlTj1pwmR5txkzZtTeVdy4cTO5Zrpw/oIMZzZEX5nywQMH9bHG75j6GC8NAAAAAIiocOFCkydNadTg21SpUm3bui1/gfw2cW2MYyUPZ8oUntrGjRl35b/vsv28PsBlsc5pnQsXKSwDO7bv1L+CSHTo1EEz3LR63NjxvX7qpWf9OvXqaO/B3f3fMm9G10zy2zWz678PM2aUeGzs9jFeGgAAAABgpnmL5k2aNvb395f0K7ls4C8DtPDcGz7K0jL8f7/8NtAtq9vSv5elTesseTh+/PiGDhb/vyO0YcD0BtEW/7ZYGoelkhw+rP1/+J29y5OtDC+pfxGRrn6DeprhHl9LlyzVW6pUrTJy9EgPTw+7BOEVcAmo3bp3bdCw/n9TsDKd1Gsz9F+LVYR7VuXM9e+3AWfOnFl+u7m5mbXH5KWlBK8P6As0vMXwRiwtuEUWAAAAALwFGxub7j92X79x3fFTx5au+DtlqpSaoSQpDx0dHWU4c5bMc+fP2b1vV+UqlcPCwtI4p9HCvwDpl2Mnj+pTGDDwZ+lsGmtlWFp+HthfhqvXqCbDefLmkeHKVSvLsBSZtfdgERLkpwEAAAAA8BEcPHDwyD9Hly1dFhgYuGb96hQpUmifzwe4BhgAAAAAgEjt3LFz7Zp1mTO7duzS6fOmX40KMAAAAABAEVz4CgAAAABQAgEYAAAAAKAEAjAAAAAAQAkEYAAAAACAEgjAAAAAAAAlEIABAAAAAEogAAMAAAAAlEAABgAAAAAogQAMAAAAAFACARgAAAAAoAQCMAAAAABACQRgAAAAAIASCMAAAAAAACUQgAEAAAAASiAAAwAAAACUYJE9U3oNAAAAAICvnUVIkJ8GAAAAAMDXjlOgAQAAAABKIAADAAAAAJRAAAYAAAAAKIEADAAAAABQAgEYAAAAAKAEAjAAAAAAQAkEYAAAAACAEgjAAAAAAAAlEIABAAAAAEogAAMAAAAAlEAABgAAAAAogQAMAAAAAFACARgAAAAAoAQCMAAAAABACQRgAAAAAIASCMAAAAAAACUQgAEAAAAASiAAAwAAAACUQAAGAAAAACiBAAwAAAAAUAIBGAAAAACgBAIwAAAAAEAJBGAAAAAAgBIIwAAAAAAAJRCAAQAAAABKIAADAAAAAJRAAAYAAAAAKIEADAAAAABQAgEYAAAAAKAEAjAAAAAAQAkEYAAAAACAEgjAAAAAAAAlEIABAAAAAEogAAMAAAAAlEAABgAAAAAogQAMAAAAAFACARgAAAAAoAQCMAAAAABACQRgAAAAAIASCMAAAAAAACUQgAEAAAAASiAAAwAAAACUQAAGAAAAACiBAAwAAAAAUIK1poBdO3d17dzN+NDOzm7V2pVJkyY167Zv776ffuwZFBRkbOnctfN3LZrLwLFjx79v/r1p58lTJxUsVNBsClUrV7t185Y+nChRouWrlpm9yqmTp5o1aW7aMnfB3Bw53LX34Ovru3vX7jPeZ86dPX/58uUMLhmyZnXLlj1b8eLFkyVPFmunEOAfUKVS1adPn2ox1rjJtz/0+EEDAAAAgHeiRAC+f/++6cPAwMDHAY/NomloaOhvv/xumn6tra0rVa6oD8ePF89smocP/2MWgO/euWtMv+Lx48cSCIsVL2ba5+SJk2bTiRdhyjEXFhb295K/J4yb+OTJE2OjvKj8LFu6XHJ+2/ZtG33b0NLSMhZO4Wng07dKv+LuXR8NAAAAAN4Vp0D/a+mSpffu3TNtqVu/booUKfRh18yukodNx169ctVsCtevXzdruXb1WvR94sSJkzGji/ZOJHA2+bbpkEF/mCZPU5LzRw4fWadWXbP8H6umAAAAAACfDAE43LNnz6ZMnmraEj9+/DZtWhsfSvrNlCmTaYfLly+bTeT69RtmLVeumofkGzdumj7MlCljNMXV6Emw9PbyfmM3CeoSUGPtFAAAAADgk1HiFOg3mjdnXkBAgGlL0+ZN7RPbm7Zkcct87tw548ObN26+ePFCSrjGlogV4IhVYrOacOYsmbV3cuzosVUrV5s12iWwS58+/fVr181OLd65Y+fWLVvLlC0T26ZgxtHR0TmtczQdsmXLqgEAAADAuyIAh9+NafasOaYt9vb2zZo3NevmljWrWd6TIrCbm5vx4Y0IFeCLFy6aPgwJCXnw4IFpS5YsWbR3smTxErOWOvXq9Onb28LCQobHjRk3a+Zs07GLFy0xC5+xYQpmmjRr0rjJtxoAAAAAfBycAq3NmD7j2bNnpi2t27aKHz++WbesWd3MWi5fumL6MGIFOCgoyPeh7//7X75i1uGdK8BmJx7nyJmjb78+evLUDDevNrv51ulTp2PhFAAAAADgU1I9APv43Fu0cLFpi6OjY7369SL2zOKWxex63StX/h9oX716def2nYjPMu1zLcIlwdnds2tvLyAg4Nat26Yt3zY2L5w2btrY9GFwcLDp+dixYQoAAAAA8ImpHoAnT5wcGhpq2tKxcwezGz7r4sWLlz5DetMW0zh3/dp1ycARn3XFpI/ZOdKpU6d+t+9A8jrtZdbi7JzGrCWts/nFtF5eXrFqCgAAAADwiSkdgK9dvbZ2zVrTlnTp0lWuUjmq/qZX/Grhp0D//0bQVyN849G/7SYVYLPbRL/z+c83Tb5tWJcgYQKzlkT2icxarl27HqumAAAAAACfmNIBePy48WZl224/dI3me4nc3F67Z9WtW7devHihD9+4cSPSp5gGY7OLhN85AGthYdrbe/XyZeyaAgAAAAB8WuoGYG8v7+3bdpi2eHh6lChZIpqnuL1+HywJz1f+u69VxDtg6UyvAb7+ev0zc+Z3DcAAAAAAgLenxNcgWWgW5i0WFiOHjzRr7PHTj1q03CLcCFrybRZDWfiWySnBcePGDQ4O1ocfPngY+DTQLoGdr69vYGDg61N7x+9A+rpJLX3fnn3nzp0PCAiQBZ41W9ZixYpGU5YHAAAAgBhS9HuAD+w/cPz4CdMWqf1moHSMLwAAEABJREFUy54t+mclTJgwjXMa06xr/Caka9euGRvr1K29YP5fxocSknPkzHHt9YuE48WLlypVKg0mXrx4MaD/wNWr/v9ly7t27tIM99/u93Nfd3d3DQAAAADegxKFtTDN/ILVCeMnmrXUrF1Ti4GsWbOaPrx6NTwAS2lXKr3GxuKvn0etf/2v2TnSbwzbCho3Zpxp+jU6f+78d01bXIviNmMAAAAAEEOKnlkaFBRk1nLo4KEYPM/8Plh6Bdjs+43y589na2trfHjV8PW/H+oW0GoKDQ0dOOAXDQAAAADeA5dW/ktqj8+fP39jtyyvB+CbN2++ePFCj7g6p5RO8jtjpozGFv3rgs3ugJWFO2C9pZMnTl6+fFkDAAAAgHel6DXAEQU+DVyzek3denWj75YjZw7Th69evbp29ZppdTdt2rTyO3369KdPndZb9K8CNjsF2hikb9++PaD/QO1NpGL8U88e2teuSNEijZt8m909+4njJ0YMG2n25VLHjx7PmDHjW03QM2duTRnHTx3TAAAAAESNAPx/ixYufmMATpQokZNTCh+fe8YWKUuaVnfTpnWW3y4ZXYwtt27dDg4ONruENWu2f68l9n/kf/TIUe1NIp6z/fVJnDjx4D8GyRKW4WLFi2XKlKlKpaqmX9R89OixOvXqaG/J6+JVTQHurhk0AAAAANFSOgBLvXHf3n3Gh1cuXznyz5G8+fJG/yy3rFlNA/CVK1dNC5Vp06XTwivA6Uyfsmf3HtOHrpldNeUlSJAgT948pi01a9XU068uZaqU+fLnM702++TJkxoAAAAAvCt1A3C9+vVatW5ZvmwF0xrj4kVL3hyA3bLs3LHT+PDCufOmN8FKmy78FOgMLq+V47Zu2Wr6MDMBWNPs7e1nzJwefZ9MmTKaBmCfuz4vX760srLSAAAAAODtKXoTLKk0tu/YLlnyZKW+KWnavn3bdtMvNIqU2X2wdu3aHRgYaHyYznANsLOzs6Xl/5ftpo2bTZ+S2eQOWHYJ7CwsLLQ3SZw4saaeFE5Opg/DwsJ8fHw0AAAAAHgnilaAO3XpJBVIGahTt862rduN7VINXrLk7/Yd2kXzXLfXvwrYlIRevQIsA+nSp9Pv/xyRaYROnz79sZNvvgZYTabfJqULfBqoAQAAAMA7UbQCnCfPvzcHLlCwgP7FRUZLFi95+fJlNM91ckqRMGHCSEelSp3KWPh1cYnypkTGO2AhehFL46/CXmkfVIfW37u7ZjiwP/xS8NDQUBlu36qFPqpsiSL1alaL2E3XruV3BTzcIw6/NrevXhX0zOGZLfPzZ8+MjXlyZJVJeWR1bVy/zsH/JvjntCnSeMbrtOnTZbLSaPzZtWO7BgAAAOA9qH4XaAsLi3r1640bM87YEuAfsGnjpkqVK0XzrBw53PfvPxCxXf8OJF269Okjfa6jo6PprZ7egYXluxy2MH1WbJiCWLhgoX9AgPFh1WpV06RJbdpBEqnZFOLaxNU+qKNH/pHfJ48fK1S4iLW1dfoMGS6cP6cZbrt9986dfAUKRuymt7wKFxZx2NTlixefPn0qA97eXnny5tMbw169ck6brnjJksv+XtKhTcutu/Y5JEmiX4huNhFplOMpbdp31B+mz+CiAQAAAHgPfA2SVrNWjYnjJ5pWfZcs/jv6AJwlq1sUAdjZOGx2I2ijzFkya+9HStBmLU+fPDVreRzw2KwlVcqUsWoKISEhw4YONx37LCio+4/dTVv8H/mbTeE9jx2YuX3r5tMnT+LGi3fW20tvccuWfeO6tTJvly5ekIfZsrtH2i2GvE6f1G/ZJaVdYwDWwu+RlrF3/4Gumd0G9ut97OiR0mXLRTWFuHHjdejSTQMAAADwISh6CrSpxIkTlylb2rTl5ImTly9fjuYpbm5ukbanS/f/0JshilOg3z8AZ8yUyazl5s1bZi03bt40a3HJlDFWTcHGxiZp0qSmY0+ePGXW/5rJFywLCZMOSRy0D8frdPgpx9+UKet1+t+X1hPvxfPnr1y+ZHiYI9JuMXTG29slY0aJu16nInlickdHzfCmNAAAAACfBAE4XO06tc1a5s+dH03/rFkjD8DOJhVgF5fIT1g1vQX0u0mTJrWkR9OWhX8tNOsTcf5N5zk2TEHkzffa9wCfOnnq4oWLxofBwcH79+037eCew93S8kNusVKYdUiSRGqz93x8fB+G3/1bD8CSfq9duSKvlS179ki7xXz6LhkzZXR19X794t6wsFdPHj9esfTvePHj58iZSwMAAADwSRCAw+XLn8/08l2xft2GaG44LEE3Xrx4EdtNK8C2trbJkyeP2CeL2/sGYFGpckXTh1Ky7t71B5+74V8RdO/evZ49eu7Zvce0Q/ESxeLHjx/bplCwUCHtdX179/X19ZWBZ8+eDfz5lwCTK4SFp6eH9kFJQM2YyVV+ZPj0qZPafwH46tUr8pM+g0s8wwxH7BYTr1698tYDcMZM165eCX7+3Dhqz66dhfLk2rp5Y/tOXZImSxbNRJ49C9LvgPXixQsNAAAAwPshAP+rTr06pg9DQkKWLl0aTX+pRpq1SMEwjXMa05aIZ0FLbE4fxc2x3kq7Du3MCrA7tu+oWL5SnZp1K5StuHnTFrP+Xbt1jYVTKFK0sFnLxYuXKpar1Kh+o5LFS23csNFsrGfu3NoHdfr0KReXjK5Zwr+VSr8DcyJ7+9Sp01y9fFl+9DAcabeYuHD+XGhoaIaMGSUDa+H17RPGUbk8PCdN/zN7jhxzZ/356NGjaCYiG1W7jp3l58OWvgEAAAA1sVf9rxo1q5vFuUV/LQoLC4uqv5vJd/nq9G8ANhUx677/BcA6R0fHho0aRmyP9NLlWrVrRYzisWEKUiGvW6+uWaOUOs+ePRcSHGLWnidvnqLFimgfzs0b158+eZIuQ4bEiR3s7ROf+e8GV1mzu58/d+b6tasSUKPp9kbehiuHpYysB2DTs6DtEzsUL/lNzz4/P3zwYNvmTdFMRL8JlvxwqTAAAADw/gjA/0qYMGHZcmVMW3x87u1+/SReUxHvg5UurXkAzpAhvVlL5syu2gfyfasWMYnTzmmd23doF2un8FOvHjGZQtq0aceOG/Nhq6D6yczDhwxyd80QEOBvrNC6Zct24/r1ly9fZs2WPZpub+RtuGNWvRpVa1UNP1c84g20Xr4M/5Knx48DNAAAAACfBAH4/2rXrWPWsmTRkqg6Z82W1azF9A5YuvQZ0pu1ZMliXjd+Z5LYFyyc36RZEwsLi0g7SHv9BvWWLvs7abKksXYK1tbW4yeOK1GyhBYFCb0NGtafO3+OXQI77YPSa7kjx06YOe+v0uXK+/n63r8XfgGznnu18LPcc0bTzcyLFyETx47Wf65fuxb+xDNejimc5FnykzqNs+lXKF29cnnk0CHdOrbXwivb//96pL8X/6VP4cC+vVFNFgAAAMA7U+J7gCWnmT6MEydOfFvbiN08PT3yF8h/+NBhY8upk6ekEhjp2acuGV0kkpneKCviNwO5Rqj3Zo9w5fD7kPTY/YduxYsX27Rx0+3bd27euHH//oPkyZNLFE+dOlWZsmUKFioY+6fg6Og4ZtzoPbv3zJk99+GDh/4B/rJUU6ZK6ezsnDFTxpo1a0T1hVLv6fyZM46OKcpXqizDPnfvbtu8ydsrPLLquTeDS0b9DlhRdbMM92/sl6HQ0NDJE8bpD91z5nJOm/bcmTPlK1bOXzD8Rl/ye8XSJU+fPk2QIIGFpeXNG9dnzZjmmiVL758H5PLMrU9Bfi9bslifQvOWrQoVKRpxsuk+xAXkAAAAgLIsQoL8NOAr5Zkzt9fFq5oC3F0zHD91TAMAAAAQNU6BBgAAAAAogQAMAAAAAFACARgAAAAAoAQCMAAAAABACQRgAAAAAIASCMAAAAAAACUo8T3AUJm760f5GmEAAAAAXxy+BxgAAAAAoAROgQYAAAAAKIEADAAAAABQAgEYAAAAAKAEAjAAAAAAQAkEYAAAAACAEgjAAAAAAAAlEIABAAAAAEogAAMAAAAAlEAABgAAAAAowap/357aV23KxImXL11yz5HD2LJ39+4ZU6eWKl1a+xyGDhpkaWnpnDat9hEEBATIW1uycOG6tWvlXceLFy+Fk1M0/ZcuXnxg//7cefJon8OdO3e6d+q0ZuVK/efUiRNx48ZN4+wcVf8XL160/f77QkWK2NnZnTp5ctTw4WXLlzfr87ZL4BMwnW3tw1myaNHk8ePv3r37uVZfpCZPmBD49Gn6DBlk+NDBg7/277965cqKlStbWVkZ+9y/d2/hggXz5sw5uH//48ePM2bKJJ8IfdS+PXvmzZ69Ytmye3fvumTKJNuD2fT/+P33OTNnpk2b1illSpn+ssWLCxQqZGFhob2f58+fD/ntt/lz5oQEB2dzdzcbK/MpG1vq1KkdU6QwNj59+nTB3LmzZ8zYv2ePtbV1uvTpjaOOHTkyffLkpUuWXLt6Vd5dfFtb7W0MGzw4YaJEst0O+uUXWTJp06WLvn+k3YICA6dMmvTn1KkOSZK8cQoxdOf27eV//z1n1qztW7c+fPAgk6trnDhx9FHPnj2TDXLurFn/HDok69r4iiePH+/fu7fxMy4/OXLmdHBwkFFhYWGb1q+X1b1548Ynjx+7Zs5s3Axis+DgYFlB8k5lO5f3ErHD+NGj5Z+gFClSGP8pi2rhxGbRrOuLFy7M+fNP2fh37dwp3TJlymQT4XMKAEBsRgX4vZw9c+a3AQPe6il58+X7eJFs4tixL0NDa9Wt2/z7752cnCaOGydBUfs4WjVvLrFBe2+dunbt/tNP8lO5WjXZqTp39qz2HqJZAh9qhj/G1N6W/6NHWzZuHD1hwvetW2tv6R022hjau2ePZNGS33yjGULgvFmz6jdqJMOmAVUW2rAhQ169etWzb99qNWse3Ldv7erV+qjFf/21YulSz9y569avf+PGDTlU9OrlS9Ppy6qUpyd3dNQnWKBgQUl327Zs0d6PRJpRw4YlSpQop4dHxLESWmb/+Wfrdu3cX08740aNkkMb/X75Rd7jxnXrJLrr7V6nT0tEr1C58m9DhiRJmnTksGGhoaGRvq4cAPL39zdrlOB688aNbNmza+/n5MmTjwMCps2aVbR4cXm4cvlyWbzae5BVNmn8eFn+Pfv0admmjRxdMk5QoqwsQDm+M/D335t+951EJvnRRwUFBeXy8Jg+e7bxJ4OLiz5KjlJdOH++XadOvfr2leNWcshAi/VkjY8ZOVIOq+Xy9Iy0w6ULF3x8fFKlTq39t81Hs3BirWjWtRyqGDtypBycks1b/vGRg1kL5s3TAAD4ohCA34vvw4faWypdrpwUhbSPQPZXrl65Urdhw8JFi0qKqFO/frcePd5/TzpSDx480D6QzG5uWbNlkx+ZZ9csWY4fPaq9q2iWwAec4Q8+tXfwIopMFRPvsNHGhMS81StW1G3QQIYl2Eho7Ny9exY3N82QAcJJwT0AABAASURBVIzdThw7ZmVp2aptWzk8IbXrJt99t3fXLr3Dw4cPv2vZslLVqrL6JHDKvvW1a9dMX2LZkiU1atUKn9x/E6xZu/aGtWulwqa9BynZ2SdOLAdirCJUIIOfP/9r/vxmLVq4Zc1q2i6Hae7du9eydevkyZNLMK5Vr57UNvVRMj/yFvIXLJjYwaFBo0aWFhaHDhyI9HWlpxRIzRplyi4ZM0pJWXs/L022EFlc77/SpTwry6F1+/ZSe8+cJUv5ihWPHD6sjzpx/PiTJ0+q16yZIEEC57Rp68jSWLVKHyWrxjayEx+kfi5HLr5t2lSmJgu/4bffnj59WsqJWuw2ddIkSb9dfvghqhUkW4u8/fADNP9totEsnFgrmnV95swZuwQJ5GMox55kVJVq1eQTbfoBBwAg9nvf3awvnfzl3rxx4+GDB2UHMXuOHLKbop/leO3qVdlNuXDunOwBVK5a1SN3bs1w+L99q1ZtO3TYtGGD7OLI3syuHTs0QzFQ9nQl2RonK6UqKWaWLlt2y6ZNmqHqW6N2bf18zkG//FKiVCkpy+h9ipcsuX3LFplamfLlK1SqpD/99q1ba1etkl0NR0dH2ZOOeKJvpGT3XabzLCjI2GK61y67KbLHKe9Ldq/ltSKevBfVopCS1Py5c71Pn45va5sjV67adeuePnlymqFc06ltW8mZ7Tt31j4QKysrWcjah14CUsQzm+GlixdLEVUiyp7du6WOkTNXrqiWT8T2iFMznYeVy5YdP3ZMJi656JsyZYwHOx7cv79gzpwrly975snTqEkTfWOQxC6h8eSJE5IePTw9pSKqnyYtdTNpP3XihOxXSrvsbsaNF8/4EsYZkK2xYOHCMv+Rbq7i5s2bixYsuH71qr4YpSw5f84cs402qnmQDTVPvnxXLl2SkqZUe/r07DlmwoT48ePrU+7ZvbuUs7KbXFkgW0WyZMmSJk0qw+nSp+/644+yxG7dvGm2jqQ+lsLJyVgTTp0mTYBB4sSJO5gsySSG6ZgmW9ky48SJI29NKofGxoSJEqV3cZFqc5FixbR3JYtXZtXS5CRto62bN0tQL1SkiFn7+bNnM2XKZHyKm5ubr6+vn5+flJEvXbxYr2FDY0+3bNnkcEDE2Tuwf7+sL9nOJWzIvwbGBSJL23SpShVXKuFSE5bCacUqVfSjOVIYl7K5TEFq1yVLlYo426ZrWZKMfK7v3rmjv50Bv/0WzVUG0XPNnNk4HBISYjy1+/LFi+kzZDC+hUyurk+fPJFXTJkqlXwYIw3A8kFIkDBh0mTJ9IeyeadOnVoWSHjtNApSh5w5fbpsWme8vOSfVjnUJZu9bISySYwePlxeRRam5FLZaA/u3y+bYkc5ohHZOjWSf5wLFCokq0wznAUg/6pXrV49+tPpK1auLO80qske+ecf2UTlA75qxYr/z3bUCyeqV1m3Zo0sitCXL+/dvVu2QgX5d8Df318+UHK0pV3LlnJ4yNvLK7NhXVy4cKFQ4cLV5ahQ1ORzvX7NmirVq+tnmN+5c0c+1Pp5AdGIal3LGzR9+zIsyzz6hRbN23m3FQcAwHtSvQK8c/t2KTk2//77wcOHp02Xzni+otRzypQr98fIkbKjIEf99d1HnexEyi5Iw8aNGzdrJgUredb02bNN069O9lxlv+HnX39t17HjjevX10Z21D/8yjdX1+GjRzdq2nTV8uVXL1/WDPsr40aNyubuPmTYMHmJvbt3y0xqMRDHxkb2C8eOHCm7O1JHCgwMNI6SPQzZJ5Yd6GGjR0sfeUfSEsNFIVlLyjV9BwyQoHXO21vCUr4CBYaOGiWjxk+Z8gHTrywlyRWSGD/4Eoh0hr29vSVsf9+qlYSfqJZPpO3RvP3Tp079c/hwmw4dBg0bJnu68tA4Smp93zZr1qlbNxkwngM5d9YsSQKyhXTv0UOy4sxp04ztshB+6NWrZ58+Eg5nz5xp+ioyA7KOZGDS9On6KdCRbq6SbEcNG5YhQ4Y/RowoX6mSJGR56YgbbVTzIHbv3JkuQ4YOXbpIHJW8Z6wCXb92TSae9fWTC854exuvnpV4L0tVi4xEaAkAxofy7jRDodWs21lvb9mrTvvfpfKvXr1avnRpPUN52Ux2d/ezZ85o7yFT5syRpl95UclIEkeHDxnSuV27qRMnSlHaONvGYwFCz3gBjx4FPn0qz3ptlK2t/h5NyfGX5UuWSOqTvCdRdv3atcZRkm1Mj1vJUpVDTkNGjJAQNWHsWH2T3rply84dO75t0uTXwYOlHCfZ22z6spYl98pTZC3LJiHd5J8s2ULk4TunX1OyBmXJyMEX/aEk/4SGGKmTj6EsAT/DXMl2IpFp8V9/devUaWC/fkf/+Ufv80iekjCh6TQT2dvLdKJ/3UePHsk2UKtu3Q3r18sblML7ls2b9VEyNcn2csRE/lEd+Pvv9+/fv3jhgvamdzFy6FA5wCeftfGjR/vcvau9ifzrFFU2k/W+YulS+btg1h7NwomGrGj5PGZ2c5MPXfeffpJP04G9e/VRskHKKDn84Zk3b49evTasW/fy9SsFIjp//vyf06bJIc4HDx6MHjZMZlWLMbN1LccKJaxKpg3w95c/WBL1Y3J0Mpq38w4rDgCA96REBVgi69b/9pN0xqPvUidp1Lixfkuq8hUr7ti27cTx41KwlaCid5Bq7YF9+y5fvmx8iuxcStnqjS+aIEGCKtWqaYY/8DXr1JkycWLtevXM+kipLbPhHNHcefKEV4ouXMiQMaOklOSOjsVKlJD2dHZ2MldSmtCvqzTat2fPsiVL+g0cqBfKjOo3apQ2fXrZyZAdFNnL+bZpU/1Iv7zN4qVK6eWjnB4eefLm1XegTZ8b6aKQeovskY8aP17ehRSEf+rb1/Yt7+jzRlJH1QekQCG76fIjBb03LoGoRLUEIpISinFvVVJ9pMsnJsvNlOzX2tvbpzJsKmZ3WZNqcHKDYiVLXpI9vMqVnzx5Inlg2KhR9okTS4e2EkE7dZLdZQkMXqdOjZk4UT/Nsk79+lJulaKxWWB4bRlGtrnKQpCnyNOlXSpdWdzcEhtuPmQqqnlIkiSJPJTIJLOt95T6zNEjR/SVIpUuCeFmtyyS1G12nnCkcnl6yqYrRzRkVuXAypYNGzRDIde0jwQSKaRL3dXYLgdBZNHpHxYzkiHlLWsfwe3bt2XHXYpXsvdfvGRJ+dCNGTny9yFDJC2HvnhhYfL29UURHBKiHzMyHSXDL0JCTCcriWvbli0/9ekjC0HqbFJ1NJ5BKtU52WhN75AnyzmToRYn/3pIcVjWqSy3/Xv3Vq9ZU78mWY7LGC8//gTkYyWrRgYyZ8lS87/CoywNSwuL8Cuie/aUGZZNThZIiOFdBwUFydYuS08+NcePHZsxdapsmbLKwhegoWwox2sePnggx9es/ntKNBwcHGQbdkqZUgZki02ZMqX/o0f6KD2aSv1QSuX6gHFUVOSfZVm/o0eMkM9svHjxWrZp8z53U5N/K6SIrd/+zVQ0CycacohK3oW8QZkxGZC3/PC/yy4yZswo710m4uLiIgMyz/IpTmz4/EZK/hnp3LXriKFD58yceeH8eTnsJatDi4FI17VMTVL377/8oo+Sf12r1az5xklF93befsUBAPCelAjAufPmNY1P3qdP6zdGkp0SKegN/+MP084P79+X35s3bpS96ns+PvoZufny5zd2iOEdL01rShIn5Hi5HEpP8HqGMe0jgVnKRzJw9cqV8+fOtWre3Dgq4r1wZa7kkHmkV14VKlxYfmSfe/u2bVK9TJY8ucQS/XRB42WKwvS22FrUiyJ+vHgJDfSWaDLYO+vUtatURTTDebN6uo7JEohGpEsgYjfT9RjV8nnjcjMjJdDFCxf+8fvvkpllV9j0pkrGde3o6Hjx/Hl94lILsv9vz1WWrWwnUlSRpREcHNyuZUvTKcv+YjQLP9LNVcqVpqdZRky/0cyDHoBtDOtFl79gwb8XLZKtTvrLEYomJmtHF17rM+kfFScnJzkqISXQBXPnSuG0QMGCcjjJ9KiKbNUSk+wdHJp+953eIgUuKV+379gx0gnKthFkctL7B/T08WPNcMBLvxbAw9Pzhy5dpNosJTh9HZnOsz4n/y4Bkw+mjLJ5fbFImV1ShOzu6+c1mN4STw58yLZqGsNM642SIuS5MsG7d++mNQnJn/J8UTkWIHN++eJF2d7GjRnT9YcfNENVU58Nie76Wc1h/208pttJ3vz5B/3yixzLqNewoXFTkbevF8zDXt/eomF8vxICw14vZhoPyshATOqcclyp148/3rl9e/iYMe9zD+rg58/XrV7ds1+/iKOiWThvZPxHwyrC2zHOrUz5je80brx4rdq27derV3oXF+OFNm8U6bqWYzTjRo2Sg5JyNFCO98kBwQljxnTs2jUmE4zJ24nhigMA4H0oEYBlbz5rtmzGh74PH/57Z2DDfurPv/5q9qVEPj4+K5Yu7dCli9RnZKd25NCh2vt5afiLHsM7hUg3qZJ17NIlmj6S56OviMpel+yjXL92Taq4evyTnc7ozlWLYlHIwQLtI5OyXjyTC1y1mC2BN4q4BKIX1fJ5w3J7nVQpJ0yZcuzoUcmQs2fOLFKsWO26dc36/D/eRLY9hG8kYWESCMdOmqTFzHttrlHNQwRygEZqNcePHpUYJjE4S4RirOyIx3AL16+Bv3L5slTMxo8da1qPkilMnzLlwf37P/bqZcw5Ui91dnbOEMU51bK7/JESoGxCsrKMX30kKUKOFDw03E0qSdKkVy5dMvZ8ajh0ldzR0c7OTp5lGsjlqJbxSlfds6iPFMhxn/wFCmhR05dw2OdLCEkN5PiOZ548v/TvL2tK3rXUY/38/CS66EEo/PBcUJDZu9ZJ7feRob7nkCSJvtBq/FdafBwQkD3CF1B9VK9evpT6s8ynS8aMEuq6/fhj3Nf/IYq5TRs2eOTOLR//iKNivnA+nsePH48fM0Y+aLKBLZg3L5pzWExFuq63btokf0z1E0Pk4yCJun2rVpcvXfpId3YEAOBjUPoaYNkNlfLgFcOVtzop92mGEo3s4EqtTy88vvEKq0iFmBSI7ty6JbW1BDErn0pBTGKbMUv4+vrqe4pvJElAKoGmLbLLor8F2e+UWp+x/cb162ZZJapF4ejkFBgYaDyHU3akjJdBfjwfYwlEL6rl88blZkbGSmEwb758dRs06NC5s/E6t0ildnaWZWs83+/JkyeSDdKkTSvtkqAk1hqnKa8bzXSi2lwluZmeTCgTMS1aRj8Pkb6QvK/jx44d/ecfCWkRTxaVveHHES52jYpEVonrF86flyxnPJQjq2/apEk+d+/+0LOn6WW0Z729T5861ap5c/3nwYMHE8eNGzZ4sD42ICDAIbLi9vuT7VByywPDKSGaocoX4O+fzBByZHf/0qVLxkV94dw5aZdjBLJYpGhm+lVeUu03uxxaQoVMKuKGFBoaeunCBbO705lIvuhiAAAQAElEQVSuMim4SUlfXkJyiOl1v5/m67j02TNvNWwGGV1d5S0b35HX6dOyKJxSptQMt2EzveT7nuEWaDIgS0k2NuOdCIICA+UfnMxZsmif0LQpU+RgRPcff2zTvr2jo+PQwYPfufZ4xtt7144dxk1U3teMqVP79uypRbtwPg3ZPP747Tcp2DZu1qxn376yQb7xC7GiWddyQMfssy+fEdNVDABA7Kf6TbDq1q+/dvVqqXPKru2aVatGDx8u+6ZpnJ1lX/OO4U5CMsr0DlhmLKI+ay783ptr18pv2ctfuGBB+UqVYniBWUHDjUn/mj9f9uxlv2rqxInbY/ZNpxJNVy5fPmXiRDkeLzuXy/7+W2KkXlCqVrOmt5eX7KJJkty/d6+UO/SzcE1nKdJFITUNOd4/YexYmbhUNcePHq1/a6vle1ws90ZRLQHTuY10BqJZAtHPcFTLJ6r2qKa2af36caNHPzGcOnv+7Nno6zwShEqXKydzKwlWgsGUCROkYuzk5CTtUmCZO3OmtMtG+OfUqYtN7nscUVSba978+e/fvy8LQXZPjx05IitUv4uV6UYb1TxE+kJ58ueXjVkmkr9gwYhjM7m6XjAsnBiSoy2z//yzRatWxrMfZ06bdvfu3e4//WR2nXmtevX0b4rWfyRpS9mwwbff6mMvREiYH4qE8NJly86bM0c+CJJ1pXQmMUm/INwta1YJcrOmT5cgKvl82ZIlFStX1p9VsVKl9WvWHDt6VD5Hfy9a9CI01GxxhZ/ybWd3+NAh/eGJY8eW//23DFy8cEGOWZjdM1lWnKQp2fykyC8LR7+bdJVq1RYtWOB16pTM1Y5t22JyeOj9P7CyaY0cNmzPrl3yyZLP15KFC9NnyKDXPD08PeUYxOoVK6SmKgdT1q5aVblqVf1ZWzZsGDtqlPSXmVy1fPmtW7f08ykkBH5TuvTSJUv042tLFi3K5eERzS2gPwaZky7du+t1/u9atZKDVu98FnSvfv1Mv+tYVnHLNm0GGc7FiGbhfBrx4sVr8t13NWrX1gyL/afevY13tIpKNOta/lU5fPCgjJKDoXJMTT7CMn03kxOsAACI/VT/GqTcefP6PnwoAU+Squx9djWcBScBoOl3300xfOmLHKpv1KTJ9ClTwr8RMcJpn+nSp5e8IYf8pdxn/O4ZnezIyp5Bp7ZtEyZKJBmsXIUKMZuj8AulOnTpMnHs2B+7dJEdMtlL02+m9UYyh/0GDNiycePM6dOlhCjBtcsPP+j365Kc07ZDB3kX8+fMkXQh4UF/L1LIkmKaFO669egR6aKQPq3atVswd+6gX36Racrej376XCJ7eyl5ybsrU65c/UaNtA8qqiVgbW0tC7xPjx6yu+mcLp1Ujdq1bDl5xoyYLIHoZziq5RNVe1RTK1ex4quwMNl3lNDinDbtt02bRv9O6zVoMHvGjF/699cMtztq0qzZv+0NG8pb0Ntlu2rbvn00E4lqcw2/W+xPPy2cN++nLVtk57tK9ep6fDLbaKOah4gSJkyYNm3ae/fuRRo4pcQke/lSbtJPaG/TooWxnta+VSvNcEmhfs9qcejAgaWLF8umZTzBWDMUxyQOdTO51lf/linn129cbBMnjqzTtOnSaYZyt0xK3qb2HtasXLna5DLvTYb7cg0ePlz2+GvXqye7+B3btrW3t8+RK5d8TIxHYTp36yb59tf+/eVgjRzeMp7I7Z4zZ7MWLdauXCmV6qzZs0s12+w7Y2UKss3IcQ2buHEvXbz4yM+vkeEz5f36FyDppCAsPW/fuZM5c+YOnTrpy7ZQkSJ+fn5/zZvn6+cnH41kMTifNlPmzPJGtm7ePH7KlHjvdKJvLk/Pho0b79uzR68f5suf3/jtO/KO5J+LEUOGyNEx+cDKIRXjXfElWMrryo8U9mWttevY0e6/hC8buRT8u3boIMNZ3Nwki2qflulZu/IWssYgxclGq28eOv127n1+/lkK2lE9JZqF88mYvjX5w5Qusi+mMhXNupZ/IuRYxuaNG+fOmmVlZSVbe/hfire5RwMAAJ+dRUiQn4YPTf+O36EjR2rAV0QOBEh80u8sHdGMqVMlGxtvHP0JHNi///CBA10Mt+f5ssjBpskTJkh4Llm6dM5cuaRlYL9+TZo351pKAACAj0r1U6ABxJwc2Yn0/Gdd3fr1t27apJ8B/gk8e/Zs7apVEb959YuQNFmylKlSSalNT79S0ZVS8Ec6lxsAAABGBGAAb3b1ypVWzZunTJlSP/c4UvaJE3/fps35t7kS+H1cOH9eSqamJ1F/Wb5v3bpEqVL68PPnz+s2aGDxMS+tBwAAgMYp0AAAAAAARVABBgAAAAAogQAMAAAAAFACARgAAAAAoAQCMAAAAABACQRgAAAAAIASCMAAAAAAACUQgAEAAAAASiAAAwAAAACUQAAGAAAAACiBAAwAAAAAUAIBGAAAAACgBAIwAAAAAEAJBGAAAAAAgBIIwAAAAAAAJRCAAQAAAABKIAADAAAAAJRAAAYAAAAAKIEADAAAAABQAgEYAAAAAKAEAjAAAAAAQAkEYAAAAACAEgjAAAAAAAAlEIABAAAAAEogAAMAAAAAlEAABgAAAAAogQAMAAAAAFACARgAAAAAoAQC8AezY9u2OX/+qQ/MmjFDb+zeubOfn5/pWJgxLiIAAAAA+KisNVWduGt14JaNb5BlkvhhBdME50718o1PGdivX3Bw8KChQy0t/z1wsGnDhqWLF/f5+ecMLi5Zs2dPmSpVVM+NfmxMbN64Mfj586o1amgf3527927euhsUFBTfNn7aNClTpXR641PatGjx6tUrGShWokTT777TAAAAACCWUTEAn/Sx6rUlwa0Ay28yaU4JtQuPtMmH46ZJ9OqPck9zOb0hBocEB+/esaNk6dIyLHF0y6ZNtra2+igng6ieGP3YmJAyqd1/r/Xx3PW5v2nLzoDHTzJlypQgQQJfv8eHDh+zT5SwfNkSKZ1SRPPEqTNnjhw6tGjx4gUKFdIAAAAAIPZRLgDvuBqn6rwE42torQu81j79kGXhaYnWNnlaKsOLqJ5rYWFRuVq11atWFStZ0srKavOmTR6enmfPnPl3ytu2Xbt69buWLSN/3f/G3rlzZ8Lo0RkyZvS5e/fly5fft2njffq016lTUj6VsckdHaXzqZMnN2/YcPvWLZl+7fr1JYj+OW3awf37ZdS2LVvGTJwoU7t86VKcOHH+OXx4wpQpMqmVy5fLnLhkzFizdu206dKFhYWtX7Pm8MGDgYGB+QsVqlKtmm0MwvOVq9fnzF9SvXr1AgVeWzqHDx+eMn1us8b1XTKk1WJG5tDbyys0NNTP19cpZcrmLVrY2tlJ+/GjR5cvXfr48WN5a/UaNrQzNB49fFjq25ZWVnUbNMibL5+0PH/+fMXSpUePHHFwcChXoUI+w/zcunlzxbJlF8+fl3r7N2XK5PL01AAAAAAgxtS6BjgwxOK75XZLm4Sn30UntDLTtPRDwn/LcKsCmrS3WG4nfaJ6uqTKNM7OWdzctmzc+OTx413bt7/bCcmPnzypULly/19+KVKs2KihQ7Nlz/5jr1558+dftGCBjPXx8flr7twatWoNGjo0SbJkc2fOlMbvW7cuU65ctRo1JP3qE7lw/nyefPnGTZwoKXrcqFGSBocMH16sePGpkyZJ7JSsuG/Pno5du/YZMMAmThzp88a5Cgl5sXTF2saNG5ulX5E/f35pl7HSR4uxhw8etGzT5pdBg+wTJ16/dq203Lxx46/58xt8++2QYcMcHR337Nyp94xvazt05MjqNWvOnjEjKDBQWhbMnWthaTng118bNW68euVKeaI0SsjP5Or6x8iRpcuV8/f31wAAAADgbagVgEcfsK3pblE1mzZkh9bwL23bJe36o/DfMiwt1bJpNdwtpE/0E5Eq5aaNG+fPmVOqdGl7e3vt7SVKmNDZ2VkGsru728SNKwVbGc7m7n779m0Z2LtrV8HChTNlziwlU6ncnvH2fvbsWcSJZM2WzT1HDqmaSgd7B4dChQtLjTd33rzJkiWT0qulpWWYptklSJAkSZIatWsnTJjwjXO178A/7u45smXLFulYac+ePbv00WIsXfr0UruWsrk888b169Jy6MCBAgULyruWtya1dDkK8O/E3d3ljRQuWjRZ8uR3bt+W8q8UimvXrZswUSIplctbO2CofltZWtrY2MjbzJkrV4lSpTQAAAAAeBtqnQK98kycGXW1O4+1PhvMR0lLszxa0zxa66Vx+pWIbiISKYuXLCn11Vbt2mnvx8rKynT4ZWioDPg/enTo4MF1a9YYRz169Ch+/PhRTUT6X7pwoVXz5sYWj9y5c3l41KpTZ/Cvv/o+fOiZJ893LVvGiRNHi5b32Qt16tSJpkOePHmWLVtaqkRh7S3JWws1vLWAgIDUqVNH01Nm8kVo6OOAgODg4PatWv3/pQ3nRX/brNmyJUvafv+9Q5Ik3zZtKvlfAwAAAIAYUysAn7lv4ZlaW3oq8rG7r2i1c4T30d6kStWqGTNmtLb+KEtP0l3N2rUrVa0a0/4ODlJi7dajh1l7vgIF5Ofx48d/zZu3Z9eub8qUiX469+/fjz6dpkqV6v79B9p7kIL506dPY9Itbty4E6ZONWtPlCiRJHn5OXvmzPTJk0eNH68BAAAAQIypdQq0hYUWFvZeHXRxbGxyenhoH0eR4sX37d374EF41Dx18qTxK4UtLCJP5lmzZ/fz9fX28tIM1w+PGTFCyq3hEXHKlKdPntjZ2clD4/c2RUOmHxbtm39jhzfKX7DgwQMH/P39ZTpSQpdkHmm3uPHiSdV69YoVMhwYGDh5/PhbN2/K8PjRo0+dOCEDUg+PyTsCAAAAAFNqVYCzOYYdv2NR3CXysdJ+/HZ4H+39OKVMuXD+/Dhx4jRu1kxqqj27d3+rWqWTk1P9Ro1mTp9+59at7Dly1GvQQG/P4OIybfLkfw4f/nXwYNP+VlZWHbp0Wb506dSJE9NnyFClenUpTbu4uOzYurV7587SwcPTs0ixYm98XUfH5Hfu3NEvTo7U7du3HQ03qY6U/j3A586ePX/uXFTfA5w2XbpvmzQZOXTo44CAHLlyRVPl/rZp06WLF3fv1Clx4sTFS5VKY5ir4iVLzp4588njx4kdHJqYnPINAAAAADFhERLkpynj9112vs9tJtQIv+WV2WXAgytqvUtpHVdqSeOF9CsRqKlnx679Qc9f1Ij6vtarVq2KH9f6Ha4BBgAAAIDYQK3zSLsVClrpFbb6THjWXdhIK51JS+cQ/luGpWXNGW2FV5j00ZRUpFA+b2/vM/99rbEZaffyOi19NAAAAAD4MqlVARY7rsapMi/BxBrhX/xratohrdNKbU2Tp6UyvMVX3X5lrly9MWf+YikC58+f37T90KFDUv5t1rieS4Z0GgAAAAB8mZQLwOKkj1WvzQluPbYs7aqlSKD5PNG2X9LS2L/6o+zTFk4YywAAEABJREFUXE4vNbXd9bm3acuugMdPMmXKlCBBgqdPn166dMk+UcLyZUumdHLUAAAAAOCLpWIA1h27Y3XwVly/ZxZJbV8VShPikVL16Gvqzl2fG7fuPgt6Zmtr65wmZaqUKTQAAAAA+MKpG4ABAAAAAErhy1QBAAAAAEogAAMAAAAAlEAABgAAAAAogQAMAAAAAFACARgAAAAAoAQCMAAAAABACQRgAAAAAIASCMAAAAAAACUQgAEAAAAASiAAAwAAAACUQAAGAAAAACiBAAwAAAAAUAIBGAAAAACgBAIwAAAAAEAJBGAAAAAAgBIIwAAAAAAAJRCAAQAAAABKIAADAAAAAJRAAAYAAAAAKIEADAAAAABQAgEYAAAAAKAEAjAAAAAAQAkEYAAAAACAEgjAAAAAAAAlEIABAAAAAEogAAMAAAAAlEAABgAAAAAogQAMAAAAAFACARgAAAAAoAQCMAAAAABACQRgAAAAAIASCMAAAAAAACUQgAEAAAAASiAAAwAAAACUQAAGAAAAACiBAAwAAAAAUAIBGAAAAACgBAIwAAAAAEAJBGAAAAAAgBIIwAAAAAAAJRCAAQAAAABKsNaAr9eDbUsvjf1RBuxcsgVeOSMDzg27pmnYVQNivfODW/sd3Hw8fvoEBSrES5VeAwB8JvUaNNAAfC0IwAAQ25WtUEEDAHwOWzZu1AB8RTgFGgAAAACgBAIwAAAAAEAJBGAAAAAAgBIIwAAAAAAAJRCAAQAAAABKIAADAAAAAJRAAAYAAAAAKIEADAAAAABQAgEYAAAAAKAEAjAAAAAAQAnW2ldt3d7rGhQW96Kv3estF274n2SrwJcggW+QjQYAAIAP6SsPwPtO3NWgMOc7/h6vt9z0eXqerQJfgnwBz500AAAAfEhfeQBOljh+vbIZNagqcP8lP6/XWvJldyxd1V0DYr2H9xM9u68BAADgA+IaYAAAAACAEgjAAAAAAAAlEIABAAAAAEogAAMAAAAAlEAABgAAAAAogQAMAAAAAFACARgAAAAAoAQCMAAAAABACQRgAAAAAIASCMAAAAAAACUQgAEAAAAASiAAAwAAAACUQAAGAAAAACiBAAwAAAAAUAIBGAAAAACgBAIwAAAAAEAJBGAAAAAAgBIIwAAAAAAAJRCAAQAAAABKIAADAAAAAJRAAAYAAAAAKIEADAAAAABQAgEYAAAAAKAEAjAAAAAAQAkEYAAAAACAEgjAAAAAAAAlEIABAAAAAEogAAMAAAAAlEAABgAAAAAogQAMAAAAAFACARgAAAAAoARr7etmoQEAAAAAoFEBBgAAAAAoggAMAAAAAFACARgAAAAAoAQCMAAAAABACQRgAAAAAIASCMAAAAAAACUQgAEAAAAASiAAAwAAAACUQAAGAAAAACiBAAwAAAAAUAIBGAAAAACgBAIwAAAAAEAJBGAAAAAAgBIIwAAAAAAAJRCAAQAAAABKIAADAAAAAJRAAAYAAAAAKIEADAAAAABQAgEYAAAAAKAEAjAAAAAAQAkEYAAAAACAEgjAAAAAAAAlEIABAAAAAEogAAMAAAAAlEAABgAAAAAogQAMAAAAAFACARgAAAAAoAQCMAAAAABACQRgAAAAAIASCMAAAAAAACUQgAEAAAAASrDWvmoPHz2b9LeXBlU537nt8XrLP973zz9nk8AXIN+dx04aAAAAPqSvPAAX8UipQWFxrRNrr6ddZ6cEydgq8CVIcDWedl8DAADAB/SVB+DKRdNpUNiD4KSXXm/JnDZxGrYKfAnO77b1u6gBAADgA+IaYAAAAACAEgjAAAAAAAAlEIABAAAAAEogAAMAAAAAlEAABgAAAAAogQAMAAAAAFACARgAAAAAoAQCMAAAAABACQRgAAAAAIASCMAAAAAAACVYawCA2G3Lxo0aAAAA3ptFSJCfBgCIlVavXKkBXzILDfjiVa1RQwPwtSAAAwAAAACUwDXAAAAAAAAlEIABAAAAAEogAAMAAAAAlEAABgAAAAAogQAMAAAAAFACARgAAAAAoAQCMAAAAABACQRgAAAAAIASCMAAAAAAACUQgAEAAAAASiAAAwAAAACUQAAGAAAAACiBAAwAAAAAUAIBGAAAAACgBAIwAAAAAEAJBGAAAAAAgBIIwAAAAAAAJVj179tTAwB8mbxOn54xdeqBfftsbGxSp0kTaUtM/PH770WLF4+mw5XLl6XPubNnCxQsaGxct3r15g0bcufNa2kZfjj1z2nTli1ZcvL48Thx4qRKnTrSPgAAAJ+RtQYA+GLduX27eMmSptk1YktMvHz5MpqxN65f/3vx4uYtW27dvNnYeOTw4fPnznXq1s3aOvxPybNnz1wyZvy+detXL1/26NYtd548llZWZn0AAAA+L/ZIAODLsGvHDsmTMpC/YMFiJUpcu3p1ycKF/o8eWVha7t+7t1Tp0skdHc1a8hUo4HXq1K6dOyWUJrK3b9aixZMnT2ZMmdKtRw+ZzqBffundr9+mjRtPnzx5986dYYMHS2O9hg3TZ8hg9tJSzu3avbuvn5+xRQLz8r//7jtwoBR79Zb48ePLK8rAo0ePbO3sJP1G7BPRxnXrpP/9e/ey58hx9cqVSlWqyMyYtcS8jg0AABA9AjAAfAFu37rlffr0Dz3DL1qZOG6ca5YsElN/6tNn88aNtra2xnqvWcuLFy9Wr1rVp39/zXAOc6RTrli5svz8NmCAPDeqV7c2MG25eOFCipQpt23ZcvPGjYyZMlWoVOnfl1u5cs/One07dYqqT0TZ3d0l4lpYWOQvUMDbyytiCwEYAAB8KFyRBQBfgLt370qY1IednJzu3LoVk2f5+fra2drqwy4ZM2ofzpPHj0NCQspXrNiyTZtTJ06c9faWRqn01q5bd+CgQbNnzgwMDIy0TyQspGJtKXFX/vdKPxM7YgsAAMCHQAAGgC9AqlSp7vv46MMSho23mIpekqRJA4OC9OFzZ8+GhYXFixvX778zmZ8/e6a9K5mBJEmSxDVI7OAgkdX/0aPbhlhub28v0TXw6dOIfTQAAIDPilOgAeALIGEym7v7qOHDZThf/vxOKVM+uH9/1owZxit+mzRvbm1tbdaSMlWqatWrTxg7NigwMJG9vWvmzHFsbAoWLjxy6FAbGxsrk7OakyVPHs01wL6+vn9OnSrl3IcPHki3/AULlvzmm0yurqOHD49vayvhNmu2bL4PH06bPNnWzi6xvX2RokUdU6SQJ5r10QAAAD4ri5AgPw0AAAAAgK8dp0ADAAAAAJRAAAYAAAAAKOErvwZ4xsqzGgAgOmEaACBqLWtwCwPg6/GVV4CPnXug4Qtx92Hg+r3XNXw5/lx5RsOXY+uhm9fvPolsjAU/sfDH+/Kjg6fvffbZ4CeGP74BwSt3XP3ss8FPzH/mrbsQ8uJVjPsD+Hp85RXg3G7JW9bIquFLIEcrfB4Gsb6+IBKAWV9fkIs3/MsWSFM8dyoNX4LFmy/JYUE+Yl8K+Xx5X/ZjfX1BFm++2LRylgS2cTQAiuEaYAAAAACAEgjAAAAAAAAlEIABAAAAAEogAAMAAAAAlGAREuSnAQAAAADwtaMCDAAAAABQAgEYAAAAAKAEAjAAAAAAQAnWmhq2bd587tw5GciaLds3Zcpo+BwWzJt37cqVOHHCv3S+XsOG6TNkuHDu3NYtW16+fGlvb9+keXMLC4uILRo+k7CwsBlTp548ceKn3r3TpksnLQH+/gsXLAgJDo4bN26Dxo1lHcWkRcOnsnPbtmV//121Ro1yFSrIw6dPn/7cp4+Tk5MMp06T5tumTWWdzps9OyAgwMrKqmz58q6ZM0ds0fCprF29+vzZszJQsHDhIsWKaZH9qYpJCz6NY0eO7N61Kzg42MXFpXa9epaWlvxRi82uXL48deJEhyRJUqVOXatOnQQJE/InDIBOiQDs6+t7/vz5Dp07y/CEMWM8cudOkiSJhk/uWWBgxy5d7BMnNrasWL68+48/xrGx2bh+/eGDBwsUKhSxRcNn8ue0aa6urrLfZmxZuXx5pSpVJAxfu3p11fLlTb/7LiYtGj6JXTt2yA5f9Vq1Xr16pbcEBQZ6eHqaroJDBw6kTJlSWmQnfvTw4b369YvYouGT8PHxeRES8kPPnq9evuzdo0ehwoUf+fub/amSwxNvbOHP2achS/6fQ4e6dO8uCXbS+PGXL12So0X8UYvN7vn49O7fP7GDw5aNG+UYRI1atfgTBkCnxCnQcohdjsvqwxlcXC4Yjp3j03v27JmtnZ3xoZ+fX1wbG9ktkOFMrq7nzp6N2KLh82nYuHHJ0qVNWy5dvKiXgtOlT3/54sUYtuDTyJMvX4vWraWQa2wJ/8TZ2pr2OXvmTEZXVxmQ4oZN3Lj+/v4RWzR8ElKZr1mnjgxYWlnJP3ovQkMj/qmKSYuGT0Jyb5sOHfT6rZ2tbUhIiMYftditUJEikn7lyMWDBw+SJk2q8ScMwH+UCMDPgoKsra3lqJ4czJO/Q0FBQRo+h9DQ0NUrV86YMmX+nDkyLOUpK2tr79OnRw4daiPrJTAwYouGz8fOZMdO9zI0NDAwsNcPP8huX6ihMhyTFnwaCRIkMGuRVeD78OG82bNHDRum73nr/xiO+OMPby+vOHHiBD59GrFFw6d1YP/+rNmzywGIiH+qYtKi4dO6c+fO3bt3s2XPrvFHLdY7dfLk6OHDfX19ixYvrvEnDMB/lDgFOr6trZQ19IvidmzdmjBhQg2fg5Q7kiVPLrFK9hU2rV9fqGhR+Usje34pU6f28/WV1SSH0s1aNMQmsicnq69H797x48fXK40xacHnksbZuXylSlIwvOfjM3TQoGGjR8tnSnbTpVCcOHHiTRs2yGcuYouGT2j9mjVXLl/u0KWLFtmfKilevbFFwyd01tt70YIFP/Xtq5eC+aMWy+XMlStHzpyrVqxYsXRprbp1+RMGQKdEBThL1qzXrl61Nbh65Yo81PA5PHnyxDZ+fNlvcEyRQh4mSZIkOCREdg5k4NLFi1mzZYvYoiE2yeTqeuP69aTJkl2/di2T4bzZmLTgcwl98cLSMvwfeVkdNoaTMOUzdfniRfl8vXjxIiQ42CFJkogtGj4V2Sl/GhjYvnNnPU1F/FMVkxYNn8qpEyc2b9zYo08f49kx/FGLzbxOndIM5647OTlJEVjjTxiA/1iEBPlpCti2efPRI0fk38E8+fJx28zPZd2aNft2706VJo2siNZt28axsblw7pwcmpVRyR0dm7Vood8w06xFw2eyesWKc2fP3r17V3bd4saN2/2nnwKfPp01Y0ZISIg8bN6ypX7DzDe2aPgkjh89umXTpoCAgLBXrxI7ONSpX18W/piRIxMlSpQgQYJcnp6FixaV+uGcmTMf3L8ve4U1atXS7wJt1qLhk/D28po6caJU6fWHFSpXlmpVxD9VMWnBJ/AiJKRTu3YZMmbU/yZlz5GjctWq/FGLzdavWbNH1k7q1J3HSroAABAASURBVLLM6zVoIAcpYvIHiz9hgApUCcAAAAAAAMUpcQo0AAAAAAAEYAAAAACAEgjAAAAAAAAlEIABAAAAAEogAAMAAAAAlEAABgAAAAAogQAMAAAAAFACARgAAAAAoAQCMAAAAABACQRgAAAAAIASCMAAAAAAACUQgAEAAAAASiAAAwAAAACUQAAGAAAAACiBAAwAAAAAUAIBGAAAAACgBGvtq+aZM7cGAAAAAIiZ46eOaV8vi5AgPw0AAAAAgK8dp0ADAAAAAJRAAAYAAAAAKIEADAAAAABQAgEYAAAAAKAEAjAAAAAAQAkEYAAAAACAEgjAAAAAAAAlEIABAAAAAEogAAMAAAAAlEAABgAAAAAogQAMAAAAAFACARgAAAAAoAQCMAAAAABACQRgAAAAAIASCMAAAAAAACUQgAEAAAAASiAAAwAAAACUYK191Txz5taAj+b4qWORtrPhIVaJakMFAABQzVcegIXXxasa8BG4u2aIZiwbHmKJ6DdUAAAApXAKNAAAAABACQRgAAAAAIASCMAAAAAAACUQgAEAAAAASiAAAwAAAACUQAAGAAAAACiBAAwAAAAAUAIBGAAAAACgBAIwAAAAAEAJBGAAAAAAgBIIwAAAAAAAJRCAAQAAAABKIAADAAAAAJRAAAYAAAAAKIEADAAAAABQAgE4SrmzZ3nk5xfDzrNmTHN3zSA/+XJmj7TDbwP6e2R1lQ59fvpBA6LGhgcAAAB8JARg7cjhQx3btCyWP3fhvB7f1q114thR7e1917K118WrO/YfinTsPR+fTevXnTh7UfoMHjbyjVPr0r5Njswujx490t7Dixcvfuza6df+fYODg42Nhw8eaFi7Rt6c2SqWLjl+9P/nZMHc2VXLl8mTI2udapU3b9ygfW5zZ/055LdfYtg5ts18DMWqDa9KudJ6kC7g4d6/109BQUHaO/lr3txWzRoX9MxRu2qlIb8NDAjw19ujWkdf9IYnjvxzuFqFskeP/GPaePzokXIli8rCfPDgvrFR1kXr75oWypOrZOH83Tu1f/7smQYAAIBPjgCs/dClY6EiRddu2b5y3cb6jRpPnjBO+9BCQ1/EvLME10MHD+TNX2D7ls3au3r58qXkkOzuOX7+bVDcuHH1xlevXg3o27t8pcpbd+8b+PvgFUv/PnniuLTfuH590rix3X/qtWPvwYaNm/42oN9n3zsPCQmJYc9YOPMxFNs2vJnz/pKcvHHHnsDAp5PGj9He3sXz50cPH9qqXQcJ5MPHjLty6dKMKZO1qNfRF73hid07tw8a2H/G3Pl58uYzNu7dveuHzh1Hjw9/4xby33/GjR7h4JBkxdqNf85d4OfrO2/2TA0AAACfnLWmNqlQ+T58WK1GrYSJEmn2WrWateTHOHbfnt2/9O8ro9p26Fiv4bd64/Vr1wb98rPU65xSpmrcrLmxPVLDhwyaM3OGPiwVIfkt04++Frd75478BQpWrFx13ZpVtevV197JrBnT3LJll/KgaeOuHdsTJEjQ/PtWMlygUOGGTZr+NXdOLg/PxX/Nl7kqVbqMtMsrbt64fu3qVXXqN4h0ylIb/KZIgUpVq+/dvbNu/YZep0/dvnVr0oyZ3qdPS4RzdnY+d/ZMzTr1dm7fljy54+gJk6KZSenT96cfnz0L8syTt037jvkLFpLGls0aH9y/T+8g5UH5Xblq9aGjosxjn2vm31Ms3PB0Dg4ORYqV2Lhujfb2nFKmTJU6dSJ7+/jxbWUBSkuOXB5a1Ovoi97wAgMDhw76bdrseY6OKUzbJdlO/nNWJtfMMhwm/xn4+z/auG7tjn2HZOHIw249enbr2F6OFEQ1cVl9V69clrccJ04ct6zZ5C1Xr1mnectWUbVrAAAAiBnVK8CJEtnLrur0KZNkDzXiWGk8dOJ0n58HjPhjsFS3NENltXO71jVq1zl80nvGnHmz/5x+5PChaKbfo3dfqapt2rE7cWIHGYjJKdDbt26WIu03Zcoe+edw8PPn2tuTMtrfixa658xZt3qVUoULjBg6ODQ0VNqvXL6U0dU1LCxMxvrcvZvFLevlSxf1dlkI8mYlkAQHB0v7pYsXopl+6MuXfX4e2KFzt8OHDo6dNNU1S5Zj/4SfAmpvbz9y3MTcefK9evly/uKlXqdPSqUrqolIqe2veXOmzpyz95/j5StW+qV/H719xpz5spQ6du3+bdPm+hKLJoR8rpl/f7Fww9PJ29+/d7enSUkz5iSxDxkxqlnDehK5C+XJJUG9XIWKWtTr6Ive8ObPmVWhUpVJ48YUzushb/nk8WN6u0xZ3ohZZ6l1OyRJIulXDkKdPHFcDk7dv3/vyePH0UzfwzP37AWLbt64If8UjJ8yfcWyv6NvBwAAQEyoHoAtLCwmTJ1+9+6dVs2aeGR1/aFLx9u3bxnHVqpSzdLSsky5CoWLFj996oS0/HPooKWVpbTLsGMKp/qNGq9euUL7cCSdHti3T14xbrx4RYuX2L1rh/b2JDk/f/4sKDBw2qy5f4wcvWXjRtnj1wzBWN6O7HYPHfyb1BiliCRFMGl/Ft5ucdbbe9CvA+/euW1lba23RyVe3HjW1tayN58gQULNkOUePw6QgX8f2tvb/dduvAQ0IhsbG5k9Sem2trZVqteU8qakF+3tfZaZf3+xbcMTLZo0kuCa0y3TxQsX6jVopL09ibKS0nv27b/n0NFZ8xdeuHBu04b1WtTr6Ive8Hbv3CHFWFkRqzZszunh2bl9G9OL7c3oHz0ZkEMeC+fPlXdhePvRvVm7/96UvDvTdxRVOwAAAGJC9VOgRRrntMNHh19++cjPb+b0qd9922Dzzr36KEkp+kDcuHFfvAi/nPL+vXtSkdPPKdUVLlpM+3CkrHf/nk8edzf9oWTUsuUram9JqrtOKVPqp8iGn+rcuMmeXTubfve9hGoJ2LLrfOTUGc1wsWK8ePFlIJ6hvVCRoqfOXZKHYa9e6e0xJ09/q3Yt/PLU0AljRu3ft/f82TMvDQkkyq7R+iwz/0HEqg1PM1wDnL9gIYlqUlSsXa3S9r0Hrays3moKa1et9Midp1bd8PP28xUo2KZ9pz+nTpYqa1Tr6Ive8Hzk4EXb9jkN53h369Fz6ZJFZ7xOe+bJG2ln/aMnA1Kg1gzX+Wvhb/8t3uzn2koBAAC+MtwESzOWUBySJGnTodOd27ejOTXRMUWK3Hnz6mdI6j9STdI+nG1bNv/Yq48+5Z37D+/YuuUdylNJkyWLtD1tuvT3fHyMD2/fupk+QwZDezofk/Zb/7V/VFJA27B2zYBfBx31Oic/2rv6LDP/QcSqDc8oXvz4VWvU8n340M/vrc8Afx7hjP0gQ5EzqnX0RW94SZMlj3ln+ej5+foa77B188Z1BwcH/XpgAAAAfEqqB+Dz586WLV5k88YNYQarVyzPmi17+H2JopA3fwH/R/4b163VDCd89ujW2ewbUN6TJN6ChYvow8mSJ3dKmerIP4eNY8eNHtmtY/s31nykNihFxe1bt8jwwwcPFi2YX65CJRkuXqKkpKx5s2fKFLxPn54xdXLteuE3HKpZp96iBfMOHzwgw7IEjh4+rPf/qKT6Z+/gkD1HDmtr63NnvM3Gxrz2+Flm/v3Ftg3P1JZNG2TbS5r0/4dRYrjhFSlWfNf27SuWLpHN759DB6dNnlCseEkt6nX0RW94tevWmzl9iv59UXNmzrCzs9Pv+BUpibslS5cZ0LfXs2dB8pH8feDPdaO9hxkAAAA+EtUDcBa3rH0H/LpuzariBfOWLlbY2+vUxGkzoukvO83jJk+TvXZ31wytmjXJlt1d/waUWTOmSUupwgVkB1f/PtWtmzdqhvvfynD5UsUltOjtm9avi2ri586eefL0iVvWbMaWAoUKbTP5MqTNG9ZLJdB4fmxU4saNO37K9KmTxsvL1axSoVaduvqddaW4N+XPWUsW/pUjs0vzbxu0btdRP41WotfPv/7etWM76T9+zMhxU6ZFVUP+gOSlpQBYo1L5Vs0aS5aTxVjQM6dxbMlSpY8fO6ovsZ7du0Yznc8y8+8vVm14Ov0aYPlZMGf2pOkz9WtWdTHc8GRdDBw0ePafM4oVyNOpbavcefK179RFi3odfdEbXv1GjeUNliyUT3oeOrB/8ozZ+pW98ixpyeWWSYZlvcjwxLGjZfj3P4Y9DgjIlzP7N0ULygx07NJNAwAAwCdnERLkp329PHPm9rp4VfsqPH/2LL9njmWr1rlmyaIhFpBsc/zUsUhHseEh9ohmQwUAAFANN8H6Ypw/dzZ3nryEEHxibHgAAAD4ahCAvxi5DN//qQGfFhseAAAAvhrcBRoAAAAAoAQCMAAAAABACQRgAAAAAIASCMAAAAAAACUQgAEAAAAASiAAAwAAAACUQAAGAAAAACiBAAwAAAAAUAIBGAAAAACgBAIwAAAAAEAJBGAAAAAAgBIIwAAAAAAAJRCAAQAAAABKsNa+du6uGTTgk2PDAwAAAGIbi5AgPw0AAAAAgK8dp0ADAAAAAJRAAAYAAAAAKIEADAAAAABQAgEYAAAAAKAEAjAAAAAAQAkEYAAAAACAEgjAAAAAAAAlWGtfNc+cubUv3PFTxyJtnzdnnvYla9KsiQYAAAAAn9BXHoC1qAPkFyH6AP/lZsgvPb0DAAAA+BJxCjQAAAAAQAkEYAAAAACAEgjAAAAAAAAlEIABAAAAAEogAAMAAAAAlEAABgAAAAAogQAMAAAAAFACARgAAAAAoAQCMAAAAABACQRgAAAAAIASCMAAAAAAACUQgAEAAAAASiAAAwAAAACUQAAGAAAAACiBAAwAAAAAUIK1BhOdO3bJmNGlS7cuxpZRI0bdvHlr9NhRMZ9In159U6RwNJ1IbHDp4qUD+w8YH9olsMuUKVPOXDljPoWLFy/KRCpWqqgBAAAAwBeIAKyQBAkT1qxVQwbCwsJu37q9a9euNM5pkiRJogEAAACAAjgFWkUWFhZ69L1546YGAAAAAGqgAvwWWrZolTtP7mNHj3md9sriluXHHj/kyJlD2l+9ejVr5qwN6zbeu3evfIVypk95/vz5tCnTdu7c9TjgceEihdu0a506dWotdrC0sAz7b/j8+fNXLl99HBDglNIpe/bsyZIn09uvX7t+7uw5Xz+/5I7JU6VMaXxuaGjoqZOnbt26FRwckipVqlweORMkSKABAAAAQCxGBfjtnPE+M37iuA2b12fOkrl3zz4SfaVx2dJlc2fPa9eh7bqNaz09Pb29vI39/xj8x4H9BwcNGTR/4fzg4Ocd23fSn/LZ+fv7P/T1TWnItJcuXrp86XKBAvlr1anl7Oy8dcvWoKAgaQ/wD9i9a7fUiuvUrZ0zZ47bt+8Yn3740OG7d+4WLVa0UuVKL1+Gbtu6PSwsTAMAAACAWIwA/HYKFioYP358BweHDh3b3759+/69+9K4ZtWa1m1bly5TOlGiRJWrVnbLmkXv/OTJk3Vr1w/3Iav3AAAQAElEQVQZOjhrVjcnpxS/D/5dIqVER+0zefrkybw58/SfdWvXZc7smiKFo2Yo/3p4eCRJmiROnDguGV2SJ08ukVjaL1++7JzWObt7dhsbmxQpUqRLn1afTkhIyJUrV4sVL5YkSRI7O1uJwcHBwT53fTQAAAAAiMU4Bfo1lpaRHBGwsvp/o7WVlT6QOHFi+e0f4O+U0un8hQsdu3Qy6f/vUj179pz8Tp8hvf5Q4qWra6ZTJ09JitY+h/i2ElaLyMD5c+eDg0Py5c+nGc7f9vP127Z1m2nPePHjye9Hjx4lTZbM2GhcOH5+fvI7kX0iY7uDQ+IHDx6kTJVSAwAAAIDYigD8GqnuPg8ONm0JCgqytbWL/llhr8KiaI/kbOdXn+9UYSsrKycnJxmwtbVdtXK1r69v0qRJ9VEVK1dMZpJ1dVHNaaRnO3MCNAAAAIBYjlOgX5MhQ/rjx44bH0rSO3nilEtGl+ifJTXeOybXx+oX0IqMGTO+fPny+vXr+sPQ0NDLV65kzpxZ+9wSJUqUJk2aUydPa4b6bSJ7e6nfGsc+fPjw3272iQKfPjW2v3gRqg9I9VuWzOPHj/WHUkP29w9wcHDQAAAAACAWIwC/pmKlihfOX/hl4K+HD/8jPz/3GyDxtWKlCtE/q1XrlmNGj9m2dZtE3E0bN12+fFlvT5Y82Xfff9f7p95nz57z8bnXt3ff9OnTl/qmpBYL5MyZ49atW3qIzZM3t9dp71s3bwUHB587e07eiN6ePVu2Gzduent5v3jxws/Pz/idSVInd3fPvmf3HmkMDAzau2evvX2itGmdNQAAAACIxTgF+jXOaZ3Hjh+zbOnynj/2tLGxyZkr56QpE1OkSBH9s8qWKysV1MkTp/zYvUftOrVy5MhhHNWhY3spojaq30iG8+XPN2rMSAsLCy0WSJosaYoUjqdOniparKhUgz08c+3etVvq1ba2tsWKFZMSsfSxS2BXomTx0ydPS1U8abJk6dKlNVazPTw9JBWvW7NOhp1SOpUsVVIDAAAAgNjNIiTIT/t6eebMffzUMe2LFc38z5szr0mzJtqX6YueeQAAAABfKE6BBgAAAAAogQAMAAAAAFACARgAAAAAoAQCMAAAAABACQRgAAAAAIASCMAAAAAAACUQgAEAAAAASiAAAwAAAACUQAAGAAAAACiBAAwAAAAAUAIBGAAAAACgBAIwAAAAAEAJBGAAAAAAgBIIwAAAAAAAJVhrXzvPnLm1r9S8OfM0AAAAAEDMWIQE+WkAAAAAAHztOAUaAAAAAKAEAjAAAAAAQAkEYAAAAACAEgjAAAAAAAAlEIABAAAAAEogAAMAAAAAlEAABgAAAAAogQAMAAAAAFACARgAAAAAoAQCMAAAAABACQRgAAAAAIASCMAAAAAAACUoGoBvXL8+oG9f7cPZsW3brBkzohp7586dPj16aDEzZeLE/Xv3aoiVPvGWE9smi3f2wbec6E2dOPHA/v1ahHn4uU+fiJ35NwcAAKjDWvvaDezX7/atW/pwsuTJS37zTfmKFZM7OlauWlUDovbFbTmbN24Mfv68ao0aGj6r2LDlFC1e3ClVqmg6jB8zRuYqc5YsGgAAgEq+/gAsuv7wQ/YcOcLCwo4eOTJr+vQiRYsmSJgwf8GCGhCt2L/lPH/+vE+PHpnd3Np26ODn52dna6shFvjsW468ejRjX718+TggQAMAAFCPEgFYZ2FhkTdfvr/mzr13797jJ08mjB49ePhwafe5e3fl8uVnz5xxyZixZu3aadOl0wwnLc+dOfPWzZtSIaleq1a69OklaaxYulR2Zx0cHMpVqJCvQIGoXmjDunW7d+60tLTMmStXvYYN5XX19lXLl2/fujVlqlRVqld3N+yeRvrSiG0+2ZZz6uTJzRs2SPHQw9Ozdv36CRIkkMbunTsXKVbs2pUrvg8f1qpXT+ZEGp88eTJ14kR/f/97Pj4VKlWqXa/en9OmHTSc8rpty5YxEyfKQGho6Ojhwy9fupTN3b15ixa2dnYaPq2Pt+VIgu3cvv24SZMsraxkg/l94EBZ6XHjxpUpT500acBvv02ZOFH+/SlctKiE8LWrVu3ZvTtOnDilSpfWn977p5/8fH2HDxnimTt3+86dpeX+/fsD+vZ95OdXolQp2Zw0AACAr5Ra1wDLLqbsU6ZwcjK2vHz5ctyoUbk8PYcMH16seHHZd5TY8CIkZOyIEZI6ho0aVfKbb1avWCE9F8yda2FpOeDXXxs1brx65cqbN25E+hKyMypBpVffvl26d5cd3BPHj+vtT58+TZI06aBhw0qXLTtt0qSAgIBIX1pDrPQJthwfHx9JSjVq1Ro0dGiSZMkkCxlHOTo6/tCzZ7cePRbMmRMUGCgtC+fPT58hw+9//NGzT5+tmzfL637funWZcuWq1aihp9/web59u1W7dj//+uuzoKD1a9dq+Bw+0pYjuVfC86WLF2XY6/Rpm7hxz3h7y/CF8+ezuLmZzsCeXbvkX6F2HTt2/+knicd649CRIyV19+jdW0+/wu/hQ4nNHbt0OXzwoByI0QAAAL5SSlSAx4wcqQ9IhaRZixZSWHv8+LHeInuN9g4OhQoXluHcefPu2rHD28tL6jb2iRMXK1FCGnN6eMiP7MIeP3p09IQJUkVJmCiR9D+wf79z2rQRXyt1mjSNmzXThzO5ut6/d08flhfVJyhlnGNHjhw/ciRp8uQRXzqXh4eGWONTbjl7d+0qWLhwpsyZZbhKtWqd2rZ99uxZ/Pjxtf9OZ03u6OiQJInEWukjv0uWKiWNMmxjY+MfEJA8eXKzCUrCSWAggUpmT8Mn9Am2nMxubhcvXJDfZ7y8pD7sdeqUlHMlAOfJm9d0Tg4dOFCxcuUMLi4yLNOXDpHOsFu2bJaWljI1SeY3rl+X6rEGAADwNVLoGuBIR/k/enTpwoVWzZsbWzxy55Y9TrvXzxd9HBAQHBzcvlUrY0sew5mokUzQ33/erFnXrl7V93dr160bsU8ie3vpZmVtHfGlNcQmn3TLefTo0MGD69asMbY8evRID8BGVlZWLwynCaRLn/7ixYsSV27evGltbe3g4KBFLY6NDScXfGKfYMtxy5p13erVsmbv37/fsk2bQb/8Io1Xr1z5tmlTs+nIPzj6sPFyjGjYsLUAAICvmkLXAEdKkkO27Nm7vf4dRadOnnz69Klpi729vVRyJkyd+sYJrl21ytbOru+AAUmSJl04f36kfWSX1CllykhfGl+KD77lSHW3Zu3alWJ2o+D6jRoNGzx447p1WdzcOnXrJhlYwxfiQ205Li4ucqDt/LlzmbNkkRKxXYIEVy9fjmtjY3bQRNKvsfgcFhamAQAAqE3R7wE2ypo9u5+vr7eXl2a4CHPMiBFS/ZBQIRn17Jkz0ii7mCOHDo0bL55nnjz6hXmBgYGTx4+/dfNmpBOUGkvKVKkk/WqGizCN7bJ3K5OSgZs3bsjL5c6bN9KX1vCF+OBbTpHixfft3fvgwQPNEIei/xbfubNmNWrcePyUKR27dk2fIYPeGJP6Hj67D7XlWFpZpU2XbuumTTly5pSH7jlyrFqxwi1bNrOXK1CokP79WDLsdeqUBgAAoDbVC0dWVlYdunRZvnTp1IkTJUhUqV7d2qDLjz/OnTlz4tixmVxdy1aoID2/bdp06eLF3Tt1Spw4cfFSpdI4O5tORyq6Uu+NEydO+UqVRg0bdurEiRcvXpT85psFc+e6ZskS39Y2QYIE0jj411/TpU/ful07e8NJiRFfWhpTp04t4UcmFc3tgvHZffAtp3GzZlLXnTl9+p1bt7LnyFGvQYNoXl2OsAz/4w/NkIIyZMhQsXLlXJ6eGVxcpk2e/M/hw78OHqwhtvpQW45muAx41fLlrdq10wwXiq9fu1b+zTHrU6xECX9//369e4cEB1evVcvYLi89fMiQEqVKGe9ZAAAAoAKLkCA/DcCXIygoaMivv/bu39/Wzu7Vy5fHjh2TOiGhFwAAAHgjLh0EvjAB/v7Pg4NfvXqlGSrAUtmztFT9WgYAAAAgJqgAA1+eNatW7d+7N7GDQ8CjR0mTJWvYpEmqVKk0AAAAANEiAAMAAAAAlMCZkwAAAAAAJRCAAQAAAABKIAADAAAAAJRAAAYAAAAAKIEADAAAAABQwlf+PcBnzl/TgMhky5I+mrFsOYgKWw7eTfRbDgAA+DS+8gAscnl4asDrTp44/sY+bDmIiC0H7yYmWw4AAPgEOAUaAAAAAKAEAjAAAAAAQAkEYAAAAACAEgjAAAAAAAAlEIABAAAAAEogAAMAAAAAlEAABgAAAAAogQAMAAAAAFACARgAAAAAoAQCMAAAAABACQRgAAAAAIASCMAAAAAAACUQgAEAAAAASiAAAwAAAACUQAAGAAAAACiBAAwAAAAAUAIBGAAAAACgBAIwAAAAAEAJBGAAAAAAgBIIwAAAAAAAJRCAAQAAAABKIAADAAAAAJRAAAYAAAAAKIEADAAAAABQAgEYAAAAAKAEAjAAAAAAQAkEYAAAAACAEgjAAAAAAAAlEIABAAAAAEogAAMAAAAAlEAABgAAAAAogQAMAAAAAFACARgAAAAAoAQCMAAAAABACQRgAAAAAIASCMAAAAAAACUQgAEAAAAASiAAAwAAAACUQAAGAAAAACiBAAwAAAAAUAIBGAAAAACgBGvta3fyxHENeHtsOXg3bDkAAACxlkVIkJ8GAAAAAMDXjlOgAQAAAABKIAADAAAAAJRAAAYAAAAAKIEADAAAAABQAgEYAAAAAKAEAjAAAAAAQAkEYAAAAACAEgjAAAAAAAAlEIABAAAAAEogAAMAAAAAlEAABgAAAAAogQAMAAAAAFACARgAAAAAoAQCMAAAAABACQRgAAAAAIASCMAAAAAAACUQgAEAAAAASrDWvmqeOXNriNrxU8c0AAAAAFDDVx6ANTJe1Dg6AAAAAEApnAINAAAAAFACARgAAAAAoAQCMAAAAABACQRgAAAAAIASCMAAAAAAACUQgAEAAAAASiAAAwAAAACUQAAGAAAAACiBAAwAAAAAUAIBGAAAAACgBAIwAAAAAEAJBGAAAAAAgBIIwAAAAAAAJRCAAQAAAABKIABH4uSJk545c/fs0TOaPsuXLW/6bdNIR5UvU2Hvnr1azBw+/E+lCpVfvHihAQAAAAA+JgJwJLZt3ZYzV869e/Z9glyaPFmy6tWrWVlZaQAAAACAj4kAHImtW7e1advazs5u96492keWwSVDm3ZtLC1ZEQAAAADwcVlreJ23l/cjv0f58ucrVryYlIJLl/nGOGrL5i0LFyw8e/ZcLo9cBQsVNLb7+/uPHzth+7bt8eLHa9W6ZaSTbdmiVb58eU+dOn3s6LEsblnqN6hXsVJFaf/n8D89fvxp5+4dMhwWFvb3kr/XrV1/9crV/AXyNWveLEfOHNL+6tWrmX/OWrVylcxY3rx5vvv+O5kBaT+w/8BfCxaeHJw9qwAAEABJREFUOH4ia7asUkauXLWyBgAAAACIAoVHc1u3bC1StEicOHGKlyy+e9du41nQVy5f+enHnsVLlti0daOk3H179xmf8sfgP7y8vMZPGjf/r3mPHj0KDAyMdMr79u0fNmLo9l3bGjZq8OvA386dO2fWYdXK1fLTq3fPDZvXlyxVsl2b9vfu3ZP2hX8tWrJoSd9+fZatXOqQxKFL564hISE3btzo3atPvfp1ZX7atm87buz47dt2aAAAAACAKBCAzW3cuElqvzJQuHChly9f7t9/QG9fs3pNqW9KNf+uWaJEifLkzVO2XBm9XeLuls1bf/3tF3d396RJk37f8vu4ceNGOuVy5cvZ2dnFjx+/fIXylatUWrNqrVmHJYsWd+jYXsq50q1K1Sq5cuVcuXyltC9auKhj5w5Sc06RIsWAXwb8vWyJjY3N34v/rlW7lsyqra1t7tyeUlKWbhoAAAAAIAqcAv2a8+fO3/O5V7xEeACWInChwoW2bdlWokRxeXjhwsXs7tmNPa2t/110Uhl+9epVFrcsEUeZsTa501XKVCkPHjhkOjY0NPTs2XMd2nU0bUySNKmE8Du377hkdDE2Jk+eXH57eXmfOH5i1p+zTKepAQAAAACiQAB+zdYtW8PCwr4pUdrYIsXYgb8OsLS0lPZInyLpVzNcvmthYaHF2MvQl/oTzcxdMDdHDvfXer58GekU5BU7d+38XYvmGgAAAAAgBjgF+jVbt26rXqPatBlT9Z8Ro4YHBgYeOhheqk2XPt3dO3eNPQMDg/QBaZd4fOfOHf2h5NKgoKBIJ/7s2TPj8MWLl0yLupqhbpw+ffrTp04ZW06f9pLfVlZWqVKnkrq0sV0Kv/I7U6aMXqdPGxulEP38+XMNAAAAABAFAvD/Xb58+drVa82aN8uXP5/+U7pMaQ9Pjy2bt8rYpk2bbN+2ffasORKJz549t3PHTv1ZiRMnrluvzo/denh5eYUEh8yY/mdUteLdu/dIppUY/NeCv/bs3iMTNOvQ7YduM2fM2rVzl7+//6K/FnVs1/H69evS3qBhg+FDRxw8cPDBgwdjR49t27rdkydPWrVpdfTIsYULFkrnbVu3de/6w4b1GzQAAAAAQBQIwP+3dfPWHDncM7hkMG2sWq2K5F7JtClTpZSC8O6du4oXKfHH4D/0C4N13X/oni17tk7tOxcrWjx58uR2dnaRTr9I0SKjR4wqUrDo5k1bho4Y6pzW2axD8RLF2nds17NHr1LFv5k1c/aQoYPTpUsn7Q0bNahTr86g3weXL1NB0vjkaZMTJkyYIkWK8RPHzZk9Vzr37d2vZu0aNWvV1AAAAAAAUbAICfLTvl6eOXMfP3VMiwVatmhVpkzpBo0aaLFG7Fk4AAAAAPAJUAEGAAAAACiBAAwAAAAAUAJfg/SJzJg5XQMAAAAAfD5UgAEAAAAASiAAAwAAAACUQAAGAAAAACiBAAwAAAAAUAIBGAAAAACgBAIwAAAAAEAJBGAAAAAAgBIIwAAAAAAAJRCAAQAAAABKIAADAAAAAJRAAAYAAAAAKIEADAAAAABQgrX2tfPMmVsDAAAAACjPIiTITwMAAAAA4GvHKdAAAAAAACUQgAEAAAAASiAAAwAAAACUQAAGAAAAACiBAAwAAAAAUAIBGAAAAACgBAIwAAAAAEAJBGAAAAAAgBIIwAAAAAAAJRCAAQAAAABKIAADAAAAAJRAAAYAAAAAKIEADAAAAABQAgEYAAAAAKAEAjAAAAAAQAkEYAAAAACAEgjAAAAAAAAlEIABAAAAAEogAAMAAAAAlGCtfdUOVEuv4T+FVl/TAAAAAEBVX3kAFnlnH9KgaUeaF9AAAAAAQGGcAg0AAAAAUAIBGAAAAACgBAIwAAAAAEAJBGAAAAAAgBIIwAAAAAAAJRCAAQAAAABKIAADAAAAAJRAAAYAAAAAKIEADAAAAABQAgEYAAAAAKAEAjAAAAAAQAkEYAAAAACAEgjAAAAAAAAlEIABAAAAAEqw1mDiypSf/Q5uMm1JVf37VDVb31k5I+jGhUydh2lv79yg1g55S6Uo31B7P0eaF8j223xbZ1cNAAAAAPD2CMDmkhaplKHVALNGu/RuNg7J9eHAy95XpvTLMXyFBgAAAAD4chCAY8Teo6hxOPjhHQ0AAAAA8KUhAMfI7WWTn92+kqnz8OuzhzzYuVIznJDsVKlJmnodTbv5H9t9Z8W05z7X46fNnLxkjWTFqurtYa9e3pg33O/g5rgpnJ0bdU2QKaehNez+1iW+BzY9v3s9oZunU+Wm/7ZHPR3dq+fPzgxsmsi9YNrGP2gAAAAAgJjhJlhvJ13z3i7tfo+bPFXe2YfM0m/QtXOXJ/ZOXqpmztFrk+Qvc23moMCrZ/VRASf2Js5TMvvgRfGdM12Z3F8CsTQ+2L3q4d51aZv8mHPUahl7YUTnEL970U9HC8/Sry6O/cEmWcq033bXAAAAAAAxRgXYnO++9fJjfOg5cauVXcKYPPHelsVJCpRN/k1tGU5RvqFD/jLGy4btPYomypZPBlLXbP1w16oQv/s2SZ0ebF2aum57uwzZpD1Z0Sp++zdKbTl1rTbRTEdcnznoZdBTt77TNAsLDQAAAAAQYwRgc4ncCzhVbGx8aBnPNoZPDL5/2z5nYeND09RqYWmlD8RJnEx+hz7xl4GgmxcvjupmOgXrREmin87tZVOkmJz+uz6WNvE0AAAAAMDbIACbi2OfNFH2/Non4dZvRoJMOWLeP8TXx7lRt1tLJjjk+8bKNkZ1aQAAAACAjmuAP5i4jqlDHt03Pnx66VTYq1dRdbawso6bIk3gpVMm/U+/cTpS+01RrkG81C7X5w7XAAAAAABvgwD89qK4+DZF2foPd69+sH1ZaODjB7tWXhja4bHXwWgm49yg69118/yP7Qp94n9v08KLo7o997ke/XQs4tjI7wwt+z86sj3g1H4NAAAAABBjnAL91uzSu714/OhI8wJpG//gWKaesd02vVvG9oPvrJh2Y8Eoizhx0tTraHopb0SJPYulrtX6yuR+r16ExEmczKXtr/Gc0sVkOnEd06Ss3PTazEE5hi3jYmAAAAAAiCGLkCA/7et1oFr6vLMPaTB8cXGh1dc0AAAAAFAVp0ADAAAAAJRAAAYAAAAAKIEADAAAAABQAgEYAAAAAKAEAjAAAAAAQAkEYAAAAACAEgjAAAAAAAAlEIABAAAAAEogAAMAAAAAlEAABgAAAAAogQAMAAAAAFACARgAAAAAoAQCMAAAAABACQRgAAAAAIASCMAAAAAAACVYa1+7I80LaAAAAAAA5VmEBPlpAAAAAAB87TgFGgAAAACgBAIwAAAAAEAJBGAAAAAAgBIIwAAAAAAAJRCAAQAAAABKIAADAAAAAJRAAAYAAAAAKIEADAAAAABQAgEYAAAAAKAEAjAAAAAAQAkEYAAAAACAEgjAAAAAAAAlEIABAAAAAEogAAMAAAAAlEAABgAAAAAogQAMAAAAAFACARgAAAAAoAQCMAAAAABACQRgAAAAAIASCMAAAAAAACUQgAEAAAAASiAAAwAAAACUQAAGAAAAACiBAAwAAAAAUAIBGAAAAACgBAJwjKxds7ZiuYqeOXP7+NzTYrdRI0YVLVSsauVqMjxi2Igunbpo7+rGjRvyluW39smdPXuuUf1G8uqy5KPvKe900V+LtA83wc9i5PCRxrUW8SEAAACAD8JaU8Cpk6fmzpl35J8jzs7Opb4p2ey7ZlZWVm81hT9nzKxarWq+/PmSJHEwG/XwwcNpU6fv2rkrXrx4RYoVadW6pYODg/aZ+Pr6zps7f/jIYSlSpJCHadKksbGx0b5Ay5cuc3R07PZDNxcXF+1D+OAT/IB8H/rOn7fAuNbMHn4MstG2+O77mzduVqla5bdBv0bssH7d+uFDR3Tt3rV6jf+H8FevXk0YN2HH9p137txxcnIqV75s+47tLSwsTJ944fyFzh27VKhYoUOn9nHixNEAAACA2OTrrwBL+m3ZopWDQ+L+A/rn8sg5YfzEieMnam9JMkkGlwwSgM3y5OPHj5s2aXb71q2u3bvUqVt77eq1XTp11T4QCdVvWwOUYCO/PTw8cuTMIQMNGjXo3LWzPiooKOiLqGDrfH39kiVPJgs8abKk2ofw/hOU0vovA37RPoKHD19ba2YP302jBt9GVevW02+6dOkKFipoFl91O3fsHPTb4BGjhpumXzFl0hQ5vJI3f97fBv3m4ekxY/qf06ZMM+1w+/bt9m07NPy2gXwcSL8AAACIhb7+CrAU0ypWqti3f18ZLl3mm+CQkCWL/+7YuaOl5VuE/7CwsEjbN6zfaBPHZuyEsdbW4UvSMYVjr596e3t5Z3fPrr23Gzduam8pTAuLatTNt5/aZxTVAv9cE5Ti5507dxMmTKB9BGZrLZqVGEOBTwP9/f0jHeXn5yfpN3ny5KPGjOzaqWvExXL//n3ZhsdNGJsnbx6zUdKSydVVCr8yLL+Dg59v27a9Tbs2/852WFiPH36qXbd2s+bNNAAAACBW+vorwEOGDu72w/+rsnnz5gkMjDweSHW0X9/+ZUuXq1i+0oD+AyUqSOPePXulcPr06dM+vfpGrKDWb1Bv+sxpevoNn3i+vPL71q3bEScuNeQObTsUL1KiUoXKA38eKBFFM1SnZZpSRtb76EXaY8eOy3DTb5tKyfHWzVvS0uunXtLy4sWLCeMmVq5QpUTRkv37/nz3zl2zlxg7emzDeo1kQN6CPEv/kRfVRzWo11AGKparWKZU2YizJy8qzy2Uv3D9ug2mTp6qRUZmQKZTt1Y9mYEfu/946dIl46iVy1d+3/z7wgWKSOFx9arVxnZZaPIza+Zsme3ff/094gTHjR1fr079YoWLd+3czcvLSxpDgkNktqUIuWzp8kgv2b144aJ0liXZoV3Hs2fOvnEOI51gNO8l4pqSKeTxyLtt67aVK1bJFP5e8ndMVkdEy5ctl6VUpGDRli1arVu7Xm80XWtS8Dd7GM3amTljpjw0TnzXzl0yk5phiy1auJjMj8yVzO3VK1dN5yH4eXDq1KknTp4QVYVW1kjValXyF8gfcVSBggX09KuztbVLnDix8eGqFaueP3/epm1rLVr6JrHor0Xy7uRNLf172cuXLydNmFS9So3yZSrIQ2NPebho4eIhg/4oVfybdm3aHz1y1NfXV96UPKxTs+7pU6c1AAAA4C19/QHYysrKdDf95s1bNnFtEiZMaNZNSnwd2nWQQNWhY4fvW35/7Nixzh3Dbx+VI0eOaTOmxo8fv1XrljIQ8RpgKab9f+KGKqvUgc36yC7+d81bPHnypHffXu3at7186UrvXn20aPXu27tBowYycXnRVm1aScu4MeN2797drkPbPv16S5Gwf7+fzZ5Su07t/gP6ycDwkcPkWfJTukxp46gBA8P7/zHsjxGjhps9UTJSm5ZtXDK6DBoyqGatmgsXLpo3ZxspXxsAAA1aSURBVF7EWRo8aMjmTVvqN6wvryLxr0PbjpIMpf3w4X+GDxtRslTJ3wf/nsUtixw7OPLPEeOzzp8/f+XylSrVqhQrXsxsgkOHDF329zKpz/88sH9wcHDbVu0ePHhgHcda5tzD06NEieIyUKhQIdOnyMECyb3Xr1/v2r1LpcqVJFpLoot+DiOdYFTvJdI1pU8hd57cRYsVlYESJUvEZHWY2bB+w6DfBmfJ6vbboN9cXFz69+2/a9dus7U2eMggs4cxXztG+hZrl8CuRcsWMpAyVUrTsfJw8tRJ8eLFi/S5Pnd9NqzbkN3dvVmT5kULFZOPwOFDhyPt+c/hfyRpd+jYXn8o5V9ZF7Iqf+j2ozxRnq4fJoiUt5e3zN6ChfPr1Ksz6LdBrVu2cU7rPO+vuW3atZaHJ46fMPbcumVrmbKlV65ekSpVqvZtOwz+fXC16lXloWcez04dO8uRLA0AAAB4G0rcBMtIUtaqlasaNGwQsfwl+/0BAQGr1qy0s7PTDCdLS4Vqx/Ydpb4plS9/PknR+jXA0U9/yeK/s2XP5unpYda+ZtUayWkzls2Q7K0ZKmlvPCE5a7asJ0+cjBsvrvFFpQJWvUb1KlWryHD5CuWNdWOjNM5pngY+1QyXjyZLnkwGduzYef3qNX3Us+fPZSCXRy4nJ/NbK/3550x5m4OG/Fuhze6e3cHkkIHuzp07UuJbtGRh5iyZ5WHxEsWrVqq2YsVKqYHnyZNbgpZ+1vc3pUvJW9u963/s3QlUlWUex/EXYkn2RSmFLIpKKgSXbGRqxpkElzDbtNWlcgUtK9kRF0QdlKUMxFQQRMFEreakac05boDLTEFIo6YjcpxJcEHOSVAUnD+8db3dBa5nmDNO7/dzPJz7vve5733e93nvOf7u/77Pu0cthre9tY+3yWmWpEQpJdmCDevUF4aEhrw+4Y283LzZUbNll93WF3p6ehgfcCk1Nzc3F6/b5OLi0v6qoX8c8mSnPTTYYActTY6UtbW1vHBj0cfOzk6WD4eBFVnZb82aqf48WI6Sq6tLdma2ZHLjUTNYtGR09Lm6uUonbWxsfH3v6fSMNbBr125PT88vtn/xwpjn7ezsP9n6iZRe1xcV9OnTR23Q2NgoFWx5IJ8gKSPL6aSuP3HiRE1Nzf7SspBhoc88O7pkX+mihYtbWlpfevlF43e5z+++UU+PUtrC/3PbPt/m5OSoLj73/HM7tu/YsWNn0M+fIPXTJw+iYiKldB8YGKguRkbOlpHaX7Zf9xUPAAAAYAkN3QZJarzxsQnXW6+b/JXm3r37goIC1fQr3N3dH3744dKSUsVihesLd+7YmZCYYPxURUVFUL9ANVMJLy8v4wssO9XH3/+zTz8rKy1ruNggi2oC7BKStAc+eqM/AQGPSCozaFNaUibdVhOjsLOzk104eOCA0l5j17/mWarW586d1y06Opq+brakpNTV1VX/hcHBg0s6O+BHjx6Tl+j2Xbqhm3O7gx5avi+Wj9RNDUd1dbUE6eDgYN2awb8NPnLkyPnz55XOWDI6XeX7Y99L9XvxnxZJIh02PDTjg3R3D/etmz/RNZDSsXzZkZaRKsVbqQ9/ufNLdf2xo8fk78Q3JkrilQq5VMUluxZ/XGzyXfTrzz4+Pt26ddMtevv41NXeuMqgW7efWtrb28t51c3hp5YyQHfccUdt7f/HjG4AAAC4dWilAtzS0hIXE3dg/4Hc/BwHBwfjBlLBk9qX/hpnZ+f6+ouKZYoKNy5NWZaUnOTv38f42bNnz/3n90Z6L/LdqNnR4dMipCD5YJ8HZ707a9BN1vfMOVt3Vsp9Hbe5ePGi5I1+ffvrr1QLgPLNwubizVL0k6Lojz+2VS9HjByhdKah4aKD4y8Gov2A13f8qqamJv28ZGEPLW9p+Ujd1HCoIVl/f9Uf4V+4UG9w1hmzZHS6ihR4H3rIX3cEJHZKef/kyRtXEavFcKW9Nmtna7csJVVK90rbuFy2srIaHHzj9+q/GfzY7l275dzoeLY5a2srg8XWVtNzgFkZtrQ21xIAAAAwRxMB+Nq1a+ocSx+t+cjPz89kG6ngNTU16q+RUljv3ncpFihYtz49NX3u/LlPhY002aBHj+6XLjUar1dvQnPdsv/HS3U6c8WHSntKyc7Kjp4d/ZddX93UXNbm9PDqceXKlY7buLm5de/RXb0qVcfJqa26u/z95ZuLt0RGz56fNE+KunEx8YoFXF3dGi8ZHvBOw6e8o7mqaQc9tLyluZEydlPD4erm2tZSb8uys/LXw4KwbW505OS53tqqdCk3N9faM2cMVurKsAbuvc+3rq5O/UrC1dVF+fl81pH83CXnJwAAANBVfv3/PW1ubo6YPuPE8eP5BXkmy7OqoKDAw5VVUihWFyVyHD1ytG9g3063n5W5QhJgWkaqwU1T9QUGBlaUV0hP1EXJDHlr8+SBh6eH0na7oxp1/ZkfznTwRgcPHrp69arSNvuuwwtjX5AypiU/oLWEFD/1p62Sbwr27d1n3Kb+Qr3f/X5SAFT/ybHq3bu3PPXtt5XDRwwf9fQoSb9KW0G4RbGAbLChoUF/juLyb8oDOzvgUp+sqqrSXXArh1RXNO6gh5bvi7mRMmZuOCorD2/ZvMXg9kJ33323ZPvy8hvTO5V//U2vXr0suSmxudFx9/D41w8/qH0QXfJ74EcCAr777u/q/OdK+wTaf/vr1wF9+6qPV2Rlt+pF7n+cOOnh4aEW5OWTIru8b1+J7tnSkjKT5XcAAADgf+jXXwFOiJtTdbgqLiG29kxt7c83MerZs6fBhZQjw0ZKlJ07Z+7oZ0bL4saijTY2NkNDhna88Y1FH69auSp8RrikoEMHD6krpZbo/5C/frOwp8NycnInvTH55VdekvLjuvwCKUqPnzBeuuHt7b00ZdmMt2ZIJNu6Zav+q2xsba9cviKblWZ39rxzXuI8eTDx9Qm33367VFzv8b1HfwLqTtnato21pLv63ncZdG/SpDfHPD82Njpu2PDQlpbWjPSMsLCnHn/icVubtqnCKisqHR0c77/fT/LMe7Pemzx1shyZw5WH16zOWbc+39fJV0KppEEpaUpR9LNP/3yqukYKnqdOnZLU10F/ZIP9B/RPiJ8TMSPc1ta2vLyitLSsYMO6jvciZFhIRvr7E8ZNHDf+te7de2wsLLrN+jbdBs310PitzbU0N1JS25SW586dl+F44IEHHJ0czQ3H0iUpkoEHDRqkf4LJy8e+NDY7a6Wzs7Onp2dd3dm1uXmTJr+pWMDc6PQf0K+psSllSUrosNDj3x83OHnkkJ48WS29HTBwgEEZVrp3ualJHjS0f4+gnre9vHvJqTg05Mn0tPR33n536rQp8irZfdm7sS+OkQZNl5u2fb7tqy+/GvnUiICAgJpTNYWFhZFRkeo2vby8hvxhSNK8pMvRkR4e7nt27ykrLVudu1oBAAAAbiW//gB8+vTpS5cuxcf+Ym4qyS1vv/O2/hoXF5ecvDWLFy6eMmmqLA56bJAsmrvcVOefp0/L36wPs/RXBgQ8kr8+X3+NZKfctTmJCYmLk5dIUBwcPHhZ2lKrdouWJM+MeCtiWsTARweGR0w/sP/GpE1P/O7x4k3F0h+1t2vzc1d/tGZZSqpUjCXBZnyQrtwMqXCGhIbERMUYd0/C28rVK5cuWRodFXPt6rVXXn15Svs8YT179RwxcsSchMQFC+eHjQpLS09NS00Pb7+xsDz1/vIM33vbsmXEzIiraRmjw56RKuiYsWOiY6Ok5L6hoDA2PqbjLskGJW7NCJ8pxUMfH+8Ps5brz4llkqTHrOzM+XMXJCctkjGaMHF88sJF+hs02UOTb22ypbmRUtrmKH42LjZehmN55geSP80NR1C/oKqq79QJnPVNnjLJ3s4uaf7CxsZG+aZg6vSpr772imIBc6MjAxoTFy393L79iyFDfj/h9YmJerdiGjfutczMrJzVOQcO7dfN6aVKjE+srq7WLcr3DvJXtjk9fJq9vX3O2jXJC5JlBJX2qcizV2Wr83tJeX/lqmzZ3xWZ2ZKKZTfnL5gnlX/ddhYuSpLxjIuJkyqx7L4cEDnTFAAAAOBWYtXceEEB0EWKNhTt3bM3MztTAQAAAHCL0dZ9gIH/qvr6+k2bilPTlykAAAAAbj1UgAEAAAAAmsBNSgAAAAAAmkAABgAAAABoAgEYAAAAAKAJBGAAAAAAgCYQgAEAAAAAmkAABgAAAABoAgEYAAAAAKAJBGAAAAAAgCYQgAEAAAAAmkAABgAAAABoAgEYAAAAAKAJBGAAAAAAgCYQgAEAAAAAmkAABgAAAABoAgEYAAAAAKAJBGAAAAAAgCYQgAEAAAAAmkAABgAAAABoAgEYAAAAAKAJBGAAAAAAgCYQgAEAAAAAmkAABgAAAABoAgEYAAAAAKAJBGAAAAAAgCYQgAEAAAAAmkAABgAAAABoAgEYAAAAAKAJBGAAAAAAgCYQgAEAAAAAmkAABgAAAABoAgEYAAAAAKAJBGAAAAAAgCYQgAEAAAAAmkAABgAAAABoAgEYAAAAAKAJBGAAAAAAgCb8GwAA//+afMnFAAAABklEQVQDAG8jrPa5QNBOAAAAAElFTkSuQmCC",
      "mimeType": "image/png"
    }
  ]
}
```
