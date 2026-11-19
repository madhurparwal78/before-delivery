
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
      "value": "judge-owner-qa1101a@example.com"
    },
    {
      "target": "e12",
      "name": "Password",
      "type": "textbox",
      "value": "judge-pass-qa1101a"
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
  "snapshot": "- main [ref=e16]:\n  - heading \"Your diagrams\" [level=1] [ref=e17]\n  - generic [ref=e18]:\n    - generic [ref=e19]:\n      - text: Title\n      - textbox \"Title\" [ref=e20]\n    - button \"New diagram\" [ref=e21] [cursor=pointer]\n  - list [ref=e22]:\n    - listitem [ref=e23]:\n      - link \"Judge Map qa1101a\" [ref=e24] [cursor=pointer]:\n        - /url: /d/d_00hnragwhsqe"
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
  "page": "- Page URL: http://127.0.0.1:4173/\n- Page Title: Linewell",
  "inlineSnapshot": "- main [ref=e16]:\n  - heading \"Your diagrams\" [level=1] [ref=e17]\n  - generic [ref=e18]:\n    - generic [ref=e19]:\n      - text: Title\n      - textbox \"Title\" [ref=e20]\n    - button \"New diagram\" [ref=e21] [cursor=pointer]\n  - list [ref=e22]:\n    - listitem [ref=e23]:\n      - link \"Judge Map qa1101a\" [ref=e24] [cursor=pointer]:\n        - /url: /d/d_00hnragwhsqe"
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
  "page": "- Page URL: http://127.0.0.1:4173/d/d_00hnragwhsqe?page=p_00hnragwhtnm\n- Page Title: Linewell",
  "snapshot": "- generic [ref=e25]:\n  - banner [ref=e27]:\n    - heading \"Judge Map qa1101a\" [level=1] [ref=e28]\n    - button \"Judge Peer qa1101a, editing\" [ref=e30] [cursor=pointer]: JQ\n    - generic [ref=e31]:\n      - button \"Share\" [ref=e32] [cursor=pointer]\n      - button \"Export\" [ref=e36] [cursor=pointer]\n      - button \"Outline\" [ref=e40] [cursor=pointer]\n  - generic:\n    - generic:\n      - status \"Connection\"\n  - generic [ref=e43]:\n    - generic [ref=e44]:\n      - img \"Page 1 canvas\" [ref=e46]:\n        - generic [ref=e49]:\n          - generic \"Start\" [ref=e50]\n          - generic \"Check\" [ref=e53]\n          - generic \"Connector from Start to Check\"\n      - group \"View\" [ref=e56]:\n        - button \"Zoom out\" [ref=e57] [cursor=pointer]\n        - status \"Zoom\" [ref=e61]: 100%\n        - button \"Zoom in\" [ref=e62] [cursor=pointer]\n        - button \"Reset zoom\" [ref=e66] [cursor=pointer]\n        - button \"Layers\" [ref=e72] [cursor=pointer]\n        - button \"Toggle inspector\" [expanded] [ref=e76] [cursor=pointer]\n    - generic [ref=e80]:\n      - button \"Previous page\" [ref=e81] [cursor=pointer]\n      - generic [ref=e84]: Page 1 · 1 of 1\n      - button \"Next page\" [ref=e85] [cursor=pointer]\n  - navigation [ref=e89]:\n    - button \"Layers\" [ref=e90] [cursor=pointer]\n    - button \"Inspector\" [ref=e94] [cursor=pointer]\n    - button \"Comments\" [ref=e97] [cursor=pointer]\n    - button \"History\" [ref=e100] [cursor=pointer]\n    - button \"Shape actions\" [ref=e105] [cursor=pointer]\n    - button \"Insert\" [ref=e107] [cursor=pointer]"
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
  "page": "- Page URL: http://127.0.0.1:4173/d/d_00hnragwhsqe?page=p_00hnragwhtnm\n- Page Title: Linewell",
  "inlineSnapshot": "- generic [ref=e25]:\n  - banner [ref=e27]:\n    - heading \"Judge Map qa1101a\" [level=1] [ref=e28]\n    - button \"Judge Peer qa1101a, editing\" [ref=e30] [cursor=pointer]: JQ\n    - generic [ref=e31]:\n      - button \"Share\" [ref=e32] [cursor=pointer]\n      - button \"Export\" [ref=e36] [cursor=pointer]\n      - button \"Outline\" [ref=e40] [cursor=pointer]\n  - generic:\n    - generic:\n      - status \"Connection\"\n  - generic [ref=e43]:\n    - generic [ref=e44]:\n      - img \"Page 1 canvas\" [ref=e46]:\n        - generic [ref=e49]:\n          - generic \"Start\" [ref=e50]\n          - generic \"Check\" [ref=e53]\n          - generic \"Connector from Start to Check\"\n      - group \"View\" [ref=e56]:\n        - button \"Zoom out\" [ref=e57] [cursor=pointer]\n        - status \"Zoom\" [ref=e61]: 100%\n        - button \"Zoom in\" [ref=e62] [cursor=pointer]\n        - button \"Reset zoom\" [ref=e66] [cursor=pointer]\n        - button \"Layers\" [ref=e72] [cursor=pointer]\n        - button \"Toggle inspector\" [expanded] [ref=e76] [cursor=pointer]\n    - generic [ref=e80]:\n      - button \"Previous page\" [ref=e81] [cursor=pointer]\n      - generic [ref=e84]: Page 1 · 1 of 1\n      - button \"Next page\" [ref=e85] [cursor=pointer]\n  - navigation [ref=e89]:\n    - button \"Layers\" [ref=e90] [cursor=pointer]\n    - button \"Inspector\" [ref=e94] [cursor=pointer]\n    - button \"Comments\" [ref=e97] [cursor=pointer]\n    - button \"History\" [ref=e100] [cursor=pointer]\n    - button \"Shape actions\" [ref=e105] [cursor=pointer]\n    - button \"Insert\" [ref=e107] [cursor=pointer]"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Layers view control",
  "target": "e72"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/d/d_00hnragwhsqe?page=p_00hnragwhtnm\n- Page Title: Linewell",
  "snapshot": "- generic [ref=e25]:\n  - banner [ref=e109]:\n    - heading \"Judge Map qa1101a\" [level=1] [ref=e110]\n    - button \"Judge Peer qa1101a, editing\" [ref=e112] [cursor=pointer]: JQ\n    - generic [ref=e113]:\n      - button \"Share\" [ref=e114] [cursor=pointer]\n      - button \"Export\" [ref=e118] [cursor=pointer]\n      - button \"Outline\" [ref=e122] [cursor=pointer]\n  - generic:\n    - generic:\n      - status \"Connection\"\n  - generic [ref=e43]:\n    - generic [ref=e44]:\n      - img \"Page 1 canvas\" [ref=e124]:\n        - generic [ref=e127]:\n          - generic \"Start\" [ref=e128]\n          - generic \"Check\" [ref=e131]\n          - generic \"Connector from Start to Check\"\n      - group \"View\" [ref=e134]:\n        - button \"Zoom out\" [ref=e135] [cursor=pointer]\n        - status \"Zoom\" [ref=e139]: 100%\n        - button \"Zoom in\" [ref=e140] [cursor=pointer]\n        - button \"Reset zoom\" [ref=e144] [cursor=pointer]\n        - button \"Layers\" [expanded] [active] [ref=e150] [cursor=pointer]\n        - button \"Toggle inspector\" [expanded] [ref=e154] [cursor=pointer]\n    - generic [ref=e157]:\n      - button \"Previous page\" [ref=e158] [cursor=pointer]\n      - generic [ref=e161]: Page 1 · 1 of 1\n      - button \"Next page\" [ref=e162] [cursor=pointer]\n  - navigation [ref=e165]:\n    - button \"Layers\" [ref=e166] [cursor=pointer]\n    - button \"Inspector\" [ref=e170] [cursor=pointer]\n    - button \"Comments\" [ref=e173] [cursor=pointer]\n    - button \"History\" [ref=e176] [cursor=pointer]\n    - button \"Shape actions\" [ref=e181] [cursor=pointer]\n    - button \"Insert\" [ref=e183] [cursor=pointer]"
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

### Tool call: browser_evaluate
- Args
```json
{
  "function": "() => {const e=document.querySelector('[aria-label=\"View\"]'),s=getComputedStyle(e);return {bg:s.backgroundColor,borderTop:[s.borderTopWidth,s.borderTopColor],borderRight:[s.borderRightWidth,s.borderRightColor],borderBottom:[s.borderBottomWidth,s.borderBottomColor],borderLeft:[s.borderLeftWidth,s.borderLeftColor],box:e.getBoundingClientRect().toJSON()}}"
}
```
- Result
```json
{
  "result": "{\n  \"bg\": \"rgb(251, 248, 241)\",\n  \"borderTop\": [\n    \"1px\",\n    \"rgb(221, 210, 187)\"\n  ],\n  \"borderRight\": [\n    \"1px\",\n    \"rgb(221, 210, 187)\"\n  ],\n  \"borderBottom\": [\n    \"1px\",\n    \"rgb(221, 210, 187)\"\n  ],\n  \"borderLeft\": [\n    \"1px\",\n    \"rgb(221, 210, 187)\"\n  ],\n  \"box\": {\n    \"x\": 79.609375,\n    \"y\": 646,\n    \"width\": 285,\n    \"height\": 52,\n    \"top\": 646,\n    \"right\": 364.609375,\n    \"bottom\": 698,\n    \"left\": 79.609375\n  }\n}"
}
```

### Tool call: browser_take_screenshot
- Args
```json
{
  "element": "view controls and canvas bottom",
  "target": "[aria-label='View']",
  "scale": "css"
}
```
- Result
```json
{
  "result": "- [Screenshot of view controls and canvas bottom](evidence/touch/element-2026-11-01T14-36-24-909Z.png)",
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
  "fullPage": false,
  "scale": "css"
}
```
- Result
```json
{
  "result": "- [Screenshot of viewport](evidence/touch/page-2026-11-01T14-38-05-692Z.png)",
  "attachments": [
    {
      "type": "image",
      "data": "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",
      "mimeType": "image/png"
    }
  ]
}
```
