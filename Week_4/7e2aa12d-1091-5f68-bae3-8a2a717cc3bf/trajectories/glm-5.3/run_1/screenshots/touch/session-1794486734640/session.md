
### Tool call: browser_navigate
- Args
```json
{
  "url": "http://127.0.0.1:4173/signup"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/signup\n- Page Title: Create your account — Mullion",
  "snapshot": "- generic [ref=e3]:\n  - heading \"Create your account\" [level=1] [ref=e4]\n  - generic [ref=e5]:\n    - generic [ref=e6]:\n      - text: Username\n      - textbox \"Username\" [active] [ref=e7]\n    - generic [ref=e8]:\n      - text: Password\n      - textbox \"Password\" [ref=e9]\n    - button \"Create account\" [ref=e10] [cursor=pointer]\n    - link \"Sign in\" [ref=e11] [cursor=pointer]:\n      - /url: /signin"
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
  "page": "- Page URL: http://127.0.0.1:4173/signup\n- Page Title: Create your account — Mullion",
  "inlineSnapshot": "- generic [ref=e3]:\n  - heading \"Create your account\" [level=1] [ref=e4]\n  - generic [ref=e5]:\n    - generic [ref=e6]:\n      - text: Username\n      - textbox \"Username\" [active] [ref=e7]\n    - generic [ref=e8]:\n      - text: Password\n      - textbox \"Password\" [ref=e9]\n    - button \"Create account\" [ref=e10] [cursor=pointer]\n    - link \"Sign in\" [ref=e11] [cursor=pointer]:\n      - /url: /signin"
}
```

### Tool call: browser_fill_form
- Args
```json
{
  "fields": [
    {
      "target": "e7",
      "name": "Username",
      "type": "textbox",
      "value": "qa-fqrdxs"
    },
    {
      "target": "e9",
      "name": "Password",
      "type": "textbox",
      "value": "drafting-01"
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
  "element": "Create account",
  "target": "e10"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/\n- Page Title: Mullion",
  "snapshot": ""
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "New layout",
  "target": "button:has-text('New layout')"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/\n- Page Title: Your layouts — Mullion",
  "snapshot": "- generic [ref=f1e1]:\n  - generic [ref=f1e3]:\n    - generic [ref=f1e4]:\n      - generic [ref=f1e5]: Mullion\n      - button \"Sign out\" [ref=f1e6] [cursor=pointer]\n    - generic [ref=f1e7]:\n      - heading \"Your layouts\" [level=1] [ref=f1e8]\n      - button \"New layout\" [active] [ref=f1e9] [cursor=pointer]\n    - paragraph [ref=f1e10]: No layouts yet.\n  - dialog \"New layout\" [ref=f1e12]:\n    - heading \"New layout\" [level=2] [ref=f1e13]\n    - generic [ref=f1e14]:\n      - generic [ref=f1e15]:\n        - text: Layout name\n        - textbox \"Layout name\" [ref=f1e16]\n      - radiogroup \"Starter template\" [ref=f1e17]:\n        - generic [ref=f1e18]:\n          - radio \"Blank\" [checked] [ref=f1e19]\n          - text: Blank\n        - generic [ref=f1e20]:\n          - radio \"Holy Grail\" [ref=f1e21]\n          - text: Holy Grail\n        - generic [ref=f1e22]:\n          - radio \"Dashboard Shell\" [ref=f1e23]\n          - text: Dashboard Shell\n        - generic [ref=f1e24]:\n          - radio \"Magazine Spread\" [ref=f1e25]\n          - text: Magazine Spread\n      - generic [ref=f1e26]:\n        - button \"Create layout\" [ref=f1e27] [cursor=pointer]\n        - button \"Cancel\" [ref=f1e28] [cursor=pointer]"
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
  "page": "- Page URL: http://127.0.0.1:4173/\n- Page Title: Your layouts — Mullion",
  "inlineSnapshot": "- generic [ref=f1e1]:\n  - generic [ref=f1e3]:\n    - generic [ref=f1e4]:\n      - generic [ref=f1e5]: Mullion\n      - button \"Sign out\" [ref=f1e6] [cursor=pointer]\n    - generic [ref=f1e7]:\n      - heading \"Your layouts\" [level=1] [ref=f1e8]\n      - button \"New layout\" [active] [ref=f1e9] [cursor=pointer]\n    - paragraph [ref=f1e10]: No layouts yet.\n  - dialog \"New layout\" [ref=f1e12]:\n    - heading \"New layout\" [level=2] [ref=f1e13]\n    - generic [ref=f1e14]:\n      - generic [ref=f1e15]:\n        - text: Layout name\n        - textbox \"Layout name\" [ref=f1e16]\n      - radiogroup \"Starter template\" [ref=f1e17]:\n        - generic [ref=f1e18]\n        - generic [ref=f1e20]\n        - generic [ref=f1e22]\n        - generic [ref=f1e24]\n      - generic [ref=f1e26]:\n        - button \"Create layout\" [ref=f1e27] [cursor=pointer]\n        - button \"Cancel\" [ref=f1e28] [cursor=pointer]"
}
```

