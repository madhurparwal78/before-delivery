
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
  "url": "http://127.0.0.1:4173/models/survey-lantern"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/models/survey-lantern\n- Page Title: Survey Lantern · Turnstone Studio",
  "snapshot": "- generic [active] [ref=e1]:\n  - banner [ref=e2]:\n    - generic [ref=e3]:\n      - link \"Turnstone Studio\" [ref=e4] [cursor=pointer]:\n        - /url: /catalogue\n      - navigation \"Catalogue\" [ref=e5]:\n        - link \"Catalogue\" [ref=e6] [cursor=pointer]:\n          - /url: /catalogue\n        - generic [ref=e7]:\n          - generic [ref=e8]: Language\n          - combobox \"Language\" [ref=e9]:\n            - option \"English\" [selected]\n            - option \"Deutsch\"\n        - link \"Sign in\" [ref=e10] [cursor=pointer]:\n          - /url: /sign-in\n  - main [ref=e11]:\n    - article [ref=e12]:\n      - heading \"Survey Lantern\" [level=1] [ref=e13]\n      - generic [ref=e14]:\n        - generic [ref=e15]:\n          - group \"Model viewer\" [ref=e16]:\n            - img \"Survey Ring\":\n              - generic:\n                - generic: \"0\"\n                - generic: \"30\"\n                - generic: \"60\"\n                - generic: \"90\"\n                - generic: \"120\"\n                - generic: \"150\"\n                - generic: \"180\"\n                - generic: \"210\"\n                - generic: \"240\"\n                - generic: \"270\"\n                - generic: \"300\"\n                - generic: \"330\"\n          - generic [ref=e19]:\n            - button \"Previous hotspot\" [ref=e20] [cursor=pointer]\n            - button \"Next hotspot\" [ref=e21] [cursor=pointer]\n            - button \"First-person view\" [ref=e22] [cursor=pointer]\n            - button \"Reset view\" [ref=e23] [cursor=pointer]\n          - status [ref=e24]\n          - group \"Camera readout\" [ref=e25]:\n            - paragraph [ref=e26]: Distance 204.0 mm\n            - paragraph [ref=e27]: FOV 35.0°\n            - paragraph [ref=e28]: Tilt 20.0°\n            - paragraph [ref=e29]: Azimuth 30.0°\n        - generic [ref=e30]:\n          - region [ref=e31]:\n            - heading \"Licences\" [level=2] [ref=e32]\n            - table \"Licences\" [ref=e33]:\n              - rowgroup [ref=e34]:\n                - row [ref=e35]:\n                  - columnheader \"Licence\" [ref=e36]\n                  - columnheader \"seats\" [ref=e37]\n                  - columnheader \"Price\" [ref=e38]\n                  - columnheader \"Buy\" [ref=e39]\n              - rowgroup [ref=e40]:\n                - row [ref=e41]:\n                  - cell \"Personal licence\" [ref=e42]\n                  - cell \"1\" [ref=e43]\n                  - cell \"€18.37\" [ref=e44]\n                  - cell [ref=e45]:\n                    - button \"Buy Personal licence\" [ref=e46] [cursor=pointer]\n                - row [ref=e47]:\n                  - cell \"Commercial licence\" [ref=e48]\n                  - cell \"1\" [ref=e49]\n                  - cell \"€55.11\" [ref=e50]\n                  - cell [ref=e51]:\n                    - button \"Buy Commercial licence\" [ref=e52] [cursor=pointer]\n                - row [ref=e53]:\n                  - cell \"Studio licence\" [ref=e54]\n                  - cell \"3\" [ref=e55]\n                  - cell \"€146.95\" [ref=e56]\n                  - cell [ref=e57]:\n                    - button \"Buy Studio licence\" [ref=e58] [cursor=pointer]\n          - region [ref=e59]:\n            - heading \"Specifications\" [level=2] [ref=e60]\n            - table \"Specifications\" [ref=e61]:\n              - rowgroup [ref=e62]:\n                - row [ref=e63]:\n                  - rowheader \"Dimensions (W × H × D)\" [ref=e64]\n                  - cell \"80 × 120 × 90 mm\" [ref=e65]\n                - row [ref=e66]:\n                  - rowheader \"Formats\" [ref=e67]\n                  - cell \"GLB, STL\" [ref=e68]\n                - row [ref=e69]:\n                  - rowheader \"Figure scale\" [ref=e70]\n                  - cell \"1:1\" [ref=e71]\n      - region [ref=e72]:\n        - heading \"More from the workshop\" [level=2] [ref=e73]\n        - list \"More from the workshop\" [ref=e74]:\n          - listitem [ref=e75]:\n            - link \"Basalt Warden from €12.00\" [ref=e76] [cursor=pointer]:\n              - /url: /models/basalt-warden\n              - generic [ref=e77]: Basalt Warden\n              - generic [ref=e78]: from €12.00\n          - listitem [ref=e79]:\n            - link \"Workshop Piece 40 from €19.80\" [ref=e80] [cursor=pointer]:\n              - /url: /models/workshop-piece-40\n              - generic [ref=e81]: Workshop Piece 40\n              - generic [ref=e82]: from €19.80\n          - listitem [ref=e83]:\n            - link \"Workshop Piece 39 from €19.43\" [ref=e84] [cursor=pointer]:\n              - /url: /models/workshop-piece-39\n              - generic [ref=e85]: Workshop Piece 39\n              - generic [ref=e86]: from €19.43\n          - listitem [ref=e87]:\n            - link \"Workshop Piece 38 from €19.06\" [ref=e88] [cursor=pointer]:\n              - /url: /models/workshop-piece-38\n              - generic [ref=e89]: Workshop Piece 38\n              - generic [ref=e90]: from €19.06"
}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "Tab"
}
```
- Result
```json
{}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "Tab"
}
```
- Result
```json
{}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "Tab"
}
```
- Result
```json
{}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "Tab"
}
```
- Result
```json
{}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "Tab"
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
  "function": "() => ({active:{tag:document.activeElement?.tagName,aria:document.activeElement?.getAttribute('aria-label'),text:document.activeElement?.textContent?.trim()},render:document.querySelector('[role=\"group\"][aria-label=\"Model viewer\"]')?.getAttribute('data-render')})"
}
```
- Result
```json
{
  "result": "{\n  \"active\": {\n    \"tag\": \"DIV\",\n    \"aria\": \"Model viewer\",\n    \"text\": \"0\\n            30\\n            60\\n            90\\n            120\\n            150\\n            180\\n            210\\n            240\\n            270\\n            300\\n            330\"\n  },\n  \"render\": \"webgl\"\n}"
}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "ArrowRight"
}
```
- Result
```json
{}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "ArrowRight"
}
```
- Result
```json
{}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "H"
}
```
- Result
```json
{}
```

### Tool call: browser_take_screenshot
- Args
```json
{
  "element": "reduced-motion viewer and ring after ArrowRight twice and H",
  "target": "[role='group'][aria-label='Model viewer']",
  "type": "png",
  "scale": "css"
}
```
- Result
```json
{
  "result": "- [Screenshot of reduced-motion viewer and ring after ArrowRight twice and H](evidence/reduced/element-2026-11-05T12-45-04-175Z.png)",
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
  "function": "() => { const ring=document.querySelector('[role=\"img\"][aria-label=\"Survey Ring\"]'); const vals=sel=>[...ring.querySelectorAll(sel)].map(e=>{const s=getComputedStyle(e);return {part:e.getAttribute('data-part'),active:e.getAttribute('data-active'),fill:s.fill,stroke:s.stroke,display:s.display,tag:e.tagName}}); return {render:ring.closest('[role=\"group\"]')?.getAttribute('data-render'),index:vals('[data-part=\"index-mark\"]'),caliper:vals('[data-part=\"caliper\"]'),hotspots:vals('[data-part=\"hotspot-dot\"]'),ticks:vals('[data-azimuth-tick]').slice(0,3),labels:vals('text').slice(0,3),circle:vals('circle:not([data-part])'),tilt:vals('[data-part=\"tilt-marker\"]')}; }"
}
```
- Result
```json
{
  "result": "{\n  \"render\": \"webgl\",\n  \"index\": [\n    {\n      \"part\": \"index-mark\",\n      \"active\": null,\n      \"fill\": \"rgb(0, 0, 0)\",\n      \"stroke\": \"none\",\n      \"display\": \"inline\",\n      \"tag\": \"g\"\n    }\n  ],\n  \"caliper\": [\n    {\n      \"part\": \"caliper\",\n      \"active\": null,\n      \"fill\": \"rgb(0, 0, 0)\",\n      \"stroke\": \"rgb(208, 68, 46)\",\n      \"display\": \"inline\",\n      \"tag\": \"line\"\n    }\n  ],\n  \"hotspots\": [\n    {\n      \"part\": \"hotspot-dot\",\n      \"active\": \"true\",\n      \"fill\": \"rgb(208, 68, 46)\",\n      \"stroke\": \"rgb(208, 68, 46)\",\n      \"display\": \"inline\",\n      \"tag\": \"circle\"\n    },\n    {\n      \"part\": \"hotspot-dot\",\n      \"active\": null,\n      \"fill\": \"rgb(244, 240, 230)\",\n      \"stroke\": \"rgb(168, 159, 140)\",\n      \"display\": \"inline\",\n      \"tag\": \"circle\"\n    },\n    {\n      \"part\": \"hotspot-dot\",\n      \"active\": null,\n      \"fill\": \"rgb(244, 240, 230)\",\n      \"stroke\": \"rgb(168, 159, 140)\",\n      \"display\": \"inline\",\n      \"tag\": \"circle\"\n    }\n  ],\n  \"ticks\": [\n    {\n      \"part\": null,\n      \"active\": null,\n      \"fill\": \"rgb(0, 0, 0)\",\n      \"stroke\": \"rgb(26, 36, 51)\",\n      \"display\": \"inline\",\n      \"tag\": \"line\"\n    },\n    {\n      \"part\": null,\n      \"active\": null,\n      \"fill\": \"rgb(0, 0, 0)\",\n      \"stroke\": \"rgb(75, 85, 99)\",\n      \"display\": \"inline\",\n      \"tag\": \"line\"\n    },\n    {\n      \"part\": null,\n      \"active\": null,\n      \"fill\": \"rgb(0, 0, 0)\",\n      \"stroke\": \"rgb(75, 85, 99)\",\n      \"display\": \"inline\",\n      \"tag\": \"line\"\n    }\n  ],\n  \"labels\": [\n    {\n      \"part\": null,\n      \"active\": null,\n      \"fill\": \"rgb(75, 85, 99)\",\n      \"stroke\": \"none\",\n      \"display\": \"block\",\n      \"tag\": \"text\"\n    },\n    {\n      \"part\": null,\n      \"active\": null,\n      \"fill\": \"rgb(75, 85, 99)\",\n      \"stroke\": \"none\",\n      \"display\": \"block\",\n      \"tag\": \"text\"\n    },\n    {\n      \"part\": null,\n      \"active\": null,\n      \"fill\": \"rgb(75, 85, 99)\",\n      \"stroke\": \"none\",\n      \"display\": \"block\",\n      \"tag\": \"text\"\n    }\n  ],\n  \"circle\": [],\n  \"tilt\": [\n    {\n      \"part\": \"tilt-marker\",\n      \"active\": null,\n      \"fill\": \"rgb(0, 0, 0)\",\n      \"stroke\": \"none\",\n      \"display\": \"inline\",\n      \"tag\": \"g\"\n    }\n  ]\n}"
}
```

### Tool call: browser_evaluate
- Args
```json
{
  "function": "() => { const r=document.querySelector('[role=\"img\"][aria-label=\"Survey Ring\"]'); const one=sel=>[...r.querySelectorAll(sel)].flatMap(e=>[e,...e.querySelectorAll('*')]).filter(e=>e.tagName!=='g').map(e=>{const s=getComputedStyle(e);return {tag:e.tagName,cls:e.getAttribute('class'),fill:s.fill,stroke:s.stroke}}); return {index:one('[data-part=\"index-mark\"]'),tilt:one('[data-part=\"tilt-marker\"]'),ring:one('.ring-circle')}; }"
}
```
- Result
```json
{
  "result": "{\n  \"index\": [\n    {\n      \"tag\": \"line\",\n      \"cls\": \"index-line\",\n      \"fill\": \"rgb(0, 0, 0)\",\n      \"stroke\": \"rgb(208, 68, 46)\"\n    }\n  ],\n  \"tilt\": [\n    {\n      \"tag\": \"line\",\n      \"cls\": \"tilt-line\",\n      \"fill\": \"rgb(0, 0, 0)\",\n      \"stroke\": \"rgb(208, 68, 46)\"\n    }\n  ],\n  \"ring\": []\n}"
}
```

### Tool call: browser_evaluate
- Args
```json
{
  "function": "() => document.querySelector('[role=\"img\"][aria-label=\"Survey Ring\"]')?.outerHTML.slice(-1400)"
}
```
- Result
```json
{
  "result": "\"ext-anchor=\\\"middle\\\">210</text>\\n            <text class=\\\"tick-label\\\" x=\\\"60.8\\\" y=\\\"205.5\\\" text-anchor=\\\"middle\\\">240</text>\\n            <text class=\\\"tick-label\\\" x=\\\"47.0\\\" y=\\\"154.0\\\" text-anchor=\\\"middle\\\">270</text>\\n            <text class=\\\"tick-label\\\" x=\\\"60.8\\\" y=\\\"102.5\\\" text-anchor=\\\"middle\\\">300</text>\\n            <text class=\\\"tick-label\\\" x=\\\"98.5\\\" y=\\\"64.8\\\" text-anchor=\\\"middle\\\">330</text>\\n          </g>\\n          <path data-part=\\\"tilt-arc\\\" class=\\\"tilt-arc\\\" d=\\\"M 278 150 A 128 128 0 0 1 262 200\\\"></path>\\n          <g data-part=\\\"index-mark\\\" data-angle=\\\"90.0\\\" class=\\\"index-mark\\\" transform=\\\"rotate(90 150 150)\\\">\\n            <line x1=\\\"0\\\" y1=\\\"-132\\\" x2=\\\"0\\\" y2=\\\"-118\\\" class=\\\"index-line\\\"></line>\\n          </g>\\n          <g data-part=\\\"tilt-marker\\\" data-angle=\\\"20.0\\\" class=\\\"tilt-marker\\\" transform=\\\"translate(193.8,29.7) rotate(-70.0)\\\">\\n            <line x1=\\\"-6\\\" y1=\\\"0\\\" x2=\\\"6\\\" y2=\\\"0\\\" class=\\\"tilt-line\\\"></line>\\n          </g>\\n          <line data-part=\\\"caliper\\\" class=\\\"caliper\\\" x1=\\\"695.5\\\" y1=\\\"298.0\\\" x2=\\\"397.5\\\" y2=\\\"34.2\\\"></line>\\n              <circle data-part=\\\"hotspot-dot\\\" data-index=\\\"1\\\" r=\\\"4\\\" class=\\\"hotspot-dot\\\" cx=\\\"397.5\\\" cy=\\\"34.2\\\" data-active=\\\"true\\\"></circle>\\n              <circle data-part=\\\"hotspot-dot\\\" data-index=\\\"2\\\" r=\\\"4\\\" class=\\\"hotspot-dot\\\" cx=\\\"397.5\\\" cy=\\\"375.7\\\"></circle>\\n              <circle data-part=\\\"hotspot-dot\\\" data-index=\\\"3\\\" r=\\\"4\\\" class=\\\"hotspot-dot\\\" cx=\\\"299.5\\\" cy=\\\"578.5\\\"></circle>\\n        </svg>\""
}
```
