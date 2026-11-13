
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
  "url": "http://127.0.0.1:4173/claim/new"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/claim/new\n- Page Title: Holmgarth Aftercare — Fittings Desk",
  "snapshot": "- generic [ref=e2]:\n  - link \"Skip to claim\" [ref=e3] [cursor=pointer]:\n    - /url: \"#main\"\n  - banner [ref=e4]:\n    - heading \"Holmgarth Aftercare\" [level=1] [ref=e5]\n    - radiogroup \"Language · Język\" [ref=e6]:\n      - radio \"English\" [checked] [ref=e8]\n      - generic [ref=e9]: English\n      - radio \"Polski\" [ref=e10]\n      - generic [ref=e11]: Polski\n  - main [ref=e12]:\n    - heading \"Claim a part\" [level=2] [ref=e13]\n    - alert [ref=e14]\n    - status [ref=e15]\n    - generic [ref=e16]:\n      - paragraph [ref=e18]: Model\n      - generic [ref=e19]:\n        - generic [ref=e20]:\n          - generic [ref=e21]:\n            - generic [ref=e22]: Your name\n            - textbox \"Your name\" [ref=e23]\n            - paragraph [ref=e24]\n          - generic [ref=e25]:\n            - generic [ref=e26]: Email\n            - textbox \"Email\" [ref=e27]\n            - paragraph [ref=e28]\n          - generic [ref=e29]:\n            - generic [ref=e30]: Postcode\n            - textbox \"Postcode\" [ref=e31]\n            - paragraph [ref=e32]\n          - generic [ref=e33]:\n            - generic [ref=e34]: Model\n            - combobox \"Model\" [ref=e35]:\n              - option \"—\" [selected]\n              - option \"Aldra Wardrobe\"\n              - option \"Bramwell Sofa Frame\"\n              - option \"Kestle Shelving Unit\"\n              - option \"Fenwick Bed Frame\"\n            - paragraph [ref=e36]\n          - generic [ref=e37]:\n            - generic [ref=e38]: Date of purchase\n            - textbox \"Date of purchase\" [ref=e39]\n            - paragraph [ref=e40]\n          - generic [ref=e41]:\n            - generic [ref=e42]: Quantity\n            - spinbutton \"Quantity\" [ref=e43]: \"1\"\n            - paragraph [ref=e44]\n          - generic [ref=e45]:\n            - generic [ref=e46]: What happened\n            - textbox \"What happened\" [ref=e47]\n            - paragraph [ref=e48]\n          - generic [ref=e49]:\n            - generic [ref=e50]: Damage photos\n            - button \"Damage photos\" [ref=e51]\n            - paragraph [ref=e52]\n          - button \"Start claim\" [ref=e53] [cursor=pointer]\n        - paragraph\n        - region \"Estimate carriage\" [ref=e54]:\n          - paragraph\n          - button \"Estimate carriage\" [ref=e55] [cursor=pointer]"
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
  "page": "- Page URL: http://127.0.0.1:4173/claim/new\n- Page Title: Holmgarth Aftercare — Fittings Desk",
  "inlineSnapshot": "- generic [ref=e2]:\n  - link \"Skip to claim\" [ref=e3] [cursor=pointer]:\n    - /url: \"#main\"\n  - banner [ref=e4]:\n    - heading \"Holmgarth Aftercare\" [level=1] [ref=e5]\n    - radiogroup \"Language · Język\" [ref=e6]:\n      - radio \"English\" [checked] [ref=e8]\n      - generic [ref=e9]: English\n      - radio \"Polski\" [ref=e10]\n      - generic [ref=e11]: Polski\n  - main [ref=e12]:\n    - heading \"Claim a part\" [level=2] [ref=e13]\n    - alert [ref=e14]\n    - status [ref=e15]\n    - generic [ref=e16]:\n      - paragraph [ref=e18]: Model\n      - generic [ref=e19]:\n        - generic [ref=e20]:\n          - generic [ref=e21]:\n            - generic [ref=e22]: Your name\n            - textbox \"Your name\" [ref=e23]\n            - paragraph [ref=e24]\n          - generic [ref=e25]:\n            - generic [ref=e26]: Email\n            - textbox \"Email\" [ref=e27]\n            - paragraph [ref=e28]\n          - generic [ref=e29]:\n            - generic [ref=e30]: Postcode\n            - textbox \"Postcode\" [ref=e31]\n            - paragraph [ref=e32]\n          - generic [ref=e33]:\n            - generic [ref=e34]: Model\n            - combobox \"Model\" [ref=e35]\n            - paragraph [ref=e36]\n          - generic [ref=e37]:\n            - generic [ref=e38]: Date of purchase\n            - textbox \"Date of purchase\" [ref=e39]\n            - paragraph [ref=e40]\n          - generic [ref=e41]:\n            - generic [ref=e42]: Quantity\n            - spinbutton \"Quantity\" [ref=e43]: \"1\"\n            - paragraph [ref=e44]\n          - generic [ref=e45]:\n            - generic [ref=e46]: What happened\n            - textbox \"What happened\" [ref=e47]\n            - paragraph [ref=e48]\n          - generic [ref=e49]:\n            - generic [ref=e50]: Damage photos\n            - button \"Damage photos\" [ref=e51]\n            - paragraph [ref=e52]\n          - button \"Start claim\" [ref=e53] [cursor=pointer]\n        - paragraph\n        - region \"Estimate carriage\" [ref=e54]:\n          - paragraph\n          - button \"Estimate carriage\" [ref=e55] [cursor=pointer]"
}
```

### Tool call: browser_fill_form
- Args
```json
{
  "fields": [
    {
      "element": "Model combobox",
      "target": "e35",
      "name": "Model",
      "type": "combobox",
      "value": "Kestle Shelving Unit"
    }
  ]
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
  "depth": 8
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/claim/new\n- Page Title: Holmgarth Aftercare — Fittings Desk",
  "inlineSnapshot": "- generic [ref=e2]:\n  - link \"Skip to claim\" [ref=e3] [cursor=pointer]:\n    - /url: \"#main\"\n  - banner [ref=e4]:\n    - heading \"Holmgarth Aftercare\" [level=1] [ref=e5]\n    - radiogroup \"Language · Język\" [ref=e6]:\n      - radio \"English\" [checked] [ref=e8]\n      - generic [ref=e9]: English\n      - radio \"Polski\" [ref=e10]\n      - generic [ref=e11]: Polski\n  - main [ref=e12]:\n    - heading \"Claim a part\" [level=2] [ref=e13]\n    - alert [ref=e14]\n    - status [ref=e15]\n    - generic [ref=e16]:\n      - generic [ref=e17]:\n        - paragraph [ref=e18]: Model\n        - region \"Fitting fan\" [ref=e56]:\n          - generic [ref=e57]: Separate parts\n          - slider \"Separate parts\" [ref=e58]: \"100\"\n          - generic [ref=e59]:\n            - 'button \"Part 1: Upright\" [ref=e60] [cursor=pointer]':\n              - generic [aria-hidden] [ref=e62]: \"1\"\n            - 'button \"Part 2: Shelf board\" [ref=e63] [cursor=pointer]':\n              - generic [aria-hidden] [ref=e65]: \"2\"\n            - 'button \"Part 3: Shelf pin\" [ref=e66] [cursor=pointer]':\n              - generic [aria-hidden] [ref=e68]: \"3\"\n            - 'button \"Part 4: Wall bracket\" [ref=e69] [cursor=pointer]':\n              - generic [aria-hidden] [ref=e71]: \"4\"\n            - 'button \"Part 5: Back brace\" [disabled] [ref=e72]':\n              - generic [aria-hidden] [ref=e73]: \"5\"\n      - generic [ref=e19]:\n        - generic [ref=e20]:\n          - generic [ref=e21]:\n            - generic [ref=e22]: Your name\n            - textbox \"Your name\" [ref=e23]\n            - paragraph [ref=e24]\n          - generic [ref=e25]:\n            - generic [ref=e26]: Email\n            - textbox \"Email\" [ref=e27]\n            - paragraph [ref=e28]\n          - generic [ref=e29]:\n            - generic [ref=e30]: Postcode\n            - textbox \"Postcode\" [ref=e31]\n            - paragraph [ref=e32]\n          - generic [ref=e33]:\n            - generic [ref=e34]: Model\n            - combobox \"Model\" [ref=e35]:\n              - option \"—\"\n              - option \"Aldra Wardrobe\"\n              - option \"Bramwell Sofa Frame\"\n              - option \"Kestle Shelving Unit\" [selected]\n              - option \"Fenwick Bed Frame\"\n            - paragraph [ref=e36]\n          - generic [ref=e37]:\n            - generic [ref=e38]: Date of purchase\n            - textbox \"Date of purchase\" [ref=e39]\n            - paragraph [ref=e40]\n          - generic [ref=e41]:\n            - generic [ref=e42]: Quantity\n            - spinbutton \"Quantity\" [ref=e43]: \"1\"\n            - paragraph [ref=e44]\n          - generic [ref=e45]:\n            - generic [ref=e46]: What happened\n            - textbox \"What happened\" [ref=e47]\n            - paragraph [ref=e48]\n          - generic [ref=e49]:\n            - generic [ref=e50]: Damage photos\n            - button \"Damage photos\" [ref=e51]\n            - paragraph [ref=e52]\n          - button \"Start claim\" [ref=e53] [cursor=pointer]\n        - paragraph\n        - region \"Estimate carriage\" [ref=e54]:\n          - paragraph\n          - button \"Estimate carriage\" [ref=e55] [cursor=pointer]"
}
```

### Tool call: browser_evaluate
- Args
```json
{
  "element": "Fitting fan",
  "target": "e56",
  "function": "(el) => { const all=[el,...el.querySelectorAll('*')]; return all.map(x=>({tag:x.tagName,cls:x.className,bg:getComputedStyle(x).backgroundImage,bgs:getComputedStyle(x).backgroundSize})).filter(x=>x.bg!=='none') }"
}
```
- Result
```json
{
  "result": "[\n  {\n    \"tag\": \"SECTION\",\n    \"cls\": \"fan\",\n    \"bg\": \"linear-gradient(0deg, rgba(47, 107, 181, 0.07) 1px, rgba(0, 0, 0, 0) 1px), linear-gradient(90deg, rgba(47, 107, 181, 0.07) 1px, rgba(0, 0, 0, 0) 1px), none\",\n    \"bgs\": \"8px 8px, 8px 8px, auto\"\n  }\n]"
}
```

### Tool call: browser_evaluate
- Args
```json
{
  "element": "Fitting fan",
  "target": "e56",
  "function": "(el) => [...el.querySelectorAll('button')].map(b=>({label:b.getAttribute('aria-label'),buttonColor:getComputedStyle(b).color,border:getComputedStyle(b).border,children:[...b.children].map(c=>({cls:c.className,font:getComputedStyle(c).fontFamily,border:getComputedStyle(c).border,after:{content:getComputedStyle(c,'::after').content,width:getComputedStyle(c,'::after').width,height:getComputedStyle(c,'::after').height,bg:getComputedStyle(c,'::after').backgroundColor,border:getComputedStyle(c,'::after').border}}))}))"
}
```
- Result
```json
{
  "result": "[\n  {\n    \"label\": \"Part 1: Upright\",\n    \"buttonColor\": \"rgb(27, 36, 56)\",\n    \"border\": \"1px solid rgb(47, 107, 181)\",\n    \"children\": [\n      {\n        \"cls\": \"fan-part-shape\",\n        \"font\": \"\\\"IBM Plex Sans\\\", system-ui, sans-serif\",\n        \"border\": \"0px none rgb(27, 36, 56)\",\n        \"after\": {\n          \"content\": \"none\",\n          \"width\": \"auto\",\n          \"height\": \"auto\",\n          \"bg\": \"rgba(0, 0, 0, 0)\",\n          \"border\": \"0px none rgb(27, 36, 56)\"\n        }\n      },\n      {\n        \"cls\": \"fan-callout\",\n        \"font\": \"\\\"IBM Plex Mono\\\", \\\"Courier New\\\", monospace\",\n        \"border\": \"0px none rgb(47, 107, 181)\",\n        \"after\": {\n          \"content\": \"none\",\n          \"width\": \"auto\",\n          \"height\": \"auto\",\n          \"bg\": \"rgba(0, 0, 0, 0)\",\n          \"border\": \"0px none rgb(47, 107, 181)\"\n        }\n      }\n    ]\n  },\n  {\n    \"label\": \"Part 2: Shelf board\",\n    \"buttonColor\": \"rgb(27, 36, 56)\",\n    \"border\": \"1px solid rgb(47, 107, 181)\",\n    \"children\": [\n      {\n        \"cls\": \"fan-part-shape\",\n        \"font\": \"\\\"IBM Plex Sans\\\", system-ui, sans-serif\",\n        \"border\": \"0px none rgb(27, 36, 56)\",\n        \"after\": {\n          \"content\": \"none\",\n          \"width\": \"auto\",\n          \"height\": \"auto\",\n          \"bg\": \"rgba(0, 0, 0, 0)\",\n          \"border\": \"0px none rgb(27, 36, 56)\"\n        }\n      },\n      {\n        \"cls\": \"fan-callout\",\n        \"font\": \"\\\"IBM Plex Mono\\\", \\\"Courier New\\\", monospace\",\n        \"border\": \"0px none rgb(47, 107, 181)\",\n        \"after\": {\n          \"content\": \"none\",\n          \"width\": \"auto\",\n          \"height\": \"auto\",\n          \"bg\": \"rgba(0, 0, 0, 0)\",\n          \"border\": \"0px none rgb(47, 107, 181)\"\n        }\n      }\n    ]\n  },\n  {\n    \"label\": \"Part 3: Shelf pin\",\n    \"buttonColor\": \"rgb(27, 36, 56)\",\n    \"border\": \"1px solid rgb(47, 107, 181)\",\n    \"children\": [\n      {\n        \"cls\": \"fan-part-shape\",\n        \"font\": \"\\\"IBM Plex Sans\\\", system-ui, sans-serif\",\n        \"border\": \"0px none rgb(27, 36, 56)\",\n        \"after\": {\n          \"content\": \"none\",\n          \"width\": \"auto\",\n          \"height\": \"auto\",\n          \"bg\": \"rgba(0, 0, 0, 0)\",\n          \"border\": \"0px none rgb(27, 36, 56)\"\n        }\n      },\n      {\n        \"cls\": \"fan-callout\",\n        \"font\": \"\\\"IBM Plex Mono\\\", \\\"Courier New\\\", monospace\",\n        \"border\": \"0px none rgb(47, 107, 181)\",\n        \"after\": {\n          \"content\": \"none\",\n          \"width\": \"auto\",\n          \"height\": \"auto\",\n          \"bg\": \"rgba(0, 0, 0, 0)\",\n          \"border\": \"0px none rgb(47, 107, 181)\"\n        }\n      }\n    ]\n  },\n  {\n    \"label\": \"Part 4: Wall bracket\",\n    \"buttonColor\": \"rgb(27, 36, 56)\",\n    \"border\": \"1px solid rgb(47, 107, 181)\",\n    \"children\": [\n      {\n        \"cls\": \"fan-part-shape\",\n        \"font\": \"\\\"IBM Plex Sans\\\", system-ui, sans-serif\",\n        \"border\": \"0px none rgb(27, 36, 56)\",\n        \"after\": {\n          \"content\": \"none\",\n          \"width\": \"auto\",\n          \"height\": \"auto\",\n          \"bg\": \"rgba(0, 0, 0, 0)\",\n          \"border\": \"0px none rgb(27, 36, 56)\"\n        }\n      },\n      {\n        \"cls\": \"fan-callout\",\n        \"font\": \"\\\"IBM Plex Mono\\\", \\\"Courier New\\\", monospace\",\n        \"border\": \"0px none rgb(47, 107, 181)\",\n        \"after\": {\n          \"content\": \"none\",\n          \"width\": \"auto\",\n          \"height\": \"auto\",\n          \"bg\": \"rgba(0, 0, 0, 0)\",\n          \"border\": \"0px none rgb(47, 107, 181)\"\n        }\n      }\n    ]\n  },\n  {\n    \"label\": \"Part 5: Back brace\",\n    \"buttonColor\": \"rgb(27, 36, 56)\",\n    \"border\": \"1px solid rgb(47, 107, 181)\",\n    \"children\": [\n      {\n        \"cls\": \"fan-part-shape\",\n        \"font\": \"\\\"IBM Plex Sans\\\", system-ui, sans-serif\",\n        \"border\": \"0px none rgb(27, 36, 56)\",\n        \"after\": {\n          \"content\": \"none\",\n          \"width\": \"auto\",\n          \"height\": \"auto\",\n          \"bg\": \"rgba(0, 0, 0, 0)\",\n          \"border\": \"0px none rgb(27, 36, 56)\"\n        }\n      },\n      {\n        \"cls\": \"fan-callout\",\n        \"font\": \"\\\"IBM Plex Mono\\\", \\\"Courier New\\\", monospace\",\n        \"border\": \"0px none rgb(47, 107, 181)\",\n        \"after\": {\n          \"content\": \"none\",\n          \"width\": \"auto\",\n          \"height\": \"auto\",\n          \"bg\": \"rgba(0, 0, 0, 0)\",\n          \"border\": \"0px none rgb(47, 107, 181)\"\n        }\n      }\n    ]\n  }\n]"
}
```

### Tool call: browser_take_screenshot
- Args
```json
{
  "element": "Fitting fan",
  "target": "e56",
  "type": "png",
  "filename": "evidence/reduced-fan.png",
  "scale": "css"
}
```
- Result
```json
{
  "result": "- [Screenshot of Fitting fan](evidence/reduced-fan.png)"
}
```

### Tool call: browser_evaluate
- Args
```json
{
  "function": "() => [...document.querySelectorAll('.fan-callout')].map(c=>({text:c.textContent,html:c.outerHTML,background:getComputedStyle(c).backgroundImage,width:getComputedStyle(c).width,height:getComputedStyle(c).height,borderTop:getComputedStyle(c).borderTop,transform:getComputedStyle(c).transform,boxShadow:getComputedStyle(c).boxShadow}))"
}
```
- Result
```json
{
  "result": "[\n  {\n    \"text\": \"1\",\n    \"html\": \"<span class=\\\"fan-callout\\\" aria-hidden=\\\"true\\\">1</span>\",\n    \"background\": \"none\",\n    \"width\": \"8.15625px\",\n    \"height\": \"20.3906px\",\n    \"borderTop\": \"0px none rgb(47, 107, 181)\",\n    \"transform\": \"none\",\n    \"boxShadow\": \"none\"\n  },\n  {\n    \"text\": \"2\",\n    \"html\": \"<span class=\\\"fan-callout\\\" aria-hidden=\\\"true\\\">2</span>\",\n    \"background\": \"none\",\n    \"width\": \"8.15625px\",\n    \"height\": \"20.3906px\",\n    \"borderTop\": \"0px none rgb(47, 107, 181)\",\n    \"transform\": \"none\",\n    \"boxShadow\": \"none\"\n  },\n  {\n    \"text\": \"3\",\n    \"html\": \"<span class=\\\"fan-callout\\\" aria-hidden=\\\"true\\\">3</span>\",\n    \"background\": \"none\",\n    \"width\": \"8.15625px\",\n    \"height\": \"20.3906px\",\n    \"borderTop\": \"0px none rgb(47, 107, 181)\",\n    \"transform\": \"none\",\n    \"boxShadow\": \"none\"\n  },\n  {\n    \"text\": \"4\",\n    \"html\": \"<span class=\\\"fan-callout\\\" aria-hidden=\\\"true\\\">4</span>\",\n    \"background\": \"none\",\n    \"width\": \"8.15625px\",\n    \"height\": \"20.3906px\",\n    \"borderTop\": \"0px none rgb(47, 107, 181)\",\n    \"transform\": \"none\",\n    \"boxShadow\": \"none\"\n  },\n  {\n    \"text\": \"5\",\n    \"html\": \"<span class=\\\"fan-callout\\\" aria-hidden=\\\"true\\\">5</span>\",\n    \"background\": \"none\",\n    \"width\": \"8.15625px\",\n    \"height\": \"20.3906px\",\n    \"borderTop\": \"0px none rgb(47, 107, 181)\",\n    \"transform\": \"none\",\n    \"boxShadow\": \"none\"\n  }\n]"
}
```

### Tool call: browser_evaluate
- Args
```json
{
  "function": "() => [...document.querySelectorAll('.fan-callout')].map(c=>({text:c.textContent,before:{content:getComputedStyle(c,'::before').content,width:getComputedStyle(c,'::before').width,height:getComputedStyle(c,'::before').height,bg:getComputedStyle(c,'::before').backgroundColor,border:getComputedStyle(c,'::before').border,position:getComputedStyle(c,'::before').position}}))"
}
```
- Result
```json
{
  "result": "[\n  {\n    \"text\": \"1\",\n    \"before\": {\n      \"content\": \"none\",\n      \"width\": \"auto\",\n      \"height\": \"auto\",\n      \"bg\": \"rgba(0, 0, 0, 0)\",\n      \"border\": \"0px none rgb(47, 107, 181)\",\n      \"position\": \"static\"\n    }\n  },\n  {\n    \"text\": \"2\",\n    \"before\": {\n      \"content\": \"none\",\n      \"width\": \"auto\",\n      \"height\": \"auto\",\n      \"bg\": \"rgba(0, 0, 0, 0)\",\n      \"border\": \"0px none rgb(47, 107, 181)\",\n      \"position\": \"static\"\n    }\n  },\n  {\n    \"text\": \"3\",\n    \"before\": {\n      \"content\": \"none\",\n      \"width\": \"auto\",\n      \"height\": \"auto\",\n      \"bg\": \"rgba(0, 0, 0, 0)\",\n      \"border\": \"0px none rgb(47, 107, 181)\",\n      \"position\": \"static\"\n    }\n  },\n  {\n    \"text\": \"4\",\n    \"before\": {\n      \"content\": \"none\",\n      \"width\": \"auto\",\n      \"height\": \"auto\",\n      \"bg\": \"rgba(0, 0, 0, 0)\",\n      \"border\": \"0px none rgb(47, 107, 181)\",\n      \"position\": \"static\"\n    }\n  },\n  {\n    \"text\": \"5\",\n    \"before\": {\n      \"content\": \"none\",\n      \"width\": \"auto\",\n      \"height\": \"auto\",\n      \"bg\": \"rgba(0, 0, 0, 0)\",\n      \"border\": \"0px none rgb(47, 107, 181)\",\n      \"position\": \"static\"\n    }\n  }\n]"
}
```

### Tool call: browser_evaluate
- Args
```json
{
  "function": "() => [...document.querySelectorAll('.fan-part')].map(b=>({label:b.getAttribute('aria-label'),line:{content:getComputedStyle(b,'::before').content,width:getComputedStyle(b,'::before').width,height:getComputedStyle(b,'::before').height,bg:getComputedStyle(b,'::before').backgroundColor},number:{text:b.querySelector('.fan-callout')?.textContent,font:getComputedStyle(b.querySelector('.fan-callout')).fontFamily}}))"
}
```
- Result
```json
{
  "result": "[\n  {\n    \"label\": \"Part 1: Upright\",\n    \"line\": {\n      \"content\": \"\\\"\\\"\",\n      \"width\": \"1px\",\n      \"height\": \"14px\",\n      \"bg\": \"rgb(47, 107, 181)\"\n    },\n    \"number\": {\n      \"text\": \"1\",\n      \"font\": \"\\\"IBM Plex Mono\\\", \\\"Courier New\\\", monospace\"\n    }\n  },\n  {\n    \"label\": \"Part 2: Shelf board\",\n    \"line\": {\n      \"content\": \"\\\"\\\"\",\n      \"width\": \"1px\",\n      \"height\": \"14px\",\n      \"bg\": \"rgb(47, 107, 181)\"\n    },\n    \"number\": {\n      \"text\": \"2\",\n      \"font\": \"\\\"IBM Plex Mono\\\", \\\"Courier New\\\", monospace\"\n    }\n  },\n  {\n    \"label\": \"Part 3: Shelf pin\",\n    \"line\": {\n      \"content\": \"\\\"\\\"\",\n      \"width\": \"1px\",\n      \"height\": \"14px\",\n      \"bg\": \"rgb(47, 107, 181)\"\n    },\n    \"number\": {\n      \"text\": \"3\",\n      \"font\": \"\\\"IBM Plex Mono\\\", \\\"Courier New\\\", monospace\"\n    }\n  },\n  {\n    \"label\": \"Part 4: Wall bracket\",\n    \"line\": {\n      \"content\": \"\\\"\\\"\",\n      \"width\": \"1px\",\n      \"height\": \"14px\",\n      \"bg\": \"rgb(47, 107, 181)\"\n    },\n    \"number\": {\n      \"text\": \"4\",\n      \"font\": \"\\\"IBM Plex Mono\\\", \\\"Courier New\\\", monospace\"\n    }\n  },\n  {\n    \"label\": \"Part 5: Back brace\",\n    \"line\": {\n      \"content\": \"\\\"\\\"\",\n      \"width\": \"1px\",\n      \"height\": \"14px\",\n      \"bg\": \"rgb(47, 107, 181)\"\n    },\n    \"number\": {\n      \"text\": \"5\",\n      \"font\": \"\\\"IBM Plex Mono\\\", \\\"Courier New\\\", monospace\"\n    }\n  }\n]"
}
```
