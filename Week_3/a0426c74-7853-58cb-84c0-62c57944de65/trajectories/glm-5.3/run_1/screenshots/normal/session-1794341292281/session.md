
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
  "snapshot": "- generic [ref=e4]:\n  - heading \"Create account\" [level=1] [ref=e5]\n  - generic [ref=e6]:\n    - text: Username\n    - textbox \"Username\" [ref=e7]\n  - generic [ref=e8]:\n    - text: Password\n    - textbox \"Password\" [ref=e9]\n  - status [ref=e10]\n  - button \"Create account\" [ref=e11] [cursor=pointer]\n  - link \"Sign in\" [ref=e13] [cursor=pointer]:\n    - /url: /signin"
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
  "page": "- Page URL: http://127.0.0.1:4173/register\n- Page Title: Plotfold",
  "inlineSnapshot": "- generic [ref=e4]:\n  - heading \"Create account\" [level=1] [ref=e5]\n  - generic [ref=e6]:\n    - text: Username\n    - textbox \"Username\" [ref=e7]\n  - generic [ref=e8]:\n    - text: Password\n    - textbox \"Password\" [ref=e9]\n  - status [ref=e10]\n  - button \"Create account\" [ref=e11] [cursor=pointer]\n  - link \"Sign in\" [ref=e13] [cursor=pointer]:\n    - /url: /signin"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Create account",
  "target": "e11"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/register\n- Page Title: Plotfold\n- Console: 1 errors, 0 warnings",
  "snapshot": "- generic [ref=e4]:\n  - heading \"Create account\" [level=1] [ref=e5]\n  - generic [ref=e6]:\n    - text: Username\n    - textbox \"Username\" [ref=e7]\n  - generic [ref=e8]:\n    - text: Password\n    - textbox \"Password\" [ref=e9]\n  - status [ref=e10]: Try again.\n  - button \"Create account\" [active] [ref=e11] [cursor=pointer]\n  - link \"Sign in\" [ref=e13] [cursor=pointer]:\n    - /url: /signin",
  "events": "- New console entries: evidence/normal/console-2026-11-10T20-08-17-363Z.log#L1"
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
  "element": "Create account",
  "target": "e11"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/register\n- Page Title: Plotfold\n- Console: 2 errors, 0 warnings",
  "snapshot": "- generic [ref=e4]:\n  - heading \"Create account\" [level=1] [ref=e5]\n  - generic [ref=e6]:\n    - text: Username\n    - textbox \"Username\" [ref=e7]: Ab\n  - generic [ref=e8]:\n    - text: Password\n    - textbox \"Password\" [ref=e9]: abc\n  - status [ref=e10]: Try again.\n  - button \"Create account\" [active] [ref=e11] [cursor=pointer]\n  - link \"Sign in\" [ref=e13] [cursor=pointer]:\n    - /url: /signin",
  "events": "- New console entries: evidence/normal/console-2026-11-10T20-08-17-363Z.log#L2"
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
  "page": "- Page URL: http://127.0.0.1:4173/register\n- Page Title: Plotfold\n- Console: 2 errors, 0 warnings",
  "inlineSnapshot": "- generic [ref=e4]:\n  - heading \"Create account\" [level=1] [ref=e5]\n  - generic [ref=e6]:\n    - text: Username\n    - textbox \"Username\" [ref=e7]: Ab\n  - generic [ref=e8]:\n    - text: Password\n    - textbox \"Password\" [ref=e9]: abc\n  - status [ref=e10]: Try again.\n  - button \"Create account\" [active] [ref=e11] [cursor=pointer]\n  - link \"Sign in\" [ref=e13] [cursor=pointer]:\n    - /url: /signin"
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
      "value": "judge_483271"
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
  "element": "Create account",
  "target": "e11"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/register\n- Page Title: Plotfold\n- Console: 3 errors, 0 warnings",
  "snapshot": "- generic [ref=e4]:\n  - heading \"Create account\" [level=1] [ref=e5]\n  - generic [ref=e6]:\n    - text: Username\n    - textbox \"Username\" [ref=e7]: judge_483271\n  - generic [ref=e8]:\n    - text: Password\n    - textbox \"Password\" [ref=e9]: plotfold-pass1\n  - status [ref=e10]: Try again.\n  - button \"Create account\" [active] [ref=e11] [cursor=pointer]\n  - link \"Sign in\" [ref=e13] [cursor=pointer]:\n    - /url: /signin",
  "events": "- New console entries: evidence/normal/console-2026-11-10T20-08-17-363Z.log#L3"
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
  "page": "- Page URL: http://127.0.0.1:4173/register\n- Page Title: Plotfold\n- Console: 3 errors, 0 warnings",
  "inlineSnapshot": "- generic [ref=e4]:\n  - heading \"Create account\" [level=1] [ref=e5]\n  - generic [ref=e6]:\n    - text: Username\n    - textbox \"Username\" [ref=e7]: judge_483271\n  - generic [ref=e8]:\n    - text: Password\n    - textbox \"Password\" [ref=e9]: plotfold-pass1\n  - status [ref=e10]: Try again.\n  - button \"Create account\" [active] [ref=e11] [cursor=pointer]\n  - link \"Sign in\" [ref=e13] [cursor=pointer]:\n    - /url: /signin"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Create account retry",
  "target": "e11"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/register\n- Page Title: Plotfold\n- Console: 4 errors, 0 warnings",
  "snapshot": "- generic [ref=e4]:\n  - heading \"Create account\" [level=1] [ref=e5]\n  - generic [ref=e6]:\n    - text: Username\n    - textbox \"Username\" [ref=e7]: judge_483271\n  - generic [ref=e8]:\n    - text: Password\n    - textbox \"Password\" [ref=e9]: plotfold-pass1\n  - status [ref=e10]: Try again.\n  - button \"Create account\" [active] [ref=e11] [cursor=pointer]\n  - link \"Sign in\" [ref=e13] [cursor=pointer]:\n    - /url: /signin",
  "events": "- New console entries: evidence/normal/console-2026-11-10T20-08-17-363Z.log#L4"
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
  "page": "- Page URL: http://127.0.0.1:4173/signin\n- Page Title: Plotfold",
  "snapshot": "- generic [ref=f1e4]:\n  - heading \"Sign in\" [level=1] [ref=f1e5]\n  - generic [ref=f1e6]:\n    - text: Username\n    - textbox \"Username\" [ref=f1e7]\n  - generic [ref=f1e8]:\n    - text: Password\n    - textbox \"Password\" [ref=f1e9]\n  - status [ref=f1e10]\n  - button \"Sign in\" [ref=f1e11] [cursor=pointer]\n  - link \"Start drawing\" [ref=f1e13] [cursor=pointer]:\n    - /url: /register"
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
  "page": "- Page URL: http://127.0.0.1:4173/signin\n- Page Title: Plotfold",
  "inlineSnapshot": "- generic [ref=f1e4]:\n  - heading \"Sign in\" [level=1] [ref=f1e5]\n  - generic [ref=f1e6]:\n    - text: Username\n    - textbox \"Username\" [ref=f1e7]\n  - generic [ref=f1e8]:\n    - text: Password\n    - textbox \"Password\" [ref=f1e9]\n  - status [ref=f1e10]\n  - button \"Sign in\" [ref=f1e11] [cursor=pointer]\n  - link \"Start drawing\" [ref=f1e13] [cursor=pointer]:\n    - /url: /register"
}
```

### Tool call: browser_fill_form
- Args
```json
{
  "fields": [
    {
      "target": "f1e7",
      "name": "Username",
      "type": "textbox",
      "value": "judge_483271"
    },
    {
      "target": "f1e9",
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
  "element": "Sign in",
  "target": "f1e11"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/signin\n- Page Title: Plotfold\n- Console: 1 errors, 0 warnings",
  "snapshot": "- generic [ref=f1e4]:\n  - heading \"Sign in\" [level=1] [ref=f1e5]\n  - generic [ref=f1e6]:\n    - text: Username\n    - textbox \"Username\" [ref=f1e7]: judge_483271\n  - generic [ref=f1e8]:\n    - text: Password\n    - textbox \"Password\" [ref=f1e9]: plotfold-pass1\n  - status [ref=f1e10]: Try again.\n  - button \"Sign in\" [active] [ref=f1e11] [cursor=pointer]\n  - link \"Start drawing\" [ref=f1e13] [cursor=pointer]:\n    - /url: /register",
  "events": "- New console entries: evidence/normal/console-2026-11-10T20-09-27-270Z.log#L1"
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
  "page": "- Page URL: http://127.0.0.1:4173/signin\n- Page Title: Plotfold\n- Console: 1 errors, 0 warnings",
  "inlineSnapshot": "- generic [ref=f1e4]:\n  - heading \"Sign in\" [level=1] [ref=f1e5]\n  - generic [ref=f1e6]:\n    - text: Username\n    - textbox \"Username\" [ref=f1e7]: judge_483271\n  - generic [ref=f1e8]:\n    - text: Password\n    - textbox \"Password\" [ref=f1e9]: plotfold-pass1\n  - status [ref=f1e10]: Try again.\n  - button \"Sign in\" [active] [ref=f1e11] [cursor=pointer]\n  - link \"Start drawing\" [ref=f1e13] [cursor=pointer]:\n    - /url: /register"
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
  "result": "- [Screenshot of viewport](evidence/normal/page-2026-11-10T20-09-49-398Z.png)",
  "attachments": [
    {
      "type": "image",
      "data": "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/e6GDRvT09O3rlGtY6eLwmPPPXbdZ6/mYb71wfuFx1kXXNWh04U1qlUpUXyrjRs3JgBAnhLAAOSbDz/+4szzLg+deU7njgP79e56/plFixbdzPorru1x6dXd5y9Y9NXXI+bPXxhSMzW/fPmKkiWKv9Sn/6BPBmdnZyd/TOjn1WvWfDDo8zAe+N7H8xcszHlr1arV4Ty33vXQvO8W5EyG87dtf8akKdNC9IYkrlG9WpgMrVu9etUweOu1p++948YwCPu6EydN3fylB7w7KDzPmj132oxZVatWTn685TtsFE+bPjOMn3n+1bS0tAQAyGtugQYgP40eMz48wmDfvfe8+rLzVqxY+egTz/3W4mOPOfzIww6qV3ebVCfnVGJqs3TI0OHJn5GRUTpcLufl8uX/fxxOOGrsuE3W775b406nnlB/2zplSpdKfrxnO/khgGeGT9545x1CGNetXatUqZJVKlf69j8Tk83KWrYsNQiZXahQoTAoXapUyPjU5Jy58xIA4C9gBxiAfHNUm4O3/fnG448++eLLr4Zt5jerypXNvLzr2c+/0m+PVkfs0vyQsA27yYLluWr2j1i6dHnJEiVyXmZmlsn97prVazZZf8kFncOebauD2oWrv/nO+6nJ/0ycUrFi+VZ7NfvksyHDRoxuf0ybJVlZCxcuTv6kZcv//4epXq1qAgD8BQQwAPmm4fbbXnTuGeXLlQ3jrWtUa7LLTqmfgA5WrV5TtUqlEsWLhw3SVBWXL182PT39m2GjwviA/faqWKF80aJFfvcSq1evCTvGYVClcsWMjP+TuMNHjgnRG9o1jA9vfUBmRsbmTxUWjxz9beqjNt21cZHCP9xFNW36zKJFijTfo8lHH3/x2RdDD2+9//QZs5M/L2yDN965YfiExYoVPa1j+wQA+AsIYADyzb0PPblw0eKH7+sx5JP+d/a49vmX+r786pupt15/45258+Z/NOClrz5589STf/j9qomTpn4w6POnHr37mcfuqV+3dr83B57Wof2B++21+Us8+NgzHU44ZvjgAa/0frh6tSq535q/YNELr/S757brw7tNd2005tv/bP6bt8++8NpF53V6ptc953TueM/9vVo0bxoGyQ93LH8XMnvxkqxPv/iqWtXKqa3pGtWrhtOGx/lnndpop4ap8fb16/7WycMG+MefDXnsgdv6PPdI+CfdsGFDAgDktbQKlaokAJCnqlSrvjQrK+G/sk2trV9/8bHDju4Y0jqJWEZm5rw5/812OgD8FjvAAJD/ihUr+k7fZ446/OD09LSTjms7a/bcyOsXAP4KfgUagPzR5YyTOp9+UsLPrrnhthOOPeq0ju2zli676ZaewwcP6Hr5DR99MjgBAPKIW6AByHtugeZ/5xZoAPKcW6ABAACIggAGAAAgCgIYAACAKAhgAAAAoiCAAQAAiIIABgAAIAoCGAAAgCgIYAAAAKIggAEAAIiCAAYAACAKAhgAAIAoCGAAAACiUDgBgL9ARmZmAgBQkKRVqFQlAQAAgH86t0ADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAATck2jAAAIUUlEQVQAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADJAAAxEAAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABEQQADAAAQBQEMAABAFAQwAAAAURDAAAAAREEAAwAAEAUBDAAAQBQEMAAAAFEQwAAAAERBAAMAABAFAQwAAEAUBDAAAABREMAAAABE4f8BAAD//9t5idQAAAAGSURBVAMAHmCacwzRwvQAAAAASUVORK5CYII=",
      "mimeType": "image/png"
    }
  ]
}
```

### Tool call: browser_network_requests
- Args
```json
{
  "static": false,
  "filter": "/api/auth"
}
```
- Result
```json
{
  "result": "Note: 5 static requests not shown, run with \"static\" option to see them."
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
  "result": "Total messages: 1 (Errors: 1, Warnings: 0)\nReturning 5 messages for level \"error\"\n\n[ERROR] Failed to load resource: the server responded with a status of 404 (Not Found) @ http://127.0.0.1:4173/register:0\n[ERROR] Failed to load resource: the server responded with a status of 404 (Not Found) @ http://127.0.0.1:4173/register:0\n[ERROR] Failed to load resource: the server responded with a status of 404 (Not Found) @ http://127.0.0.1:4173/register:0\n[ERROR] Failed to load resource: the server responded with a status of 404 (Not Found) @ http://127.0.0.1:4173/register:0\n[ERROR] Failed to load resource: the server responded with a status of 404 (Not Found) @ http://127.0.0.1:4173/signin:0"
}
```
