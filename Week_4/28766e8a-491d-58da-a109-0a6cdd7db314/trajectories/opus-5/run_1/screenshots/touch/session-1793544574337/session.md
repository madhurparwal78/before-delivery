
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
  "page": "- Page URL: http://127.0.0.1:4173/signin\n- Page Title: Linewell",
  "snapshot": "- main [ref=e3]:\n  - heading \"Sign in to Linewell\" [level=1] [ref=e4]\n  - generic [ref=e5]:\n    - alert [ref=e6]\n    - generic [ref=e8]:\n      - text: Email\n      - textbox \"Email\" [ref=e9]\n    - generic [ref=e11]:\n      - text: Password\n      - textbox \"Password\" [ref=e12]\n    - button \"Sign in\" [ref=e13] [cursor=pointer]\n  - link \"Create an account\" [ref=e14] [cursor=pointer]:\n    - /url: /signup"
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
  "page": "- Page URL: http://127.0.0.1:4173/signin\n- Page Title: Linewell",
  "inlineSnapshot": "- main [ref=e3]:\n  - heading \"Sign in to Linewell\" [level=1] [ref=e4]\n  - generic [ref=e5]:\n    - alert [ref=e6]\n    - generic [ref=e8]:\n      - text: Email\n      - textbox \"Email\" [ref=e9]\n    - generic [ref=e11]:\n      - text: Password\n      - textbox \"Password\" [ref=e12]\n    - button \"Sign in\" [ref=e13] [cursor=pointer]\n  - link \"Create an account\" [ref=e14] [cursor=pointer]:\n    - /url: /signup"
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
      "value": "judge-owner-q91n@example.com"
    },
    {
      "target": "e12",
      "name": "Password",
      "type": "textbox",
      "value": "judge-pass-q91n"
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
  "page": "- Page URL: http://127.0.0.1:4173/\n- Page Title: Linewell",
  "snapshot": "- main [ref=e16]:\n  - heading \"Your diagrams\" [level=1] [ref=e17]\n  - generic [ref=e18]:\n    - generic [ref=e19]:\n      - text: Title\n      - textbox \"Title\" [ref=e20]\n    - button \"New diagram\" [ref=e21] [cursor=pointer]\n  - list [ref=e22]:\n    - listitem [ref=e23]:\n      - link \"Judge Map q91n\" [ref=e24] [cursor=pointer]:\n        - /url: /d/d_00hnraxvirnr"
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
  "page": "- Page URL: http://127.0.0.1:4173/\n- Page Title: Linewell",
  "inlineSnapshot": "- main [ref=e16]:\n  - heading \"Your diagrams\" [level=1] [ref=e17]\n  - generic [ref=e18]:\n    - generic [ref=e19]:\n      - text: Title\n      - textbox \"Title\" [ref=e20]\n    - button \"New diagram\" [ref=e21] [cursor=pointer]\n  - list [ref=e22]:\n    - listitem [ref=e23]:\n      - link \"Judge Map q91n\" [ref=e24] [cursor=pointer]:\n        - /url: /d/d_00hnraxvirnr"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Judge Map",
  "target": "e24"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/d/d_00hnraxvirnr?page=p_00hnraxvisi3\n- Page Title: Linewell",
  "snapshot": "- generic [ref=e25]:\n  - banner [ref=e27]:\n    - heading \"Judge Map q91n\" [level=1] [ref=e28]\n    - button \"Judge Peer q91n, editing\" [ref=e30] [cursor=pointer]: JQ\n    - generic [ref=e31]:\n      - button \"Share\" [ref=e32] [cursor=pointer]\n      - button \"Export\" [ref=e36] [cursor=pointer]\n      - button \"Outline\" [ref=e40] [cursor=pointer]\n  - generic:\n    - generic:\n      - status \"Connection\"\n  - generic [ref=e43]:\n    - generic [ref=e44]:\n      - img \"Page 1 canvas\" [ref=e46]:\n        - generic [ref=e49]:\n          - generic \"Start\" [ref=e50]\n          - generic \"Check\" [ref=e53]\n      - group \"View\" [ref=e56]:\n        - button \"Zoom out\" [ref=e57] [cursor=pointer]\n        - status \"Zoom\" [ref=e61]: 100%\n        - button \"Zoom in\" [ref=e62] [cursor=pointer]\n        - button \"Reset zoom\" [ref=e66] [cursor=pointer]\n        - button \"Layers\" [ref=e72] [cursor=pointer]\n        - button \"Toggle inspector\" [expanded] [ref=e76] [cursor=pointer]\n    - generic [ref=e80]:\n      - button \"Previous page\" [ref=e81] [cursor=pointer]\n      - generic [ref=e84]: Page 1 · 1 of 1\n      - button \"Next page\" [ref=e85] [cursor=pointer]\n  - navigation [ref=e89]:\n    - button \"Layers\" [ref=e90] [cursor=pointer]\n    - button \"Inspector\" [ref=e94] [cursor=pointer]\n    - button \"Comments\" [ref=e97] [cursor=pointer]\n    - button \"History\" [ref=e100] [cursor=pointer]\n    - button \"Shape actions\" [ref=e105] [cursor=pointer]\n    - button \"Insert\" [ref=e107] [cursor=pointer]"
}
```

### Tool call: browser_snapshot
- Args
```json
{
  "depth": 4,
  "boxes": true
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/d/d_00hnraxvirnr?page=p_00hnraxvisi3\n- Page Title: Linewell",
  "inlineSnapshot": "- generic [ref=e25] [box=0,0,375,812]:\n  - banner [ref=e27] [box=0,0,442,44]:\n    - heading \"Judge Map q91n\" [level=1] [ref=e28] [box=10,11,120,22]\n    - button \"Judge Peer q91n, editing\" [ref=e30] [cursor=pointer] [box=140,0,44,44]: JQ\n    - generic [ref=e31] [box=194,0,238,44]:\n      - button \"Share\" [ref=e32] [cursor=pointer] [box=194,0,71,44]\n      - button \"Export\" [ref=e36] [cursor=pointer] [box=271,0,75,44]\n      - button \"Outline\" [ref=e40] [cursor=pointer] [box=352,0,79,44]\n  - generic [box=0,44,442,0]:\n    - generic [box=0,44,442,0]:\n      - status \"Connection\" [box=10,44,422,0]\n  - generic [ref=e43] [box=0,44,442,717]:\n    - generic [ref=e44] [box=0,44,442,664]:\n      - img \"Page 1 canvas\" [ref=e46] [box=0,44,442,664]:\n        - generic [ref=e49] [box=288,-60,608,488]\n      - group \"View\" [ref=e56] [box=147,646,285,52]:\n        - button \"Zoom out\" [ref=e57] [cursor=pointer] [box=151,650,44,44]\n        - status \"Zoom\" [ref=e61] [box=198,663,42,19]: 100%\n        - button \"Zoom in\" [ref=e62] [cursor=pointer] [box=243,650,44,44]\n        - button \"Reset zoom\" [ref=e66] [cursor=pointer] [box=290,650,44,44]\n        - button \"Layers\" [ref=e72] [cursor=pointer] [box=337,650,44,44]\n        - button \"Toggle inspector\" [expanded] [ref=e76] [cursor=pointer] [box=384,650,44,44]\n    - generic [ref=e80] [box=0,708,442,53]:\n      - button \"Previous page\" [ref=e81] [cursor=pointer] [box=120,713,44,44]\n      - generic [ref=e84] [box=172,726,97,19]: Page 1 · 1 of 1\n      - button \"Next page\" [ref=e85] [cursor=pointer] [box=277,713,44,44]\n  - navigation [ref=e89] [box=0,761,442,51]:\n    - button \"Layers\" [ref=e90] [cursor=pointer] [box=17,765,44,44]\n    - button \"Inspector\" [ref=e94] [cursor=pointer] [box=90,765,44,44]\n    - button \"Comments\" [ref=e97] [cursor=pointer] [box=162,765,44,44]\n    - button \"History\" [ref=e100] [cursor=pointer] [box=235,765,44,44]\n    - button \"Shape actions\" [ref=e105] [cursor=pointer] [box=308,765,44,44]\n    - button \"Insert\" [ref=e107] [cursor=pointer] [box=380,765,44,44]"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Layers bottom toolbar",
  "target": "e90"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/d/d_00hnraxvirnr?page=p_00hnraxvisi3\n- Page Title: Linewell",
  "snapshot": "- generic [ref=e1]:\n  - generic [ref=e25]:\n    - banner [ref=e27]:\n      - heading \"Judge Map q91n\" [level=1] [ref=e28]\n      - button \"Judge Peer q91n, editing\" [ref=e30] [cursor=pointer]: JQ\n      - generic [ref=e31]:\n        - button \"Share\" [ref=e32] [cursor=pointer]\n        - button \"Export\" [ref=e36] [cursor=pointer]\n        - button \"Outline\" [ref=e40] [cursor=pointer]\n    - generic:\n      - generic:\n        - status \"Connection\"\n    - generic [ref=e43]:\n      - generic [ref=e44]:\n        - img \"Page 1 canvas\" [ref=e46]:\n          - generic [ref=e49]:\n            - generic \"Start\" [ref=e50]\n            - generic \"Check\" [ref=e53]\n        - group \"View\" [ref=e56]:\n          - button \"Zoom out\" [ref=e57] [cursor=pointer]\n          - status \"Zoom\" [ref=e61]: 100%\n          - button \"Zoom in\" [ref=e62] [cursor=pointer]\n          - button \"Reset zoom\" [ref=e66] [cursor=pointer]\n          - button \"Layers\" [ref=e72] [cursor=pointer]\n          - button \"Toggle inspector\" [expanded] [ref=e76] [cursor=pointer]\n      - generic [ref=e80]:\n        - button \"Previous page\" [ref=e81] [cursor=pointer]\n        - generic [ref=e84]: Page 1 · 1 of 1\n        - button \"Next page\" [ref=e85] [cursor=pointer]\n    - navigation [ref=e89]:\n      - button \"Layers\" [ref=e90] [cursor=pointer]\n      - button \"Inspector\" [ref=e94] [cursor=pointer]\n      - button \"Comments\" [ref=e97] [cursor=pointer]\n      - button \"History\" [ref=e100] [cursor=pointer]\n      - button \"Shape actions\" [ref=e105] [cursor=pointer]\n      - button \"Insert\" [ref=e107] [cursor=pointer]\n  - dialog \"Layers\" [ref=e110]:\n    - generic [ref=e111]:\n      - region \"Pages\" [ref=e112]:\n        - heading \"Pages\" [level=2] [ref=e113]\n        - list [ref=e114]:\n          - listitem [ref=e115]:\n            - button \"Page 1\" [active] [ref=e116] [cursor=pointer]\n        - button \"Add page\" [ref=e117] [cursor=pointer]\n      - region \"Layers\" [ref=e119]:\n        - heading \"Layers\" [level=2] [ref=e120]\n        - list [ref=e121]:\n          - listitem [ref=e122]:\n            - generic [ref=e123]: Layer 1\n            - generic [ref=e124]: \"2\"\n            - button \"Hide layer Layer 1\" [ref=e125] [cursor=pointer]\n            - button \"Lock layer Layer 1\" [ref=e129] [cursor=pointer]\n        - button \"Add layer\" [ref=e133] [cursor=pointer]"
}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "Escape"
}
```
- Result
```json
{}
```

### Tool call: browser_snapshot
- Args
```json
{
  "target": "e46",
  "depth": 3
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/d/d_00hnraxvirnr?page=p_00hnraxvisi3\n- Page Title: Linewell",
  "inlineSnapshot": "- img \"Page 1 canvas\" [ref=e46]:\n  - generic [ref=e49]:\n    - generic \"Start\" [ref=e50]\n    - generic \"Check\" [ref=e53]"
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
  "page": "- Page URL: http://127.0.0.1:4173/d/d_00hnraxvirnr?page=p_00hnraxvisi3\n- Page Title: Linewell",
  "inlineSnapshot": "- generic [ref=e25]:\n  - banner [ref=e27]:\n    - heading \"Judge Map q91n\" [level=1] [ref=e28]\n    - button \"Judge Peer q91n, editing\" [ref=e30] [cursor=pointer]: JQ\n    - generic [ref=e31]:\n      - button \"Share\" [ref=e32] [cursor=pointer]\n      - button \"Export\" [ref=e36] [cursor=pointer]\n      - button \"Outline\" [ref=e40] [cursor=pointer]\n  - generic:\n    - generic:\n      - status \"Connection\"\n  - generic [ref=e43]:\n    - generic [ref=e44]:\n      - img \"Page 1 canvas\" [ref=e46]\n      - group \"View\" [ref=e56]\n    - generic [ref=e80]:\n      - button \"Previous page\" [ref=e81] [cursor=pointer]\n      - generic [ref=e84]: Page 1 · 1 of 1\n      - button \"Next page\" [ref=e85] [cursor=pointer]\n  - navigation [ref=e89]:\n    - button \"Layers\" [active] [ref=e90] [cursor=pointer]\n    - button \"Inspector\" [ref=e94] [cursor=pointer]\n    - button \"Comments\" [ref=e97] [cursor=pointer]\n    - button \"History\" [ref=e100] [cursor=pointer]\n    - button \"Shape actions\" [ref=e105] [cursor=pointer]\n    - button \"Insert\" [ref=e107] [cursor=pointer]"
}
```

### Tool call: browser_evaluate
- Args
```json
{
  "function": "() => { const e=document.querySelector('[role=\"group\"][aria-label=\"View\"]'); const s=e&&getComputedStyle(e); return {found:!!e,bg:s?.backgroundColor,bgImage:s?.backgroundImage,borders:s?{top:[s.borderTopWidth,s.borderTopColor,s.borderTopStyle],right:[s.borderRightWidth,s.borderRightColor,s.borderRightStyle],bottom:[s.borderBottomWidth,s.borderBottomColor,s.borderBottomStyle],left:[s.borderLeftWidth,s.borderLeftColor,s.borderLeftStyle]}:null,box:e?.getBoundingClientRect().toJSON()};}"
}
```
- Result
```json
{
  "result": "{\n  \"found\": true,\n  \"bg\": \"rgb(251, 248, 241)\",\n  \"bgImage\": \"none\",\n  \"borders\": {\n    \"top\": [\n      \"1px\",\n      \"rgb(221, 210, 187)\",\n      \"solid\"\n    ],\n    \"right\": [\n      \"1px\",\n      \"rgb(221, 210, 187)\",\n      \"solid\"\n    ],\n    \"bottom\": [\n      \"1px\",\n      \"rgb(221, 210, 187)\",\n      \"solid\"\n    ],\n    \"left\": [\n      \"1px\",\n      \"rgb(221, 210, 187)\",\n      \"solid\"\n    ]\n  },\n  \"box\": {\n    \"x\": 79.5,\n    \"y\": 646,\n    \"width\": 285,\n    \"height\": 52,\n    \"top\": 646,\n    \"right\": 364.5,\n    \"bottom\": 698,\n    \"left\": 79.5\n  }\n}"
}
```

### Tool call: browser_take_screenshot
- Args
```json
{
  "element": "View controls above page strip",
  "target": "[role=\"group\"][aria-label=\"View\"]",
  "type": "png",
  "scale": "css"
}
```
- Result
```json
{
  "result": "- [Screenshot of View controls above page strip](evidence/touch/element-2026-11-01T14-53-40-150Z.png)",
  "attachments": [
    {
      "type": "image",
      "data": "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",
      "mimeType": "image/png"
    }
  ]
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
  "result": "- [Screenshot of viewport](evidence/touch/page-2026-11-01T14-55-32-969Z.png)",
  "attachments": [
    {
      "type": "image",
      "data": "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",
      "mimeType": "image/png"
    }
  ]
}
```