### Tool call: browser_fill_form
- Args
```json
{
  "fields": [
    {
      "target": "f1e16",
      "name": "Layout name",
      "type": "textbox",
      "value": "DS fqrdxs"
    },
    {
      "target": "input[value='dashboard-shell']",
      "name": "Dashboard Shell",
      "type": "radio",
      "value": "true"
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
  "element": "Create layout",
  "target": "f1e27"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/layouts/lay_62oCIF31qY6skzeD\n- Page Title: Mullion",
  "snapshot": ""
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
  "page": "- Page URL: http://127.0.0.1:4173/layouts/lay_62oCIF31qY6skzeD\n- Page Title: DS fqrdxs — Mullion",
  "inlineSnapshot": "- generic [ref=f2e2]:\n  - generic [ref=f2e3]:\n    - generic [ref=f2e4]:\n      - link \"Your layouts\" [ref=f2e5] [cursor=pointer]:\n        - /url: /\n      - heading \"DS fqrdxs\" [level=1] [ref=f2e6]\n      - status \"Save state\" [ref=f2e7]: All changes saved.\n      - button \"Save version\" [ref=f2e8] [cursor=pointer]\n      - button \"Versions\" [ref=f2e9] [cursor=pointer]\n      - button \"Share\" [ref=f2e10] [cursor=pointer]\n    - status \"Layout updates\" [ref=f2e12]: Showing From 1024px at 1280px.\n    - generic [ref=f2e14]:\n      - generic [ref=f2e15]:\n        - generic [ref=f2e16]\n        - generic [ref=f2e29]\n      - generic [ref=f2e38]:\n        - grid \"Layout grid\" [ref=f2e39]\n        - generic [ref=f2e44]: top\n        - generic [ref=f2e45]: side\n        - generic [ref=f2e46]: content\n  - tablist \"Editor panes\" [ref=f2e47]:\n    - tab \"Grid\" [selected] [ref=f2e48] [cursor=pointer]\n    - tab \"Tracks\" [ref=f2e49] [cursor=pointer]\n    - tab \"Preview\" [ref=f2e50] [cursor=pointer]\n    - tab \"Code\" [ref=f2e51] [cursor=pointer]"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Grid tab",
  "target": "f2e48"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/layouts/lay_62oCIF31qY6skzeD\n- Page Title: DS fqrdxs — Mullion",
  "snapshot": "- generic [ref=f2e2]:\n  - generic [ref=f2e3]:\n    - generic [ref=f2e4]:\n      - link \"Your layouts\" [ref=f2e5] [cursor=pointer]:\n        - /url: /\n      - heading \"DS fqrdxs\" [level=1] [ref=f2e6]\n      - status \"Save state\" [ref=f2e7]: All changes saved.\n      - button \"Save version\" [ref=f2e8] [cursor=pointer]\n      - button \"Versions\" [ref=f2e9] [cursor=pointer]\n      - button \"Share\" [ref=f2e10] [cursor=pointer]\n    - status \"Layout updates\" [ref=f2e12]: Showing From 1024px at 1280px.\n    - generic [ref=f2e14]:\n      - generic [ref=f2e15]:\n        - generic [ref=f2e16]:\n          - columnheader \"Column 1\" [ref=f2e17]:\n            - textbox \"Column 1 size\" [ref=f2e19]: 240px\n            - separator \"Resize column 1\" [ref=f2e20]\n            - button \"Remove column 1\" [ref=f2e21] [cursor=pointer]: ×\n            - generic [ref=f2e22]: 0px\n          - columnheader \"Column 2\" [ref=f2e23]:\n            - textbox \"Column 2 size\" [ref=f2e25]: 1fr\n            - separator \"Resize column 2\" [ref=f2e26]\n            - button \"Remove column 2\" [ref=f2e27] [cursor=pointer]: ×\n            - generic [ref=f2e28]: 0px\n        - generic [ref=f2e29]:\n          - rowheader \"Row 1\" [ref=f2e30]:\n            - textbox \"Row 1 size\" [ref=f2e32]: 56px\n            - separator \"Resize row 1\"\n            - button \"Remove row 1\" [ref=f2e33] [cursor=pointer]: ×\n          - rowheader \"Row 2\" [ref=f2e34]:\n            - textbox \"Row 2 size\" [ref=f2e36]: 1fr\n            - separator \"Resize row 2\"\n            - button \"Remove row 2\" [ref=f2e37] [cursor=pointer]: ×\n      - generic [ref=f2e38]:\n        - grid \"Layout grid\" [ref=f2e39]:\n          - gridcell \"Row 1, column 1, top\" [selected] [ref=f2e40]\n          - gridcell \"Row 1, column 2, top\" [ref=f2e41]\n          - gridcell \"Row 2, column 1, side\" [ref=f2e42]\n          - gridcell \"Row 2, column 2, content\" [ref=f2e43]\n        - generic [ref=f2e44]: top\n        - generic [ref=f2e45]: side\n        - generic [ref=f2e46]: content\n  - tablist \"Editor panes\" [ref=f2e47]:\n    - tab \"Grid\" [active] [selected] [ref=f2e48] [cursor=pointer]\n    - tab \"Tracks\" [ref=f2e49] [cursor=pointer]\n    - tab \"Preview\" [ref=f2e50] [cursor=pointer]\n    - tab \"Code\" [ref=f2e51] [cursor=pointer]"
}
```

