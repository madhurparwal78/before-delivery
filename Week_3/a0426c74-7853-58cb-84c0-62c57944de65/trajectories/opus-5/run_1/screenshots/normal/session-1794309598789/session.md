
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
  "url": "http://127.0.0.1:4173/register"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/register\n- Page Title: Plotfold",
  "snapshot": "- main [ref=e3]:\n  - generic [ref=e4]:\n    - heading \"Start drawing\" [level=1] [ref=e5]\n    - generic [ref=e6]: Username\n    - textbox \"Username\" [active] [ref=e7]\n    - generic [ref=e8]: Password\n    - textbox \"Password\" [ref=e9]\n    - button \"Create account\" [ref=e10] [cursor=pointer]"
}
```

### Tool call: browser_snapshot
- Args
```json
{}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/register\n- Page Title: Plotfold",
  "inlineSnapshot": "- main [ref=e3]:\n  - generic [ref=e4]:\n    - heading \"Start drawing\" [level=1] [ref=e5]\n    - generic [ref=e6]: Username\n    - textbox \"Username\" [active] [ref=e7]\n    - generic [ref=e8]: Password\n    - textbox \"Password\" [ref=e9]\n    - button \"Create account\" [ref=e10] [cursor=pointer]"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Create account empty",
  "target": "e10"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/register\n- Page Title: Plotfold",
  "snapshot": "- main [ref=e3]:\n  - generic [ref=e4]:\n    - heading \"Start drawing\" [level=1] [ref=e5]\n    - generic [ref=e6]: Username\n    - textbox \"Username\" [ref=e7]\n    - generic [ref=e8]: Password\n    - textbox \"Password\" [ref=e9]\n    - button \"Create account\" [active] [ref=e10] [cursor=pointer]"
}
```

### Tool call: browser_snapshot
- Args
```json
{}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/register\n- Page Title: Plotfold",
  "inlineSnapshot": "- main [ref=e3]:\n  - generic [ref=e4]:\n    - heading \"Start drawing\" [level=1] [ref=e5]\n    - generic [ref=e6]: Username\n    - textbox \"Username\" [ref=e7]\n    - generic [ref=e8]: Password\n    - textbox \"Password\" [ref=e9]\n    - button \"Create account\" [active] [ref=e10] [cursor=pointer]"
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
      "value": "Ab"
    },
    {
      "target": "e9",
      "name": "Password",
      "type": "textbox",
      "value": "abc"
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
  "element": "Create account with invalid credentials",
  "target": "e10"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/register\n- Page Title: Plotfold",
  "snapshot": "- main [ref=e3]:\n  - generic [ref=e4]:\n    - heading \"Start drawing\" [level=1] [ref=e5]\n    - generic [ref=e6]: Username\n    - textbox \"Username\" [ref=e7]: Ab\n    - generic [ref=e8]: Password\n    - textbox \"Password\" [ref=e9]: abc\n    - button \"Create account\" [active] [ref=e10] [cursor=pointer]"
}
```

### Tool call: browser_snapshot
- Args
```json
{}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/register\n- Page Title: Plotfold",
  "inlineSnapshot": "- main [ref=e3]:\n  - generic [ref=e4]:\n    - heading \"Start drawing\" [level=1] [ref=e5]\n    - generic [ref=e6]: Username\n    - textbox \"Username\" [ref=e7]: Ab\n    - generic [ref=e8]: Password\n    - textbox \"Password\" [ref=e9]: abc\n    - button \"Create account\" [active] [ref=e10] [cursor=pointer]"
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
      "value": "judge_472913"
    },
    {
      "target": "e9",
      "name": "Password",
      "type": "textbox",
      "value": "plotfold-pass1"
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
  "element": "Create account valid",
  "target": "e10"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/register\n- Page Title: Plotfold",
  "snapshot": "- main [ref=e3]:\n  - generic [ref=e4]:\n    - heading \"Start drawing\" [level=1] [ref=e5]\n    - generic [ref=e6]: Username\n    - textbox \"Username\" [ref=e7]: judge_472913\n    - generic [ref=e8]: Password\n    - textbox \"Password\" [ref=e9]: plotfold-pass1\n    - button \"Create account\" [active] [ref=e10] [cursor=pointer]"
}
```

### Tool call: browser_network_requests
- Args
```json
{
  "static": false
}
```
- Result
```json
{
  "result": "Note: 5 static requests not shown, run with \"static\" option to see them."
}
```

### Tool call: browser_snapshot
- Args
```json
{}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/register\n- Page Title: Plotfold",
  "inlineSnapshot": "- main [ref=e3]:\n  - generic [ref=e4]:\n    - heading \"Start drawing\" [level=1] [ref=e5]\n    - generic [ref=e6]: Username\n    - textbox \"Username\" [ref=e7]: judge_472913\n    - generic [ref=e8]: Password\n    - textbox \"Password\" [ref=e9]: plotfold-pass1\n    - button \"Create account\" [active] [ref=e10] [cursor=pointer]"
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
  "result": "Total messages: 0 (Errors: 0, Warnings: 0)"
}
```

### Tool call: browser_evaluate
- Args
```json
{
  "function": "() => ({ready:document.readyState,scripts:[...document.scripts].map(s=>s.src||s.textContent),buttonType:document.querySelector('button')?.type,form:!!document.querySelector('form')})"
}
```
- Result
```json
{
  "result": "{\n  \"ready\": \"complete\",\n  \"scripts\": [\n    \"{\\\"toastMs\\\":5000,\\\"domMarginPx\\\":200,\\\"domCeiling\\\":500}\",\n    \"http://127.0.0.1:4173/app.js\"\n  ],\n  \"buttonType\": \"button\",\n  \"form\": true\n}"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Username",
  "target": "e7"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/register\n- Page Title: Plotfold",
  "snapshot": "- main [ref=e3]:\n  - generic [ref=e4]:\n    - heading \"Start drawing\" [level=1] [ref=e5]\n    - generic [ref=e6]: Username\n    - textbox \"Username\" [active] [ref=e7]: judge_472913\n    - generic [ref=e8]: Password\n    - textbox \"Password\" [ref=e9]: plotfold-pass1\n    - button \"Create account\" [ref=e10] [cursor=pointer]"
}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "ControlOrMeta+a"
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
  "element": "Username",
  "target": "e7",
  "text": "judge_472913"
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
  "page": "- Page URL: http://127.0.0.1:4173/register\n- Page Title: Plotfold",
  "snapshot": "- main [ref=e3]:\n  - generic [ref=e4]:\n    - heading \"Start drawing\" [level=1] [ref=e5]\n    - generic [ref=e6]: Username\n    - textbox \"Username\" [ref=e7]: judge_472913\n    - generic [ref=e8]: Password\n    - textbox \"Password\" [ref=e9]: plotfold-pass1\n    - button \"Create account\" [active] [ref=e10] [cursor=pointer]"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Password",
  "target": "e9"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/register\n- Page Title: Plotfold",
  "snapshot": "- main [ref=e3]:\n  - generic [ref=e4]:\n    - heading \"Start drawing\" [level=1] [ref=e5]\n    - generic [ref=e6]: Username\n    - textbox \"Username\" [ref=e7]: judge_472913\n    - generic [ref=e8]: Password\n    - textbox \"Password\" [active] [ref=e9]: plotfold-pass1\n    - button \"Create account\" [ref=e10] [cursor=pointer]"
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
  "page": "- Page URL: http://127.0.0.1:4173/register\n- Page Title: Plotfold",
  "snapshot": "- main [ref=e3]:\n  - generic [ref=e4]:\n    - heading \"Start drawing\" [level=1] [ref=e5]\n    - generic [ref=e6]: Username\n    - textbox \"Username\" [ref=e7]: judge_472913\n    - generic [ref=e8]: Password\n    - textbox \"Password\" [active] [ref=e9]: plotfold-pass1\n    - button \"Create account\" [ref=e10] [cursor=pointer]"
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
  "result": "- [Screenshot of viewport](evidence/normal/page-2026-11-10T11-21-38-341Z.png)",
  "attachments": [
    {
      "type": "image",
      "data": "iVBORw0KGgoAAAANSUhEUgAABQAAAAMgCAIAAADz+lisAAAQAElEQVR4nOzdB7yWc+P48aulor2XSiGlUvZIKSQhoTJSIhkhkpBssvfee0SUmYbS0pCMZJS0l3a05/+r8/uf53aqIx4e5/R9v1/3q+e6v9f3vu8zX57P+V7XdecuXLR4AgAAADu6nAkAAABEQAADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQ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EMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAAEI5XAAAAfZJREFUEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABE4f8BAAD//+wYmI8AAAAGSURBVAMAYdnhjBTL+BEAAAAASUVORK5CYII=",
      "mimeType": "image/png"
    }
  ]
}
```
