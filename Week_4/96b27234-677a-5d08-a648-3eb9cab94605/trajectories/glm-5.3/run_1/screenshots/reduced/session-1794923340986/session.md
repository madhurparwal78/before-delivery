
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
  "page": "- Page URL: http://127.0.0.1:4173/signin\n- Page Title: Hearthtile\n- Console: 1 errors, 0 warnings",
  "snapshot": "- main [ref=e3]:\n  - heading \"Sign in\" [level=1] [ref=e4]\n  - generic [ref=e5]:\n    - textbox \"Email\" [ref=e6]\n    - generic [ref=e7]:\n      - text: Password\n      - textbox \"Password\" [ref=e8]\n    - button \"Sign in\" [ref=e9] [cursor=pointer]\n    - status \"Account result\" [ref=e10]",
  "events": "- New console entries: evidence/reduced/console-2026-11-17T13-50-38-028Z.log#L1"
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
  "page": "- Page URL: http://127.0.0.1:4173/signin\n- Page Title: Hearthtile\n- Console: 1 errors, 0 warnings",
  "inlineSnapshot": "- main [ref=e3]:\n  - heading \"Sign in\" [level=1] [ref=e4]\n  - generic [ref=e5]:\n    - textbox \"Email\" [ref=e6]\n    - generic [ref=e7]:\n      - text: Password\n      - textbox \"Password\" [ref=e8]\n    - button \"Sign in\" [ref=e9] [cursor=pointer]\n    - status \"Account result\" [ref=e10]",
  "events": "- New console entries: evidence/reduced/console-2026-11-17T13-50-38-028Z.log#L2"
}
```

### Tool call: browser_fill_form
- Args
```json
{
  "fields": [
    {
      "target": "e6",
      "name": "Email",
      "type": "textbox",
      "value": "wren@hearthtile.example"
    },
    {
      "target": "e8",
      "name": "Password",
      "type": "textbox",
      "value": "lantern-wren-01"
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
  "target": "e9"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/sessions\n- Page Title: Hearthtile",
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
  "page": "- Page URL: http://127.0.0.1:4173/sessions\n- Page Title: Hearthtile",
  "inlineSnapshot": "- generic [ref=f1e2]:\n  - navigation \"Main\" [ref=f1e3]:\n    - link \"Sessions\" [ref=f1e4] [cursor=pointer]:\n      - /url: /sessions\n    - link \"Friends\" [ref=f1e5] [cursor=pointer]:\n      - /url: /friends\n    - link \"Studio\" [ref=f1e6] [cursor=pointer]:\n      - /url: /studio\n    - link \"Communities\" [ref=f1e7] [cursor=pointer]:\n      - /url: /communities\n    - button \"Sign out\" [ref=f1e8] [cursor=pointer]\n  - main [ref=f1e9]:\n    - heading \"Sessions\" [level=1] [ref=f1e10]\n    - generic [ref=f1e11]:\n      - searchbox \"Search sessions\" [ref=f1e12]\n      - status \"Session count\" [ref=f1e13]: \"1\"\n      - list \"Sessions\" [ref=f1e14]:\n        - listitem [ref=f1e15]\n      - list \"Friends' sessions\" [ref=f1e17]:\n        - listitem [ref=f1e18]\n    - generic [ref=f1e20]:\n      - heading \"Your avatar\" [level=2] [ref=f1e21]\n      - combobox \"Wear avatar\" [ref=f1e22]:\n        - option \"None\"\n        - option \"Paper Fox\" [selected]\n        - option \"Tin Heron\"\n        - option \"Moss Walker\"\n    - button \"Open a session\" [ref=f1e24] [cursor=pointer]\n    - alert [ref=f1e25]"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Join Quilt Loft",
  "target": "f1e16"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/sessions/QqsLQgzwS69JVzQ3\n- Page Title: Hearthtile",
  "snapshot": ""
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
  "page": "- Page URL: http://127.0.0.1:4173/sessions/QqsLQgzwS69JVzQ3\n- Page Title: Hearthtile",
  "inlineSnapshot": "- generic [ref=f2e2]:\n  - navigation \"Main\" [ref=f2e3]:\n    - link \"Sessions\" [ref=f2e4] [cursor=pointer]:\n      - /url: /sessions\n    - link \"Friends\" [ref=f2e5] [cursor=pointer]:\n      - /url: /friends\n    - link \"Studio\" [ref=f2e6] [cursor=pointer]:\n      - /url: /studio\n    - link \"Communities\" [ref=f2e7] [cursor=pointer]:\n      - /url: /communities\n    - button \"Sign out\" [ref=f2e8] [cursor=pointer]\n  - main [ref=f2e9]:\n    - heading \"Quilt Loft\" [level=1] [ref=f2e10]\n    - region \"Room\" [ref=f2e11]:\n      - paragraph [ref=f2e12]: Room version 1\n      - status \"Room announcements\" [ref=f2e13]\n      - generic [ref=f2e14]:\n        - generic [ref=f2e15]:\n          - img \"Room view\" [ref=f2e16]\n          - generic [ref=f2e17]\n          - combobox \"Hide avatars above\" [ref=f2e23]\n          - button \"Leave session\" [ref=f2e24] [cursor=pointer]\n        - generic [ref=f2e25]:\n          - heading \"People here\" [level=2] [ref=f2e26]\n          - list \"People here\" [ref=f2e27]\n          - heading \"Room features\" [level=2] [ref=f2e34]\n          - list \"Room features\" [ref=f2e35]\n        - generic [ref=f2e38]:\n          - heading \"Nearby chat\" [level=2] [ref=f2e39]\n          - log \"Nearby chat\" [ref=f2e40]\n          - textbox \"Say something nearby\" [ref=f2e43]\n          - button \"Send\" [ref=f2e44] [cursor=pointer]\n          - status \"Chat result\" [ref=f2e45]\n      - status \"Safety result\" [ref=f2e46]\n      - alert [ref=f2e47]"
}
```

### Tool call: browser_evaluate
- Args
```json
{
  "function": "() => window.__JUDGE_HOLD_TIMERS__('hold')"
}
```
- Result
```json
{
  "result": "\"holding\""
}
```

### Tool call: browser_type
- Args
```json
{
  "element": "Say something nearby",
  "target": "f2e43",
  "text": "ripple-check-qa-135059",
  "submit": true
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/sessions/QqsLQgzwS69JVzQ3\n- Page Title: Hearthtile",
  "snapshot": "- generic [ref=f2e2]:\n  - navigation \"Main\" [ref=f2e3]:\n    - link \"Sessions\" [ref=f2e4] [cursor=pointer]:\n      - /url: /sessions\n    - link \"Friends\" [ref=f2e5] [cursor=pointer]:\n      - /url: /friends\n    - link \"Studio\" [ref=f2e6] [cursor=pointer]:\n      - /url: /studio\n    - link \"Communities\" [ref=f2e7] [cursor=pointer]:\n      - /url: /communities\n    - button \"Sign out\" [ref=f2e8] [cursor=pointer]\n  - main [ref=f2e9]:\n    - heading \"Quilt Loft\" [level=1] [ref=f2e10]\n    - region \"Room\" [ref=f2e11]:\n      - paragraph [ref=f2e12]: Room version 1\n      - status \"Room announcements\" [ref=f2e13]\n      - generic [ref=f2e14]:\n        - generic [ref=f2e15]:\n          - img \"Room view\" [ref=f2e16]\n          - generic [ref=f2e17]:\n            - button \"Step north\" [ref=f2e18] [cursor=pointer]: north\n            - button \"Step east\" [ref=f2e19] [cursor=pointer]: east\n            - button \"Step south\" [ref=f2e20] [cursor=pointer]: south\n            - button \"Step west\" [ref=f2e21] [cursor=pointer]: west\n            - button \"Sit or stand\" [ref=f2e22] [cursor=pointer]\n          - combobox \"Hide avatars above\" [ref=f2e23]:\n            - option \"Show all\" [selected]\n            - option \"Feather\"\n            - option \"Linen\"\n            - option \"Cedar\"\n            - option \"Granite\"\n          - button \"Leave session\" [ref=f2e24] [cursor=pointer]\n        - generic [ref=f2e25]:\n          - heading \"People here\" [level=2] [ref=f2e26]\n          - list \"People here\" [ref=f2e27]:\n            - listitem [ref=f2e28]:\n              - text: Imke Dorn (6,5)\n              - button \"Actions for Imke Dorn\" [ref=f2e29] [cursor=pointer]\n            - listitem [ref=f2e30]:\n              - text: Tomas Vale (4,3)\n              - button \"Actions for Tomas Vale\" [ref=f2e31] [cursor=pointer]\n            - listitem [ref=f2e32]:\n              - text: Wren Okafor (1,1)\n              - button \"Actions for Wren Okafor\" [ref=f2e33] [cursor=pointer]\n          - heading \"Room features\" [level=2] [ref=f2e34]\n          - list \"Room features\" [ref=f2e35]:\n            - listitem [ref=f2e36]: seat at (5,2)\n            - listitem [ref=f2e37]: exit at (0,6)\n        - generic [ref=f2e38]:\n          - heading \"Nearby chat\" [level=2] [ref=f2e39]\n          - log \"Nearby chat\" [ref=f2e40]:\n            - generic [ref=f2e41]: \"Wren Okafor: ripple-check-qa-171735\"\n            - generic [ref=f2e42]: \"Wren Okafor: ripple-check-qa-1744\"\n            - generic [ref=f2e48]: \"Wren Okafor: ripple-check-qa-135059\"\n          - textbox \"Say something nearby\" [active] [ref=f2e43]\n          - button \"Send\" [ref=f2e44] [cursor=pointer]\n          - status \"Chat result\" [ref=f2e45]: Heard by 2.\n      - status \"Safety result\" [ref=f2e46]\n      - alert [ref=f2e47]"
}
```

### Tool call: browser_evaluate
- Args
```json
{
  "function": "() => { const r=document.querySelector('[aria-label=\"Room\"]'); return {ripple:r?.getAttribute('data-ripple'),radius:r?.getAttribute('data-ripple-radius')}; }"
}
```
- Result
```json
{
  "result": "{\n  \"ripple\": \"outline\",\n  \"radius\": \"6\"\n}"
}
```

### Tool call: browser_take_screenshot
- Args
```json
{
  "element": "canvas",
  "target": "f2e16",
  "scale": "css"
}
```
- Result
```json
{
  "result": "- [Screenshot of canvas](evidence/reduced/element-2026-11-17T13-51-10-652Z.png)",
  "attachments": [
    {
      "type": "image",
      "data": "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",
      "mimeType": "image/png"
    }
  ]
}
```

### Tool call: browser_evaluate
- Args
```json
{
  "function": "() => window.__JUDGE_HOLD_TIMERS__('release')"
}
```
- Result
```json
{
  "result": "\"released 1\""
}
```
