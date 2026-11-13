
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
  "page": "- Page URL: http://127.0.0.1:4173/claim/new\n- Page Title: Claim a part",
  "snapshot": "- generic [active] [ref=e1]:\n  - link \"Skip to claim\" [ref=e2] [cursor=pointer]:\n    - /url: \"#desk-main\"\n  - banner [ref=e3]:\n    - link \"Holmgarth Aftercare\" [ref=e4] [cursor=pointer]:\n      - /url: /\n    - radiogroup \"Language · Język\" [ref=e5]:\n      - generic [ref=e6]:\n        - radio \"English\" [checked] [ref=e7]\n        - generic [ref=e8]: English\n      - generic [ref=e9]:\n        - radio \"Polski\" [ref=e10]\n        - generic [ref=e11]: Polski\n  - main [ref=e12]:\n    - generic [ref=e13]:\n      - heading \"Claim a part\" [level=1] [ref=e14]\n      - generic [ref=e15]:\n        - region \"Fitting fan\" [ref=e16]:\n          - slider \"Separate parts\" [ref=e17]: \"100\"\n          - generic [ref=e18]:\n            - 'button \"Part 1: Side panel\" [ref=e19] [cursor=pointer]':\n              - generic [aria-hidden]:\n                - generic: \"1\"\n            - 'button \"Part 2: Top panel\" [ref=e20] [cursor=pointer]':\n              - generic [aria-hidden]:\n                - generic: \"2\"\n            - 'button \"Part 3: Shelf\" [ref=e21] [cursor=pointer]':\n              - generic [aria-hidden]:\n                - generic: \"3\"\n            - 'button \"Part 4: Hanging rail\" [ref=e22] [cursor=pointer]':\n              - generic [aria-hidden]:\n                - generic: \"4\"\n            - 'button \"Part 5: Cam lock\" [ref=e23] [cursor=pointer]':\n              - generic [aria-hidden]:\n                - generic: \"5\"\n            - 'button \"Part 6: Cam bolt\" [ref=e24] [cursor=pointer]':\n              - generic [aria-hidden]:\n                - generic: \"6\"\n        - generic [ref=e25]:\n          - generic [ref=e26]:\n            - generic [ref=e27]: Model\n            - combobox \"Model\" [ref=e28]:\n              - option \"Aldra Wardrobe\" [selected]\n              - option \"Bramwell Sofa Frame\"\n              - option \"Kestle Shelving Unit\"\n              - option \"Fenwick Bed Frame\"\n          - generic [ref=e29]:\n            - generic [ref=e30]: Your name\n            - textbox \"Your name\" [ref=e31]\n          - generic [ref=e32]:\n            - generic [ref=e33]: Email\n            - textbox \"Email\" [ref=e34]\n          - generic [ref=e35]:\n            - generic [ref=e36]: Postcode\n            - textbox \"Postcode\" [ref=e37]\n          - generic [ref=e38]:\n            - generic [ref=e39]: Date of purchase\n            - textbox \"Date of purchase\" [ref=e40]\n          - generic [ref=e41]:\n            - generic [ref=e42]: Quantity\n            - spinbutton \"Quantity\" [ref=e43]: \"1\"\n          - generic [ref=e44]:\n            - generic [ref=e45]: What happened\n            - textbox \"What happened\" [ref=e46]\n          - generic [ref=e47]:\n            - generic [ref=e48]: Damage photos\n            - button \"Damage photos\" [ref=e49]\n          - region \"Carriage estimate\" [ref=e50]:\n            - button \"Estimate carriage\" [ref=e51] [cursor=pointer]\n          - button \"Start claim\" [ref=e52] [cursor=pointer]"
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
  "page": "- Page URL: http://127.0.0.1:4173/claim/new\n- Page Title: Claim a part",
  "inlineSnapshot": "- generic [active] [ref=e1]:\n  - link \"Skip to claim\" [ref=e2] [cursor=pointer]:\n    - /url: \"#desk-main\"\n  - banner [ref=e3]:\n    - link \"Holmgarth Aftercare\" [ref=e4] [cursor=pointer]:\n      - /url: /\n    - radiogroup \"Language · Język\" [ref=e5]:\n      - generic [ref=e6]:\n        - radio \"English\" [checked] [ref=e7]\n        - generic [ref=e8]: English\n      - generic [ref=e9]:\n        - radio \"Polski\" [ref=e10]\n        - generic [ref=e11]: Polski\n  - main [ref=e12]:\n    - generic [ref=e13]:\n      - heading \"Claim a part\" [level=1] [ref=e14]\n      - generic [ref=e15]:\n        - region \"Fitting fan\" [ref=e16]:\n          - slider \"Separate parts\" [ref=e17]: \"100\"\n          - generic [ref=e18]\n        - generic [ref=e25]:\n          - generic [ref=e26]\n          - generic [ref=e29]\n          - generic [ref=e32]\n          - generic [ref=e35]\n          - generic [ref=e38]\n          - generic [ref=e41]\n          - generic [ref=e44]\n          - generic [ref=e47]\n          - region \"Carriage estimate\" [ref=e50]\n          - button \"Start claim\" [ref=e52] [cursor=pointer]"
}
```

### Tool call: browser_fill_form
- Args
```json
{
  "fields": [
    {
      "target": "select[name=\"model\"]",
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
  "depth": 6
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/claim/new\n- Page Title: Claim a part",
  "inlineSnapshot": "- generic [active] [ref=e1]:\n  - link \"Skip to claim\" [ref=e2] [cursor=pointer]:\n    - /url: \"#desk-main\"\n  - banner [ref=e3]:\n    - link \"Holmgarth Aftercare\" [ref=e4] [cursor=pointer]:\n      - /url: /\n    - radiogroup \"Language · Język\" [ref=e5]:\n      - generic [ref=e6]:\n        - radio \"English\" [checked] [ref=e7]\n        - generic [ref=e8]: English\n      - generic [ref=e9]:\n        - radio \"Polski\" [ref=e10]\n        - generic [ref=e11]: Polski\n  - main [ref=e12]:\n    - generic [ref=e13]:\n      - heading \"Claim a part\" [level=1] [ref=e14]\n      - generic [ref=e15]:\n        - region \"Fitting fan\" [ref=e53]:\n          - slider \"Separate parts\" [ref=e54]: \"100\"\n          - generic [ref=e55]:\n            - 'button \"Part 1: Upright\" [ref=e56] [cursor=pointer]'\n            - 'button \"Part 2: Shelf board\" [ref=e57] [cursor=pointer]'\n            - 'button \"Part 3: Shelf pin\" [ref=e58] [cursor=pointer]'\n            - 'button \"Part 4: Wall bracket\" [ref=e59] [cursor=pointer]'\n            - 'button \"Part 5: Back brace\" [disabled] [ref=e60]'\n        - generic [ref=e25]:\n          - generic [ref=e26]:\n            - generic [ref=e27]: Model\n            - combobox \"Model\" [ref=e28]\n          - generic [ref=e29]:\n            - generic [ref=e30]: Your name\n            - textbox \"Your name\" [ref=e31]\n          - generic [ref=e32]:\n            - generic [ref=e33]: Email\n            - textbox \"Email\" [ref=e34]\n          - generic [ref=e35]:\n            - generic [ref=e36]: Postcode\n            - textbox \"Postcode\" [ref=e37]\n          - generic [ref=e38]:\n            - generic [ref=e39]: Date of purchase\n            - textbox \"Date of purchase\" [ref=e40]\n          - generic [ref=e41]:\n            - generic [ref=e42]: Quantity\n            - spinbutton \"Quantity\" [ref=e43]: \"1\"\n          - generic [ref=e44]:\n            - generic [ref=e45]: What happened\n            - textbox \"What happened\" [ref=e46]\n          - generic [ref=e47]:\n            - generic [ref=e48]: Damage photos\n            - button \"Damage photos\" [ref=e49]\n          - region \"Carriage estimate\" [ref=e50]:\n            - button \"Estimate carriage\" [ref=e51] [cursor=pointer]\n          - button \"Start claim\" [ref=e52] [cursor=pointer]"
}
```

### Tool call: browser_evaluate
- Args
```json
{
  "function": "() => { const r=document.querySelector('[aria-label=\"Fitting fan\"]'); const s=getComputedStyle(r); const buttons=[...r.querySelectorAll('button')]; return {backgroundImage:s.backgroundImage,backgroundSize:s.backgroundSize,buttons:buttons.map(b=>({name:b.getAttribute('aria-label'),disabled:b.getAttribute('aria-disabled'),line:getComputedStyle(b.querySelector('.fan-callout-line')).width,numFont:getComputedStyle(b.querySelector('.fan-callout-number')).fontFamily}))} }"
}
```
- Result
```json
{
  "result": "{\n  \"backgroundImage\": \"linear-gradient(to right, rgba(143, 169, 205, 0.25) 1px, rgba(0, 0, 0, 0) 1px), linear-gradient(rgba(143, 169, 205, 0.25) 1px, rgba(0, 0, 0, 0) 1px)\",\n  \"backgroundSize\": \"8px 8px, 8px 8px\",\n  \"buttons\": [\n    {\n      \"name\": \"Part 1: Upright\",\n      \"disabled\": null,\n      \"line\": \"1px\",\n      \"numFont\": \"\\\"IBM Plex Mono\\\", ui-monospace, monospace\"\n    },\n    {\n      \"name\": \"Part 2: Shelf board\",\n      \"disabled\": null,\n      \"line\": \"1px\",\n      \"numFont\": \"\\\"IBM Plex Mono\\\", ui-monospace, monospace\"\n    },\n    {\n      \"name\": \"Part 3: Shelf pin\",\n      \"disabled\": null,\n      \"line\": \"1px\",\n      \"numFont\": \"\\\"IBM Plex Mono\\\", ui-monospace, monospace\"\n    },\n    {\n      \"name\": \"Part 4: Wall bracket\",\n      \"disabled\": null,\n      \"line\": \"1px\",\n      \"numFont\": \"\\\"IBM Plex Mono\\\", ui-monospace, monospace\"\n    },\n    {\n      \"name\": \"Part 5: Back brace\",\n      \"disabled\": \"true\",\n      \"line\": \"1px\",\n      \"numFont\": \"\\\"IBM Plex Mono\\\", ui-monospace, monospace\"\n    }\n  ]\n}"
}
```

### Tool call: browser_take_screenshot
- Args
```json
{
  "element": "Fitting fan",
  "target": "[aria-label=\"Fitting fan\"]",
  "scale": "css"
}
```
- Result
```json
{
  "result": "- [Screenshot of Fitting fan](evidence/reduced/element-2026-11-06T03-48-31-942Z.png)",
  "attachments": [
    {
      "type": "image",
      "data": "iVBORw0KGgoAAAANSUhEUgAAAwcAAAG/CAIAAACCPDwpAAAQAElEQVR4nOzdfWzcd33A8d/52Y4T5zlN47RrSEJT2qpt2lIojGoVD2MdT2JiT0ITmwSjCG2TJpAY8AcSY5rGEJq2wR4k2BADiQGFjZWHrRsPhdKKrg9LWtL0IU9N6iR27PjZd/t97JzrxOfzw93Z57vXW5Dar/vlHHyV+ebu44+b/vJLDyWSJEl1X1P631des2FrV0suSTJJMvPXU32jnHPOOef14F+//2ScilLasbmt4KGJc84557xOvCGRJEnS1CtoSSZT+EbOOeec87rxOBXlcrmCF3POOeec14/HqWiOExTnnHPOeR25uSJJkqTIXBHnnHPOeRSnolO9I1OvrWVmfR8/55xzznk9+IVTkX1FnHPOOefmiiRJkiJzRZxzzjnnkX1FnHPOOeeRfUWcc84555G5IkmSpMhcEeecc855ZF8R55xzznn+VGRfEeecc865uSJJkqTIXBHnnHPOeWRfEeecc855ZF8R55xzznlkrkiSJCkyV8Q555xzHtlXxDnnnHOePxXZV8Q555xzbq5IkiQpMlfEOeeccx7ZV8Q555xzHtlXxDnnnHMemSuSJEmKzBVxzjnnnEf2FXHOOed8tfrZ/pFHD595/uxQ+nZ7W8vtL9uyfm3r0u4/sa+Ic84556vRT58b+euvHbjnh8/N9L//RvKm269471v2bVrXuoT7b0okSZJWVY8ePvvBz/z0VO/w7JvSc9KPHz/1iXffct2uDckim5y29voi55xzzleJ9w6MznUkmiq9Kb0gfTJpsfdf6r6ihw6c+JdvPXT8RM9ENptIkiRVuFMjnf1jbfNc0zucvr724XfekCzmnFPSvqL0SPTJf7z35FBH//iGbG6uyyVJkpa79KW0qQGjhZ9zStpXlD5LlB6J+sbaHIkkSVK19eDBnkVdX9JcUfrCWf94ayJJklR9Hes5H/9Ynn1FkiRJVVvf4PixnuFl2ld0+fbNJ4cG++abeJIkSVr+rrmia+rEssBzTklzRb/+y/u3tQ92NQ83ZDxzJEmSqqubr968qOtL+jlo+/dt/6N3vd535kuSpGVrId+Zn/am26+4sOF62fYVpQej/fvumnr7aM9wd6FnqDjnnHPOy+WPPdP3gb/5SZEtjmlb17e99y37pt5e+DknXkFb8r4izjnnnPNl9g2drZ949y3puWeO2+NIlF4w/aPQlmlfkSRJ0vJ33a4Nn//Qa9LXyGbflGJ60xJ+CFpS4lwR55xzzvmKePpU0IffeUP6MtmDB3um9hK1t7W87ubt008RLeH+S9pXxDnnnHO+sn7trk0v27VpyodHc0d7hpd2P0mJ+4o455xzzmvGzRVJkiRF5oo455xzzqNS9xVxzjnnnNeGx6lojhMU55xzznkdubkiSZKkyFwR55xzznlkXxHnnHPOef5UZF8R55xzzrm5IkmSpMhcEeecc855ZF8R55xzznlkXxHnnHPOeWSuSJIkKTJXxDnnnHMe2VfEOeecc54/FdlXxDnnnHNurkiSJCkyV8Q555xzHtlXxDnnnHMe2VfEOeeccx6ZK5IkSYrMFXHOOeecR/YVcc4555znT0X2FXHOOeecmyuSJEmKzBVxzjnnnEf2FXHOOeecR/YVcc4555xH5ookSZIic0Wcc84555F9RZxzzjnn+VORfUWcc8455+aKJEmSInNFnHPOOeeRfUWcc84555F9RZxzzjnnkbkiSZKkyFwR55xzznlkXxHnnHPOef5UZF8R55xzzrm5IkmSpMhcEeecc855ZF8R55xzznlkXxHnnHPOeWSuSJIkKTJXxDnnnHMe2VfEOeecc54/FdlXxDnnnHNurkiSJCkyV8Q555xzHtlXxDnnnHMe2VfEOeeccx6ZK5IkSYrMFXHOOeecR/YVcc4555znT0X2FXHOOeecmyuSJEmKzBVxzjnnnEf2FXHOOeecR/YVcc4555xH5ookSZIic0Wcc84555F9RZxzzjnn+VORfUWcc8455+aKJEmSInNFnHPOOeeRfUWcc84555F9RZxzzjnnkbkiSZKkyFwR55xzznlkXxHnnHPOef5UZF8R55xzzrm5IkmSpMhcEeecc855ZF8R55xzznlkXxHnnHPOeWSuSJIkKTJXxDnnnHMe2VfEOeecc54/FdlXxDnnnHNurkiSJCkyV8Q555xzHtlXxDnnnHMe2VfEOeeccx6ZK5IkSYrMFXHOOeecR/YVcc4555znT0X2FXHOOeecmyuSJEmKzBVxzjnnPOGJfUWcc84551PZV8Q555xzHpkrkiRJiswVcc4555xH9hVxznn9+omzI30DI+vWtPj8cJ7YV8Q55/XsE9nc4eN911y5rsT74bw23FyR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iHPOOec8sq+Ic8455zx/KrKviHPOOefcXJEkSVJkrohzzjnnPLKviHPOOec8sq+Ic8455zwyVyRJkhSZK+Kcc845j+wr4pxzzjnPn4rsK+Kcc845N1ckSZIUmSvinHPOOY/sK+Kcc845j+wr4pxzzjmPzBVJkiRF5oo455xzziP7ijjnnHPO86ci+4o455xzzs0VSZIkReaKOOecc84j+4o455xzziP7ijjnnHPOI3NFkiRJkbkizjnnnPPIviLOOeec8/ypyL4izjnnnHNzRZIkSZG5Is4555zzyL4izjnnnPPIviLOOeec88hckSRJUmSuiHPOOec8sq+Ic8455zx/KrKviHPOOefcXJEkSVJkrohzzjnnPLKviHPOOec8sq+Ic8455zwyVyRJkhSZK+Kcc845j+wr4pxzzjnPn4rsK+Kcc845N1ckSZIUmSvinHPOOY/sK+Kcc845j+wr4pxzzjmPzBVJkiRF5oo455xzziP7ijjnnHPO86ci+4o455xzzs0VSZIkReaKOOecc84j+4o455xzziP7ijjnnHPOI3NFkiRJkbkizjnnnPPIviLOOeec8/ypyL4izjnnnHNzRZIkSZG5Is4555zzyL4izjnnnPPIviLOOeec88hckSRJUmSuiHPOOec8sq+Ic8455zx/KrKviHPOOefcXJEkSVJkrohzzjnnPLKviHPOOec8sq+Ic8455zwyVyRJkhSZK+Kcc845j+wr4pxzzjnPn4rsK+Kcc845N1ckSZIUmSvinHPOOY/sK+Kcc845j+wr4pxzzjmPzBVJkiRF5oo455xzziP7ijjnnHPO86ci+4o455xzzs0VSZIkReaKOOecc84j+4o455xzziP7ijjnnHPOI3NFkiRJkbkizjnnnPPIviLOOeec8/ypyL4izjnnnHNzRZIkSZG5Is4555zzyL4izjnnnPPIviLOOeec88hckSRJUmSuiHPOOec8sq+Ic8455zx/KrKviHPOOefcXJEkSVJkrohzzjnnPLKviHPOOec8ilPR1+8/mUiSJNV3/w8AAP//ORxDbAAAAAZJREFUAwDq45oVQncisAAAAABJRU5ErkJggg==",
      "mimeType": "image/png"
    }
  ]
}
```
