
### Tool call: browser_navigate
- Args
```json
{
  "url": "http://127.0.0.1:4173/plan"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/plan\n- Page Title: Gablework Nightplan",
  "snapshot": "- generic [ref=e3]:\n  - banner [ref=e4]:\n    - generic [ref=e5]: Hub time 15:30 CST\n  - complementary [aria-hidden] [ref=e6]:\n    - navigation [ref=e7]:\n      - generic [ref=e8]: Gablework Nightplan\n      - link [ref=e9] [cursor=pointer]:\n        - /url: /plan\n        - text: Plan\n      - link [ref=e10] [cursor=pointer]:\n        - /url: /schedules\n        - text: Schedules\n      - link [ref=e11] [cursor=pointer]:\n        - /url: /scenes\n        - text: Scenes\n      - link [ref=e12] [cursor=pointer]:\n        - /url: /guests\n        - text: Guests\n      - link [ref=e13] [cursor=pointer]:\n        - /url: /log\n        - text: Day log\n      - link [ref=e14] [cursor=pointer]:\n        - /url: /notices\n        - text: Notices\n  - main [ref=e15]:\n    - generic [ref=e16]: Loading…\n  - generic:\n    - status [ref=e17]: \"Device updates:\"\n    - status [ref=e18]: \"Scene changes:\"\n    - status [ref=e19]"
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
  "page": "- Page URL: http://127.0.0.1:4173/plan\n- Page Title: Gablework Nightplan",
  "inlineSnapshot": "- generic [ref=e3]:\n  - banner [ref=e4]:\n    - generic [ref=e5]: Hub time 15:30 CST\n  - complementary [aria-hidden] [ref=e6]:\n    - navigation [ref=e7]:\n      - generic [ref=e8]: Gablework Nightplan\n      - link [ref=e9] [cursor=pointer]:\n        - /url: /plan\n        - text: Plan\n      - link [ref=e10] [cursor=pointer]:\n        - /url: /schedules\n        - text: Schedules\n      - link [ref=e11] [cursor=pointer]:\n        - /url: /scenes\n        - text: Scenes\n      - link [ref=e12] [cursor=pointer]:\n        - /url: /guests\n        - text: Guests\n      - link [ref=e13] [cursor=pointer]:\n        - /url: /log\n        - text: Day log\n      - link [ref=e14] [cursor=pointer]:\n        - /url: /notices\n        - text: Notices\n  - main [ref=e15]:\n    - generic [ref=e16]: Loading…\n  - generic:\n    - status [ref=e17]: \"Device updates:\"\n    - status [ref=e18]: \"Scene changes:\"\n    - status [ref=e19]"
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
