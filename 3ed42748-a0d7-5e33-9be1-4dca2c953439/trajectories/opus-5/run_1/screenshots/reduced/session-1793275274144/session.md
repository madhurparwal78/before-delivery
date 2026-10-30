
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
  "url": "http://127.0.0.1:4173/"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/\n- Page Title: Parcel Moon\n- Console: 1 errors, 0 warnings",
  "snapshot": "",
  "events": "- New console entries: evidence/reduced/console-2026-10-29T12-01-20-747Z.log#L1"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Read Lantern oil for the mill",
  "target": "button[aria-label='Read Lantern oil for the mill']"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/\n- Page Title: Parcel Moon\n- Console: 1 errors, 0 warnings",
  "snapshot": "- generic [ref=e2]:\n  - status \"Notices\"\n  - complementary \"Postbox\" [ref=e3]:\n    - heading \"Postbox\" [level=2] [ref=e4]\n    - generic [ref=e5]:\n      - paragraph [ref=e6]: Courier 8081\n      - button \"Claim this save\" [ref=e8] [cursor=pointer]\n      - generic [ref=e9]:\n        - textbox \"Display name\" [ref=e10]: Courier 8081\n        - button \"Save name\" [ref=e11] [cursor=pointer]\n  - complementary \"Depot board\" [ref=e12]:\n    - heading \"Depot board\" [level=2] [ref=e13]\n    - generic [ref=e14]:\n      - generic [ref=e15]:\n        - button \"Read Lantern oil for the mill\" [ref=e16] [cursor=pointer]:\n          - generic [ref=e17]: Lantern oil for the mill\n          - generic [ref=e18]: +5 stamps\n        - button \"Read Seed packets for the gourds\" [ref=e19] [cursor=pointer]:\n          - generic [ref=e20]: Seed packets for the gourds\n          - generic [ref=e21]: +4 stamps\n        - button \"Read A rolled star chart\" [ref=e22] [cursor=pointer]:\n          - generic [ref=e23]: A rolled star chart\n          - generic [ref=e24]: +8 stamps\n      - heading \"Rush board · 2026-10-29 · 1 left\" [level=3] [ref=e25]\n      - generic [ref=e27]:\n        - generic [ref=e28]: Parcel 1 of 1 · Moonmelon Express\n        - button \"Claim Moonmelon Express, parcel 1 of 1\" [ref=e29] [cursor=pointer]: Claim\n  - complementary \"Satchel\" [ref=e30]:\n    - heading \"Satchel\" [level=2] [ref=e31]\n    - generic [ref=e32]:\n      - status \"Stamp balance\" [ref=e33]:\n        - strong [ref=e34]: \"0\"\n        - generic [ref=e35]: stamps\n      - paragraph [ref=e36]: Wearing Canvas Satchel\n      - generic [ref=e37]:\n        - button \"Outfitter\" [ref=e38] [cursor=pointer]\n        - button \"Stamp history\" [ref=e39] [cursor=pointer]\n  - region \"Bramble\" [ref=e40]\n  - generic [ref=e42]:\n    - toolbar \"Emotes\" [ref=e43]:\n      - button \"Wave\" [ref=e44] [cursor=pointer]\n      - button \"Cheer\" [ref=e45] [cursor=pointer]\n      - button \"Sleepy\" [ref=e46] [cursor=pointer]\n      - button \"Heart\" [ref=e47] [cursor=pointer]\n    - button \"Photo mode\" [ref=e48] [cursor=pointer]\n  - generic:\n    - img \"Horizon compass\":\n      - img [aria-hidden]:\n        - generic:\n          - generic: \"N\"\n          - generic: E\n          - generic: S\n          - generic: W\n    - status \"Route\"\n  - list \"Couriers nearby\" [ref=e49]\n  - dialog \"Letter from Ottoline Fennick\" [ref=e50]:\n    - generic [ref=e51]:\n      - generic [ref=e52]:\n        - paragraph [ref=e53]: The mill lamps are sputtering again.\n        - paragraph [ref=e54]: Bring me a tin of lantern oil from the depot, would you?\n      - generic [ref=e55]:\n        - button \"Take the parcel\" [active] [ref=e56] [cursor=pointer]\n        - button \"Not now\" [ref=e57] [cursor=pointer]"
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
  "page": "- Page URL: http://127.0.0.1:4173/\n- Page Title: Parcel Moon\n- Console: 1 errors, 0 warnings",
  "inlineSnapshot": "- generic [ref=e2]:\n  - status \"Notices\"\n  - complementary \"Postbox\" [ref=e3]:\n    - heading \"Postbox\" [level=2] [ref=e4]\n    - generic [ref=e5]:\n      - paragraph [ref=e6]: Courier 8081\n      - button \"Claim this save\" [ref=e8] [cursor=pointer]\n      - generic [ref=e9]:\n        - textbox \"Display name\" [ref=e10]: Courier 8081\n        - button \"Save name\" [ref=e11] [cursor=pointer]\n  - complementary \"Depot board\" [ref=e12]:\n    - heading \"Depot board\" [level=2] [ref=e13]\n    - generic [ref=e14]:\n      - generic [ref=e15]:\n        - button \"Read Lantern oil for the mill\" [ref=e58] [cursor=pointer]:\n          - generic [ref=e59]: Lantern oil for the mill\n          - generic [ref=e60]: +5 stamps\n        - button \"Read Seed packets for the gourds\" [ref=e61] [cursor=pointer]:\n          - generic [ref=e62]: Seed packets for the gourds\n          - generic [ref=e63]: +4 stamps\n        - button \"Read A rolled star chart\" [ref=e64] [cursor=pointer]:\n          - generic [ref=e65]: A rolled star chart\n          - generic [ref=e66]: +8 stamps\n      - heading \"Rush board · 2026-10-29 · 1 left\" [level=3] [ref=e25]\n      - generic [ref=e67]:\n        - generic [ref=e68]: Parcel 1 of 1 · Moonmelon Express\n        - button \"Claim Moonmelon Express, parcel 1 of 1\" [ref=e69] [cursor=pointer]: Claim\n  - complementary \"Satchel\" [ref=e30]:\n    - heading \"Satchel\" [level=2] [ref=e31]\n    - generic [ref=e32]:\n      - status \"Stamp balance\" [ref=e33]:\n        - strong [ref=e34]: \"0\"\n        - generic [ref=e35]: stamps\n      - paragraph [ref=e36]: Wearing Canvas Satchel\n      - generic [ref=e37]:\n        - button \"Outfitter\" [ref=e38] [cursor=pointer]\n        - button \"Stamp history\" [ref=e39] [cursor=pointer]\n  - region \"Bramble\" [ref=e40]\n  - generic [ref=e42]:\n    - toolbar \"Emotes\" [ref=e43]:\n      - button \"Wave\" [ref=e44] [cursor=pointer]\n      - button \"Cheer\" [ref=e45] [cursor=pointer]\n      - button \"Sleepy\" [ref=e46] [cursor=pointer]\n      - button \"Heart\" [ref=e47] [cursor=pointer]\n    - button \"Photo mode\" [ref=e48] [cursor=pointer]\n  - generic:\n    - img \"Horizon compass\":\n      - img [aria-hidden]:\n        - generic:\n          - generic: \"N\"\n          - generic: E\n          - generic: S\n          - generic: W\n    - status \"Route\"\n  - list \"Couriers nearby\" [ref=e49]\n  - dialog \"Letter from Ottoline Fennick\" [ref=e50]:\n    - generic [ref=e51]:\n      - generic [ref=e52]:\n        - paragraph [ref=e53]: The mill lamps are sputtering again.\n        - paragraph [ref=e54]: Bring me a tin of lantern oil from the depot, would you?\n      - generic [ref=e55]:\n        - button \"Take the parcel\" [active] [ref=e56] [cursor=pointer]\n        - button \"Not now\" [ref=e57] [cursor=pointer]"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Take the parcel",
  "target": "e56"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/\n- Page Title: Parcel Moon\n- Console: 1 errors, 0 warnings",
  "snapshot": "- generic [ref=e2]:\n  - status \"Notices\":\n    - paragraph: Parcel taken. Follow the teal thread.\n  - complementary \"Postbox\" [ref=e3]:\n    - heading \"Postbox\" [level=2] [ref=e4]\n    - generic [ref=e5]:\n      - paragraph [ref=e6]: Courier 8081\n      - button \"Claim this save\" [ref=e8] [cursor=pointer]\n      - generic [ref=e9]:\n        - textbox \"Display name\" [ref=e10]: Courier 8081\n        - button \"Save name\" [ref=e11] [cursor=pointer]\n  - complementary \"Depot board\" [ref=e12]:\n    - heading \"Depot board\" [level=2] [ref=e13]\n    - generic [ref=e14]:\n      - generic [ref=e15]:\n        - button \"Read Lantern oil for the mill\" [ref=e70] [cursor=pointer]:\n          - generic [ref=e71]: Lantern oil for the mill\n          - generic [ref=e72]: +5 stamps\n        - button \"Read Seed packets for the gourds\" [ref=e73] [cursor=pointer]:\n          - generic [ref=e74]: Seed packets for the gourds\n          - generic [ref=e75]: +4 stamps\n        - button \"Read A rolled star chart\" [ref=e76] [cursor=pointer]:\n          - generic [ref=e77]: A rolled star chart\n          - generic [ref=e78]: +8 stamps\n      - heading \"Rush board · 2026-10-29 · 1 left\" [level=3] [ref=e25]\n      - generic [ref=e79]:\n        - generic [ref=e80]: Parcel 1 of 1 · Moonmelon Express\n        - button \"Claim Moonmelon Express, parcel 1 of 1\" [ref=e81] [cursor=pointer]: Claim\n  - complementary \"Satchel\" [ref=e30]:\n    - heading \"Satchel\" [level=2] [ref=e31]\n    - generic [ref=e32]:\n      - status \"Stamp balance\" [ref=e33]:\n        - strong [ref=e34]: \"0\"\n        - generic [ref=e35]: stamps\n      - paragraph [ref=e36]: Wearing Canvas Satchel\n      - generic [ref=e37]:\n        - button \"Outfitter\" [ref=e38] [cursor=pointer]\n        - button \"Stamp history\" [ref=e39] [cursor=pointer]\n      - button \"Drop parcel\" [ref=e82] [cursor=pointer]\n  - region \"Bramble\" [ref=e40]\n  - generic [ref=e42]:\n    - toolbar \"Emotes\" [ref=e43]:\n      - button \"Wave\" [ref=e44] [cursor=pointer]\n      - button \"Cheer\" [ref=e45] [cursor=pointer]\n      - button \"Sleepy\" [ref=e46] [cursor=pointer]\n      - button \"Heart\" [ref=e47] [cursor=pointer]\n    - button \"Photo mode\" [ref=e48] [cursor=pointer]\n  - generic:\n    - img \"Horizon compass\":\n      - img [aria-hidden]:\n        - generic:\n          - generic: \"N\"\n          - generic: E\n          - generic: S\n          - generic: W\n    - status \"Route\": Bearing NE 51°, 55 m\n  - list \"Couriers nearby\" [ref=e49]"
}
```

### Tool call: browser_evaluate
- Args
```json
{
  "function": "() => ({route:document.querySelector('[role=\"status\"][aria-label=\"Route\"]')?.getAttribute('data-route-id'), notch:[...document.querySelectorAll('[aria-label=\"Horizon compass\"] polygon')].map(e=>({fill:getComputedStyle(e).fill,points:e.getAttribute('points')}))})"
}
```
- Result
```json
{
  "result": "{\n  \"route\": \"rt_iwyx846z3e9f1nm0b46d\",\n  \"notch\": []\n}"
}
```

### Tool call: browser_take_screenshot
- Args
```json
{
  "element": "Horizon compass active route",
  "target": "[aria-label='Horizon compass']",
  "type": "png",
  "scale": "device"
}
```
- Result
```json
{
  "result": "- [Screenshot of Horizon compass active route](evidence/reduced/element-2026-10-29T12-01-58-243Z.png)",
  "attachments": [
    {
      "type": "image",
      "data": "iVBORw0KGgoAAAANSUhEUgAAAoAAAAA8CAIAAAB5OJxTAAAE1ElEQVR4nOzdTWgcZRzH8f/szGxemmx2tnnZvNAohlKx1YsHRSyloni0UPAi+IJ489Krh1JRT1485CDoodJLIYceRCQG30iDPYiltvhOtSab931J0k2yM7vTJwRKodnNpF3yzAPfD8Ow2X14MjsJ/OZ5nnnmcc6MnhIAZnIcWwCYKSEAAGDfEcAAAGhAAAMAoIEjAGLvzV8OHZ1PRSx8I7v6xdPTAiDeaAEDBhgfWYxeeOLwkgCIPQIYMMBM5/qPw8tRSk4+ms+lNgRA7BHAgBnGRxbW3WrjMutubeLwHtrKADQigAEzqPRVGdy4jEpflcECwAQEMGAM1Qut+qLrfap6nlX/swAwBAEMmKTB3VjcewWYhQAGTHK9b0Vt979/I7uqNgFgDgIYMMyOjWCav4BxCGDAMPdPSWLqEWAiAhgwz71Tkph6BBiKAAbMc++UJKYeAYYigAEjbU9JYuoRYC4WYwBMNT6yaNtcQwOmIoCh36UPt4YwX3mvR7AXH3z2j9qfPpsV7MXYuTnhvCEGuHwGAEADAhgAAA0IYAAANCCAAQDQgAAGAEADAhjxcumjxfJK3cdKfPd58cpYSSJTVakK5SFMXiiqTZpBHbk6fomxiU+Xpy4WpBl+OJ9XmzyEsffnyqU9PGBEHbk6/nqfqqpUhQLECQEMAIAGBDAAABoQwAAAaEAAAwCgAQEMAIAGBDAAABoQwAAAaEAAAwCggXVm9JQA++XyTg+1WPzPV/ueYXf7tTfoOnXWySzMBrZjpXpsiSYIpDDjb9f8YIrzVbVP90X9jQ2sLFarQej1N20N0O3z1vtIUpqkkPMTTqKrtwlftjAfqL3X9+BfduHfSmZI/SdYEcuXFqq1oOYN7Py3DoIwP+1vnytVs9Q5b8dfzwiwXwhg7KvLF2L9KCjjWFbUfEIUBDD2U9MuxoEonnstLWgex2lCaxWAFowBAwCgAQEMAIAGBDAAABoQwAAAaEAAAwCgAQEMAIAGTEOCHgs3K79+s/bCO1vTLq+Nr+Wn/RNveer11a/WWjsTR55vF9T39SdL1UBsx0q2Jw4dbbv+7erps1nBblaWgvHRpbs/Zgbdk28fFEATAhh6ZAbctaVaZb2WbEsUZ/1yqVr1Q9u1CrP+E0cOCBryK2In5NiLB7z+lr+v3BZE1pGxX363R4AYoAsaejgtVrrfKeT8sBZurIZ9jyVL80GwGZbmAtUuETQWSu9Iy++T5c5u+8mXUgLAQLSAoY036BRmgpb2hDfgpLNuIRcEftiVdVQ2Cxpykpa6XtlcrU1dLB072SGIbC1fHTs3p150DydPvMGDJ6ETAQxtDg65t65ttnYE6X5XhfHNnzdUAKs3BbtJ2PLsq6ncb5W/fip/fz4viIwuaMQHXdDQJjPo5HN+cS5QLWCv31mZDwozfnqAi8LdhaEEFRl5pi3VbQ8/1SoADEQAQ5u2LjvZIrk/KiqArYRlJ638/343LeAI/M3wz6myGj5//HjnravrAsBAtDagU2YoqcbkbHdr0NcbcMvFarvH8j67c5Nb6xB++fFya0ciFGvrpixEc3cMWJiGBN1YDxgwGMsRAuaiCxoAAA0IYAAANCCAAQDQgAAGAEADAhgAAA0IYAAANCCAAQDQgAAGAEADAhgAAA3uAAAA///+ugCAAAAABklEQVQDANw1d8ADWme1AAAAAElFTkSuQmCC",
      "mimeType": "image/png"
    }
  ]
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
  "page": "- Page URL: http://127.0.0.1:4173/\n- Page Title: Parcel Moon\n- Console: 1 errors, 0 warnings",
  "inlineSnapshot": "- generic [ref=e2]:\n  - status \"Notices\":\n    - paragraph: Parcel taken. Follow the teal thread.\n  - complementary \"Postbox\" [ref=e3]:\n    - heading \"Postbox\" [level=2] [ref=e4]\n    - generic [ref=e5]:\n      - paragraph [ref=e6]: Courier 8081\n      - button \"Claim this save\" [ref=e8] [cursor=pointer]\n      - generic [ref=e9]:\n        - textbox \"Display name\" [ref=e10]: Courier 8081\n        - button \"Save name\" [ref=e11] [cursor=pointer]\n  - complementary \"Depot board\" [ref=e12]:\n    - heading \"Depot board\" [level=2] [ref=e13]\n    - generic [ref=e14]:\n      - generic [ref=e15]:\n        - button \"Read Lantern oil for the mill\" [ref=e83] [cursor=pointer]:\n          - generic [ref=e84]: Lantern oil for the mill\n          - generic [ref=e85]: +5 stamps\n        - button \"Read Seed packets for the gourds\" [ref=e86] [cursor=pointer]:\n          - generic [ref=e87]: Seed packets for the gourds\n          - generic [ref=e88]: +4 stamps\n        - button \"Read A rolled star chart\" [ref=e89] [cursor=pointer]:\n          - generic [ref=e90]: A rolled star chart\n          - generic [ref=e91]: +8 stamps\n      - heading \"Rush board · 2026-10-29 · 1 left\" [level=3] [ref=e25]\n      - generic [ref=e92]:\n        - generic [ref=e93]: Parcel 1 of 1 · Moonmelon Express\n        - button \"Claim Moonmelon Express, parcel 1 of 1\" [ref=e94] [cursor=pointer]: Claim\n  - complementary \"Satchel\" [ref=e30]:\n    - heading \"Satchel\" [level=2] [ref=e31]\n    - generic [ref=e32]:\n      - status \"Stamp balance\" [ref=e33]:\n        - strong [ref=e34]: \"0\"\n        - generic [ref=e35]: stamps\n      - paragraph [ref=e36]: Wearing Canvas Satchel\n      - generic [ref=e37]:\n        - button \"Outfitter\" [ref=e38] [cursor=pointer]\n        - button \"Stamp history\" [ref=e39] [cursor=pointer]\n      - button \"Drop parcel\" [ref=e82] [cursor=pointer]\n  - region \"Bramble\" [ref=e40]\n  - generic [ref=e42]:\n    - toolbar \"Emotes\" [ref=e43]:\n      - button \"Wave\" [ref=e44] [cursor=pointer]\n      - button \"Cheer\" [ref=e45] [cursor=pointer]\n      - button \"Sleepy\" [ref=e46] [cursor=pointer]\n      - button \"Heart\" [ref=e47] [cursor=pointer]\n    - button \"Photo mode\" [ref=e48] [cursor=pointer]\n  - generic:\n    - img \"Horizon compass\":\n      - img [aria-hidden]:\n        - generic:\n          - generic: \"N\"\n          - generic: E\n          - generic: S\n          - generic: W\n    - status \"Route\": Bearing NE 51°, 55 m\n  - list \"Couriers nearby\" [ref=e49]"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Drop parcel",
  "target": "e82"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/\n- Page Title: Parcel Moon\n- Console: 1 errors, 0 warnings",
  "snapshot": "- generic [ref=e2]:\n  - status \"Notices\":\n    - paragraph: Parcel dropped.\n  - complementary \"Postbox\" [ref=e3]:\n    - heading \"Postbox\" [level=2] [ref=e4]\n    - generic [ref=e5]:\n      - paragraph [ref=e6]: Courier 8081\n      - button \"Claim this save\" [ref=e8] [cursor=pointer]\n      - generic [ref=e9]:\n        - textbox \"Display name\" [ref=e10]: Courier 8081\n        - button \"Save name\" [ref=e11] [cursor=pointer]\n  - complementary \"Depot board\" [ref=e12]:\n    - heading \"Depot board\" [level=2] [ref=e13]\n    - generic [ref=e14]:\n      - generic [ref=e15]:\n        - button \"Read Lantern oil for the mill\" [ref=e95] [cursor=pointer]:\n          - generic [ref=e96]: Lantern oil for the mill\n          - generic [ref=e97]: +5 stamps\n        - button \"Read Seed packets for the gourds\" [ref=e98] [cursor=pointer]:\n          - generic [ref=e99]: Seed packets for the gourds\n          - generic [ref=e100]: +4 stamps\n        - button \"Read A rolled star chart\" [ref=e101] [cursor=pointer]:\n          - generic [ref=e102]: A rolled star chart\n          - generic [ref=e103]: +8 stamps\n      - heading \"Rush board · 2026-10-29 · 1 left\" [level=3] [ref=e25]\n      - generic [ref=e104]:\n        - generic [ref=e105]: Parcel 1 of 1 · Moonmelon Express\n        - button \"Claim Moonmelon Express, parcel 1 of 1\" [ref=e106] [cursor=pointer]: Claim\n  - complementary \"Satchel\" [ref=e30]:\n    - heading \"Satchel\" [level=2] [ref=e31]\n    - generic [ref=e32]:\n      - status \"Stamp balance\" [ref=e33]:\n        - strong [ref=e34]: \"0\"\n        - generic [ref=e35]: stamps\n      - paragraph [ref=e36]: Wearing Canvas Satchel\n      - generic [ref=e37]:\n        - button \"Outfitter\" [ref=e38] [cursor=pointer]\n        - button \"Stamp history\" [ref=e39] [cursor=pointer]\n  - region \"Bramble\" [ref=e40]\n  - generic [ref=e42]:\n    - toolbar \"Emotes\" [ref=e43]:\n      - button \"Wave\" [ref=e44] [cursor=pointer]\n      - button \"Cheer\" [ref=e45] [cursor=pointer]\n      - button \"Sleepy\" [ref=e46] [cursor=pointer]\n      - button \"Heart\" [ref=e47] [cursor=pointer]\n    - button \"Photo mode\" [ref=e48] [cursor=pointer]\n  - generic:\n    - img \"Horizon compass\":\n      - img [aria-hidden]:\n        - generic:\n          - generic: \"N\"\n          - generic: E\n          - generic: S\n          - generic: W\n    - status \"Route\"\n  - list \"Couriers nearby\" [ref=e49]"
}
```

### Tool call: browser_take_screenshot
- Args
```json
{
  "element": "Horizon compass after dropping parcel",
  "target": "[aria-label='Horizon compass']",
  "type": "png",
  "scale": "device"
}
```
- Result
```json
{
  "result": "- [Screenshot of Horizon compass after dropping parcel](evidence/reduced/element-2026-10-29T12-02-20-020Z.png)",
  "attachments": [
    {
      "type": "image",
      "data": "iVBORw0KGgoAAAANSUhEUgAAAoAAAAA8CAIAAAB5OJxTAAAFcUlEQVR4nOzd228UZRjH8Wd2Z3d7bndpS7ttxCjYNoreGIOnhmAw3JKYeGOiMcY7bvgHDCZ6ZUy84MILL0i4IakJF8QYVKAIpHhICMdSUBRhe2QP7bLt7szu+K6rhAhtp7DpO2/y/WQymc5Mp9NtN79933eeGXvv/t0CwEy2HRYAZgoJAABYdwQwAAAa2AIgwK6NFS79cFfWbuvO1oFXmgVAUNECBgJty7amtq41D/S2d9ukLxBwtICBoBsYbv7563k7Zu3as0HN79/0v4uw3GLlyOezbskb2t4iAIKNFjAQdH2DsZ4tUbfoXTm5Sl/0xeN5lb7JZ2L9Qw0CINgIYMAAA681qflvPy3mZtzl9slOu9fPFtTC4DDNX8AABDBggHgy8tSLjWphfHTZRvDlYwtqvvml5kRfRAAEHgEMmEE1gtUA8OREaXKi+ODW1HgxNVG0Y6GhYa69AsxAAANmiDWHah3R46OFB7deOlFt/qr0VbsJABPwXgWMUStJUsPAajD4/vXXxgq5aZfSI8AsBDBgkoF/epjHTxacoldb4yx5l0fzaoHSI8AsBDBgklpJklOsqAyurbk0mneWKpQeAcYhgAHD/FeSVO12zk4518eq10VTegQYhzthAYaplST9/svi+I93LaneGIvSI8BEBDBgHtUIvnlhafJqSS1TegQYii5owDz3SpKE0iPAWLxvod/hT2bVJFiLLdv+DWBKj9ZqZN+UmgTQjQAGAEADAhgAAA0IYAAANCCAAQDQgAAGAEADAhjBcvjT2cJ8Zbmtx7/Knh3JiW/qUOqA8hhOHcyqSepBnbk6fwmw77+8c+ZQRuph9EBaTfIYRj6eKuQq/vdXZ67Of7mt6lDqgAIECQEMAIAGBDAAABoQwAAAaEAAAwCgAQEMAIAGBDAAABoQwAAAaEAAAwCggbV3/24B1svph93UYvZPR827NkVqy/G+iG0//Nszk27Yttq6wuKP60rmtlM78qPJTpfVvGOj35+4gvnZctn14r221Entdet+Mip1kkk5ITvU3l2HXzYz7ap5fOOj/7Izf5QS/eo/wfK5f26mXHEr8eTD/9au66VvObXXSh1Zlnndht9NCLBeCGCsq9MHA30rKONYlt98gh8EMNZT3T6MA368+k6HoH5suw6tVQBaMAYMAIAGBDAAABoQwAAAaEAAAwCgAQEMAIAGBDAAABpQhgQ9Zm6ULnyXf+PDatnl+aP59C1n+/txtXzum3xDa2jw9SbB8r79Yq7sSti2ok2hJ55rvHhs4a2PegSrmZ9zj+6fu/dloi+y44MNAmhCAEOPRDKSn6uUFivRxlB20inkymXHC0eszKTz7GCzYEVOScIh2bqzOd4bu372rsC3lkR4154uAQKALmjoYcesjl47k3K8ire04G18Opqbdt2il5tyVbtEsDJPujfHxk8VWjvDz7/ZJgAMRAsY2sT77MxtN9YUiiftjp5IJuW6jtfeY6tsFqzIjlrq80pxoXLmUG7rjhaBb/l0eWTflFro3BTd/h43noROBDC02dAfuXm+2NDidvRGVBjf+HVJBbBaKVhNKCwvv92WulK6NlY4cSAt8I0uaAQHXdDQJtFnp1NOdspVLeB4rz0/7WZuOx1JPhSuzvPELcnmbY1tneFNLzQIAAMRwNCmsT0cjUnqakkFsBWywlEr/ZfTSQvYB6foTZwpqOHzoeHWm+cWBYCBaG1Ap0R/VI3JhSPVQd94MlLIlpviPN5ndZFo9TmERz6709AS8sSqXpQFf+6NAQtlSNCN5wEDBuNxhIC56IIGAEADAhgAAA0IYAAANCCAAQDQgAAGAEADAhgAAA0IYAAANCCAAQDQgAAGAECDvwEAAP//RZ0GcQAAAAZJREFUAwCJrqMT9EFMQQAAAABJRU5ErkJggg==",
      "mimeType": "image/png"
    }
  ]
}
```
