
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
  "url": "http://127.0.0.1:4173/signup"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/signup\n- Page Title: Linewell",
  "snapshot": "- main [ref=e3]:\n  - heading \"Create your Linewell account\" [level=1] [ref=e4]\n  - generic [ref=e5]:\n    - alert [ref=e6]\n    - generic [ref=e8]:\n      - text: Name\n      - textbox \"Name\" [ref=e9]\n    - generic [ref=e11]:\n      - text: Email\n      - textbox \"Email\" [ref=e12]\n    - generic [ref=e14]:\n      - text: Password\n      - textbox \"Password\" [ref=e15]\n    - button \"Create account\" [ref=e16] [cursor=pointer]\n  - link \"Sign in instead\" [ref=e17] [cursor=pointer]:\n    - /url: /signin"
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
  "page": "- Page URL: http://127.0.0.1:4173/signup\n- Page Title: Linewell",
  "inlineSnapshot": "- main [ref=e3]:\n  - heading \"Create your Linewell account\" [level=1] [ref=e4]\n  - generic [ref=e5]:\n    - alert [ref=e6]\n    - generic [ref=e8]:\n      - text: Name\n      - textbox \"Name\" [ref=e9]\n    - generic [ref=e11]:\n      - text: Email\n      - textbox \"Email\" [ref=e12]\n    - generic [ref=e14]:\n      - text: Password\n      - textbox \"Password\" [ref=e15]\n    - button \"Create account\" [ref=e16] [cursor=pointer]\n  - link \"Sign in instead\" [ref=e17] [cursor=pointer]:\n    - /url: /signin"
}
```

### Tool call: browser_fill_form
- Args
```json
{
  "fields": [
    {
      "target": "e9",
      "name": "Name",
      "type": "textbox",
      "value": "Judge Peer z141439"
    },
    {
      "target": "e12",
      "name": "Email",
      "type": "textbox",
      "value": "judge-peer-z141439@example.com"
    },
    {
      "target": "e15",
      "name": "Password",
      "type": "textbox",
      "value": "judge-pass-z141439"
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
  "target": "e16"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/\n- Page Title: Linewell",
  "snapshot": "- main [ref=e19]:\n  - heading \"Your diagrams\" [level=1] [ref=e20]\n  - generic [ref=e21]:\n    - generic [ref=e22]:\n      - text: Title\n      - textbox \"Title\" [ref=e23]\n    - button \"New diagram\" [ref=e24] [cursor=pointer]\n  - list [ref=e25]:\n    - listitem [ref=e26]:\n      - link \"Judge Map z141439\" [ref=e27] [cursor=pointer]:\n        - /url: /d/d_00hnraq1t8a0"
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
  "inlineSnapshot": "- main [ref=e19]:\n  - heading \"Your diagrams\" [level=1] [ref=e20]\n  - generic [ref=e21]:\n    - generic [ref=e22]:\n      - text: Title\n      - textbox \"Title\" [ref=e23]\n    - button \"New diagram\" [ref=e24] [cursor=pointer]\n  - list [ref=e25]:\n    - listitem [ref=e26]:\n      - link \"Judge Map z141439\" [ref=e27] [cursor=pointer]:\n        - /url: /d/d_00hnraq1t8a0"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Judge Map",
  "target": "e27"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/d/d_00hnraq1t8a0?page=p_00hnraq1t8a1\n- Page Title: Linewell",
  "snapshot": "- generic [ref=e28]:\n  - banner [ref=e30]:\n    - heading \"Judge Map z141439\" [level=1] [ref=e31]\n    - button \"Judge Owner z141439, editing\" [ref=e33] [cursor=pointer]: JZ\n    - generic [ref=e34]:\n      - button \"Export\" [ref=e35] [cursor=pointer]\n      - button \"Outline\" [ref=e39] [cursor=pointer]\n  - generic:\n    - generic:\n      - status \"Connection\"\n  - generic [ref=e41]:\n    - generic [ref=e43]:\n      - region \"Pages\" [ref=e44]:\n        - heading \"Pages\" [level=2] [ref=e45]\n        - list [ref=e46]:\n          - listitem [ref=e47]:\n            - button \"Page 1\" [ref=e48] [cursor=pointer]\n        - button \"Add page\" [ref=e49] [cursor=pointer]\n      - region \"Layers\" [ref=e51]:\n        - heading \"Layers\" [level=2] [ref=e52]\n        - list [ref=e53]:\n          - listitem [ref=e54]:\n            - generic [ref=e55]: Layer 1\n            - generic [ref=e56]: \"2\"\n            - button \"Hide layer Layer 1\" [ref=e57] [cursor=pointer]\n            - button \"Lock layer Layer 1\" [ref=e61] [cursor=pointer]\n        - button \"Add layer\" [ref=e65] [cursor=pointer]\n    - generic [ref=e67]:\n      - toolbar \"Tools\" [ref=e69]:\n        - button \"Rectangle\" [ref=e70] [cursor=pointer]\n        - button \"Ellipse\" [ref=e73] [cursor=pointer]\n        - button \"Diamond\" [ref=e76] [cursor=pointer]\n        - button \"Text\" [ref=e79] [cursor=pointer]\n        - button \"Snap to grid\" [pressed] [ref=e82] [cursor=pointer]\n        - button \"Align\" [ref=e84] [cursor=pointer]\n        - button \"Undo\" [ref=e86] [cursor=pointer]\n        - button \"Redo\" [ref=e90] [cursor=pointer]\n      - generic [ref=e94]:\n        - img \"Page 1 canvas\" [ref=e96]:\n          - generic [ref=e99]:\n            - generic \"Start\" [ref=e100]\n            - generic \"Check\" [ref=e103]\n            - generic \"Connector from Start to Check\"\n        - group \"View\" [ref=e106]:\n          - button \"Zoom out\" [ref=e107] [cursor=pointer]\n          - status \"Zoom\" [ref=e111]: 100%\n          - button \"Zoom in\" [ref=e112] [cursor=pointer]\n          - button \"Reset zoom\" [ref=e116] [cursor=pointer]\n          - button \"Layers\" [expanded] [ref=e122] [cursor=pointer]\n          - button \"Toggle inspector\" [expanded] [ref=e126] [cursor=pointer]\n      - generic [ref=e130]:\n        - button \"Previous page\" [ref=e131] [cursor=pointer]\n        - generic [ref=e134]: Page 1 · 1 of 1\n        - button \"Next page\" [ref=e135] [cursor=pointer]\n    - complementary [ref=e138]:\n      - tablist \"Inspector tabs\" [ref=e139]:\n        - tab \"Inspector\" [selected] [ref=e140] [cursor=pointer]\n        - tab \"Comments\" [ref=e141] [cursor=pointer]\n        - tab \"History\" [ref=e142] [cursor=pointer]\n      - generic [ref=e144]:\n        - heading \"Nothing selected\" [level=2] [ref=e145]\n        - generic [ref=e146]:\n          - generic [ref=e148]:\n            - text: X\n            - spinbutton \"X\" [ref=e149]\n          - generic [ref=e151]:\n            - text: \"Y\"\n            - spinbutton \"Y\" [ref=e152]\n          - generic [ref=e154]:\n            - text: Width\n            - spinbutton \"Width\" [ref=e155]\n          - generic [ref=e157]:\n            - text: Height\n            - spinbutton \"Height\" [ref=e158]\n        - generic [ref=e160]:\n          - text: Label\n          - textbox \"Label\" [ref=e161]\n        - generic [ref=e163]:\n          - text: Layer\n          - combobox \"Layer\" [disabled] [ref=e164]:\n            - option \"Layer 1\" [selected]"
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
  "page": "- Page URL: http://127.0.0.1:4173/d/d_00hnraq1t8a0?page=p_00hnraq1t8a1\n- Page Title: Linewell",
  "inlineSnapshot": "- generic [ref=e28]:\n  - banner [ref=e30]:\n    - heading \"Judge Map z141439\" [level=1] [ref=e31]\n    - button \"Judge Owner z141439, editing\" [ref=e33] [cursor=pointer]: JZ\n    - generic [ref=e34]:\n      - button \"Export\" [ref=e35] [cursor=pointer]\n      - button \"Outline\" [ref=e39] [cursor=pointer]\n  - generic:\n    - generic:\n      - status \"Connection\"\n  - generic [ref=e41]:\n    - generic [ref=e43]:\n      - region \"Pages\" [ref=e44]\n      - region \"Layers\" [ref=e51]\n    - generic [ref=e67]:\n      - toolbar \"Tools\" [ref=e69]\n      - generic [ref=e94]\n      - generic [ref=e130]\n    - complementary [ref=e138]:\n      - tablist \"Inspector tabs\" [ref=e139]\n      - generic [ref=e144]"
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
  "page": "- Page URL: http://127.0.0.1:4173/d/d_00hnraq1t8a0?page=p_00hnraq1t8a1\n- Page Title: Linewell",
  "inlineSnapshot": "- generic [ref=e28]:\n  - banner [ref=e30]:\n    - heading \"Judge Map z141439\" [level=1] [ref=e31]\n    - button \"Judge Owner z141439, editing\" [ref=e33] [cursor=pointer]: JZ\n    - generic [ref=e34]:\n      - button \"Export\" [ref=e35] [cursor=pointer]\n      - button \"Outline\" [ref=e39] [cursor=pointer]\n  - generic:\n    - generic:\n      - status \"Connection\"\n  - generic [ref=e41]:\n    - generic [ref=e43]:\n      - region \"Pages\" [ref=e44]:\n        - heading \"Pages\" [level=2] [ref=e45]\n        - list [ref=e46]:\n          - listitem [ref=e47]\n        - button \"Add page\" [ref=e49] [cursor=pointer]\n      - region \"Layers\" [ref=e51]:\n        - heading \"Layers\" [level=2] [ref=e52]\n        - list [ref=e53]:\n          - listitem [ref=e54]\n        - button \"Add layer\" [ref=e65] [cursor=pointer]\n    - generic [ref=e67]:\n      - toolbar \"Tools\" [ref=e69]:\n        - button \"Rectangle\" [ref=e70] [cursor=pointer]\n        - button \"Ellipse\" [ref=e73] [cursor=pointer]\n        - button \"Diamond\" [ref=e76] [cursor=pointer]\n        - button \"Text\" [ref=e79] [cursor=pointer]\n        - button \"Snap to grid\" [pressed] [ref=e82] [cursor=pointer]\n        - button \"Align\" [ref=e84] [cursor=pointer]\n        - button \"Undo\" [ref=e86] [cursor=pointer]\n        - button \"Redo\" [ref=e90] [cursor=pointer]\n      - generic [ref=e94]:\n        - img \"Page 1 canvas\" [ref=e96]:\n          - generic [ref=e99]\n        - group \"View\" [ref=e106]:\n          - button \"Zoom out\" [ref=e107] [cursor=pointer]\n          - status \"Zoom\" [ref=e111]: 100%\n          - button \"Zoom in\" [ref=e112] [cursor=pointer]\n          - button \"Reset zoom\" [ref=e116] [cursor=pointer]\n          - button \"Layers\" [expanded] [ref=e122] [cursor=pointer]\n          - button \"Toggle inspector\" [expanded] [ref=e126] [cursor=pointer]\n      - generic [ref=e130]:\n        - button \"Previous page\" [ref=e131] [cursor=pointer]\n        - generic [ref=e134]: Page 1 · 1 of 1\n        - button \"Next page\" [ref=e135] [cursor=pointer]\n    - complementary [ref=e138]:\n      - tablist \"Inspector tabs\" [ref=e139]:\n        - tab \"Inspector\" [selected] [ref=e140] [cursor=pointer]\n        - tab \"Comments\" [ref=e141] [cursor=pointer]\n        - tab \"History\" [ref=e142] [cursor=pointer]\n      - generic [ref=e144]:\n        - heading \"Nothing selected\" [level=2] [ref=e145]\n        - generic [ref=e146]:\n          - generic [ref=e148]\n          - generic [ref=e151]\n          - generic [ref=e154]\n          - generic [ref=e157]\n        - generic [ref=e160]:\n          - text: Label\n          - textbox \"Label\" [ref=e161]\n        - generic [ref=e163]:\n          - text: Layer\n          - combobox \"Layer\" [disabled] [ref=e164]"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "canvas",
  "target": "e96"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/d/d_00hnraq1t8a0?page=p_00hnraq1t8a1\n- Page Title: Linewell",
  "snapshot": "- generic [ref=e28]:\n  - banner [ref=e165]:\n    - heading \"Judge Map z141439\" [level=1] [ref=e166]\n    - button \"Judge Owner z141439, editing\" [ref=e168] [cursor=pointer]: JZ\n    - generic [ref=e169]:\n      - button \"Export\" [ref=e170] [cursor=pointer]\n      - button \"Outline\" [ref=e174] [cursor=pointer]\n  - generic:\n    - generic:\n      - status \"Connection\"\n  - generic [ref=e41]:\n    - generic [ref=e43]:\n      - region \"Pages\" [ref=e176]:\n        - heading \"Pages\" [level=2] [ref=e177]\n        - list [ref=e178]:\n          - listitem [ref=e179]:\n            - button \"Page 1\" [ref=e180] [cursor=pointer]\n        - button \"Add page\" [ref=e181] [cursor=pointer]\n      - region \"Layers\" [ref=e183]:\n        - heading \"Layers\" [level=2] [ref=e184]\n        - list [ref=e185]:\n          - listitem [ref=e186]:\n            - generic [ref=e187]: Layer 1\n            - generic [ref=e188]: \"2\"\n            - button \"Hide layer Layer 1\" [ref=e189] [cursor=pointer]\n            - button \"Lock layer Layer 1\" [ref=e193] [cursor=pointer]\n        - button \"Add layer\" [ref=e197] [cursor=pointer]\n    - generic [ref=e67]:\n      - toolbar \"Tools\" [ref=e199]:\n        - button \"Rectangle\" [ref=e200] [cursor=pointer]\n        - button \"Ellipse\" [ref=e203] [cursor=pointer]\n        - button \"Diamond\" [ref=e206] [cursor=pointer]\n        - button \"Text\" [ref=e209] [cursor=pointer]\n        - button \"Snap to grid\" [pressed] [ref=e212] [cursor=pointer]\n        - button \"Align\" [ref=e214] [cursor=pointer]\n        - button \"Undo\" [ref=e216] [cursor=pointer]\n        - button \"Redo\" [ref=e220] [cursor=pointer]\n      - generic [ref=e94]:\n        - img \"Page 1 canvas\" [ref=e224]:\n          - generic [ref=e227]:\n            - generic \"Start\" [active] [ref=e228]\n            - generic \"Check\" [ref=e231]\n            - generic \"Connector from Start to Check\" [ref=e234]\n        - group \"View\" [ref=e241]:\n          - button \"Zoom out\" [ref=e242] [cursor=pointer]\n          - status \"Zoom\" [ref=e246]: 100%\n          - button \"Zoom in\" [ref=e247] [cursor=pointer]\n          - button \"Reset zoom\" [ref=e251] [cursor=pointer]\n          - button \"Layers\" [expanded] [ref=e257] [cursor=pointer]\n          - button \"Toggle inspector\" [expanded] [ref=e261] [cursor=pointer]\n      - generic [ref=e264]:\n        - button \"Previous page\" [ref=e265] [cursor=pointer]\n        - generic [ref=e268]: Page 1 · 1 of 1\n        - button \"Next page\" [ref=e269] [cursor=pointer]\n    - complementary [ref=e138]:\n      - tablist \"Inspector tabs\" [ref=e139]:\n        - tab \"Inspector\" [selected] [ref=e272] [cursor=pointer]\n        - tab \"Comments\" [ref=e273] [cursor=pointer]\n        - tab \"History\" [ref=e274] [cursor=pointer]\n      - generic [ref=e275]:\n        - heading \"Start\" [level=2] [ref=e276]\n        - generic [ref=e277]:\n          - generic [ref=e279]:\n            - text: X\n            - spinbutton \"X\" [ref=e280]: \"288\"\n          - generic [ref=e282]:\n            - text: \"Y\"\n            - spinbutton \"Y\" [ref=e283]: \"304\"\n          - generic [ref=e285]:\n            - text: Width\n            - spinbutton \"Width\" [ref=e286]: \"160\"\n          - generic [ref=e288]:\n            - text: Height\n            - spinbutton \"Height\" [ref=e289]: \"80\"\n        - generic [ref=e291]:\n          - text: Label\n          - textbox \"Label\" [ref=e292]: Start\n        - generic [ref=e294]:\n          - text: Layer\n          - combobox \"Layer\" [ref=e295]:\n            - option \"Layer 1\" [selected]\n  - generic [ref=e18]: Moved Start. 1 connector rerouted."
}
```