### Tool call: browser_take_screenshot
- Args
```json
{
  "type": "png",
  "fullPage": true,
  "scale": "css"
}
```
- Result
```json
{
  "result": "- [Screenshot of full page](evidence/touch/page-2026-11-12T12-33-14-249Z.png)",
  "attachments": [
    {
      "type": "image",
      "data": "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QgBQRCEAKKIQABRRCACKKAQARRQCgCIKAUARhQCgiEIAUEQhACiiEAAUUQgAiigEAEUUAoAiCgFAEYUAoIhCAFBEIQAoohAAFFEIAIooBABFFAKAIgoBQBGFAKCIQgBQRCEAKKIQABRRCACKKAQARRQCgCIKAUARhQCgiEIAUEQhACiiEAAUUQgAiigEAEUUAoAiCgFAEYUAoIhCAFBEIQAoohAAFFEIAIooBABFFAKAIgoBQBGFAKCIQgBQRCEAKKIQABRRCACKKAQARRQCgCIKAUARhQCgiEIAUEQhACiiEAAUUQgAiigEAEUUAoAiCgFAEYUAoIhCAFBEIQAoohAAFFEIAIooBABFFAKAIgoBQBGFAKCIQgBQRCEAKKIQABRRCACKKAQARRQCgCIKAUARhQCgiEIAUEQhACiiEAAUUQgAiigEAEUUAoAiCgFAEYUAoIhCAFBEIQAoohAAFFEIAIooBABFFAKAIgoBQBGFAKCIQgBQRCEAKKIQABRRCACKKAQARRQCgCIKAUARhQCgiEIAUEQhACiiEAAUUQgAiigEAEUUAoAiCgFAEYUAoIhCAFBEIQAoohAAFFEIAIooBABFFAKAIgoBQBGFAKCIQgBQRCEAKKIQABRRCACKKAQARRQCgCIKAUARhQCgiEIAUEQhACiiEAAUUQgAiigEAEUUAoAiCgFAEYUAoIhCAFBEIQAoohAAFFEIAIooBABFFAKAIgoBQBGFAKCIQgBQRCEAKKIQABRRCACKKAQARRQCgCIKAUARhQCgiEIAUEQhACiiEAAUUQgAiigEAEUUAoAiCgFAEYUAoIhCAFBEIQAoohAAFFEIAIooBABFFAKAIgoBQBGFAKCIQgBQRCEAKKIQABRRCACKKAQARRQCgCIKAUARhQCgiEIAUEQhACiiEAAUUQgAiigEAEUUAoAiCgFAEYUAoIhCAFBEIQAoohAAFFEIAIooBABFFAKAIgoBQBGFAKCIQgBQRCEAKKIQABRRCACKKAQARRQCgCIKAbcOO3kAAAzNSURBVEARhQCgiEIAUEQhACiiEAAUUQgAiigEAEUUAoAiCgFAEYUAoIhCAFBEIQAoohAAFFEIAIooBABFFAKAIgoBQBGFAKCIQgBQRCEAKKIQABRRCACKKAQARRQCgCIKAUARhQCgiEIAUEQhACiiEAAUUQgAiigEAEUU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",
      "mimeType": "image/png"
    }
  ]
}
```

### Tool call: browser_evaluate
- Args
```json
{
  "function": "() => {const es=[...document.querySelectorAll('[data-area-name]')];return es.map(e=>({name:e.getAttribute('data-area-name'),text:e.textContent,background:getComputedStyle(e).backgroundColor,color:getComputedStyle(e).color}))}"
}
```
- Result
```json
{
  "result": "[\n  {\n    \"name\": \"top\",\n    \"text\": \"top\",\n    \"background\": \"rgb(220, 232, 243)\",\n    \"color\": \"rgb(34, 32, 28)\"\n  },\n  {\n    \"name\": \"side\",\n    \"text\": \"side\",\n    \"background\": \"rgb(220, 232, 243)\",\n    \"color\": \"rgb(34, 32, 28)\"\n  },\n  {\n    \"name\": \"content\",\n    \"text\": \"content\",\n    \"background\": \"rgb(220, 232, 243)\",\n    \"color\": \"rgb(34, 32, 28)\"\n  }\n]"
}
```
