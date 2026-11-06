
### Tool call: browser_navigate
- Args
```json
{
  "url": "http://127.0.0.1:4173/sign-in"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/sign-in\n- Page Title: Wardline",
  "snapshot": "- generic [ref=e2]:\n  - banner [ref=e3]\n  - main [ref=e4]:\n    - region \"Docket\" [ref=e6]\n    - region \"Inspector\" [ref=e7]\n  - main [ref=e8]:\n    - generic [ref=e9]:\n      - generic [ref=e10]: Wardline\n      - generic [ref=e11]: Custody and disclosure\n      - generic [ref=e12]:\n        - generic [ref=e13]: Email\n        - textbox \"Email\" [active] [ref=e14]\n        - generic [ref=e15]: Password\n        - textbox \"Password\" [ref=e16]\n        - paragraph [ref=e17]:\n          - button \"Sign in\" [ref=e18] [cursor=pointer]\n      - alert \"Sign-in status\""
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
  "page": "- Page URL: http://127.0.0.1:4173/sign-in\n- Page Title: Wardline",
  "inlineSnapshot": "- generic [ref=e2]:\n  - banner [ref=e3]\n  - main [ref=e4]:\n    - region \"Docket\" [ref=e6]\n    - region \"Inspector\" [ref=e7]\n  - main [ref=e8]:\n    - generic [ref=e9]:\n      - generic [ref=e10]: Wardline\n      - generic [ref=e11]: Custody and disclosure\n      - generic [ref=e12]:\n        - generic [ref=e13]: Email\n        - textbox \"Email\" [active] [ref=e14]\n        - generic [ref=e15]: Password\n        - textbox \"Password\" [ref=e16]\n        - paragraph [ref=e17]\n      - alert \"Sign-in status\""
}
```

### Tool call: browser_fill_form
- Args
```json
{
  "fields": [
    {
      "target": "e14",
      "name": "Email",
      "type": "textbox",
      "value": "sefa.whitlock@ashgrove.example"
    },
    {
      "target": "e16",
      "name": "Password",
      "type": "textbox",
      "value": "Custody-Seed-2026!"
    }
  ]
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
  "key": "Enter"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/ledger\n- Page Title: Wardline",
  "snapshot": "- generic [ref=e2]:\n  - banner [ref=e3]:\n    - generic [ref=e19]: WARDLINE\n    - button \"Sign out\" [ref=e20] [cursor=pointer]\n  - main [ref=e4]:\n    - region \"Docket\" [ref=e6]\n    - region \"Inspector\" [ref=e7]\n  - main [ref=e8]:\n    - region \"Chain Walk\" [ref=e21]:\n      - generic [ref=e22]: \"0\"\n      - generic [ref=e23]: Verified through\n      - heading \"Chain Walk\" [level=1] [ref=e24]\n      - link \"Chain lattice\" [ref=e25] [cursor=pointer]:\n        - /url: /audit/chain\n      - status \"Walk result\"\n      - generic [ref=e26]:\n        - generic [ref=e27]:\n          - slider \"Ledger walk\" [ref=e28]: \"0\"\n          - generic [ref=e29]:\n            - generic [ref=e30]: Link 1\n            - generic [ref=e32]: Link 2\n            - generic [ref=e34]: Link 3\n            - generic [ref=e36]: Link 4\n            - generic [ref=e38]: Link 5\n            - generic [ref=e40]: Link 6\n            - generic [ref=e42]: Link 7\n            - generic [ref=e44]: Link 8\n            - generic [ref=e46]: Link 9\n            - generic [ref=e48]: Link 10\n            - generic [ref=e50]: Link 11\n            - generic [ref=e52]: Link 12\n            - generic [ref=e54]: Link 13\n            - generic [ref=e56]: Link 14\n            - generic [ref=e58]: Link 15\n            - generic [ref=e60]: Link 16\n            - generic [ref=e62]: Link 17\n            - generic [ref=e64]: Link 18\n            - generic [ref=e66]: Link 19\n            - generic [ref=e68]: Link 20\n            - generic [ref=e70]: Link 21\n            - generic [ref=e72]: Link 22\n            - generic [ref=e74]: Link 23\n            - generic [ref=e76]: Link 24\n            - generic [ref=e78]: Link 25\n            - generic [ref=e80]: Link 26\n            - generic [ref=e82]: Link 27\n            - generic [ref=e84]: Link 28\n            - generic [ref=e86]: Link 29\n            - generic [ref=e88]: Link 30\n            - generic [ref=e90]: Link 31\n            - generic [ref=e92]: Link 32\n            - generic [ref=e94]: Link 33\n            - generic [ref=e96]: Link 34\n            - generic [ref=e98]: Link 35\n            - generic [ref=e100]: Link 36\n            - generic [ref=e102]: Link 37\n            - generic [ref=e104]: Link 38\n            - generic [ref=e106]: Link 39\n            - generic [ref=e108]: Link 40\n            - generic [ref=e110]: Link 41\n            - generic [ref=e112]: Link 42\n            - generic [ref=e114]: Link 43\n            - generic [ref=e116]: Link 44\n            - generic [ref=e118]: Link 45\n            - generic [ref=e120]: Link 46\n            - generic [ref=e122]: Link 47\n            - generic [ref=e124]: Link 48\n            - generic [ref=e126]: Link 49\n            - generic [ref=e128]: Link 50\n            - generic [ref=e130]: Link 51\n            - generic [ref=e132]: Link 52\n            - generic [ref=e134]: Link 53\n            - generic [ref=e136]: Link 54\n            - generic [ref=e138]: Link 55\n            - generic [ref=e140]: Link 56\n            - generic [ref=e142]: Link 57\n            - generic [ref=e144]: Link 58\n            - generic [ref=e146]: Link 59\n            - generic [ref=e148]: Link 60\n            - generic [ref=e150]: Link 61\n            - generic [ref=e152]: Link 62\n            - generic [ref=e154]: Link 63\n            - generic [ref=e156]: Link 64\n            - generic [ref=e158]: Link 65\n            - generic [ref=e160]: Link 66\n            - generic [ref=e162]: Link 67\n            - generic [ref=e164]: Link 68\n            - generic [ref=e166]: Link 69\n            - generic [ref=e168]: Link 70\n            - generic [ref=e170]: Link 71\n            - generic [ref=e172]: Link 72\n            - generic [ref=e174]: Link 73\n            - generic [ref=e176]: Link 74\n            - generic [ref=e178]: Link 75\n            - generic [ref=e180]: Link 76\n            - generic [ref=e182]: Link 77\n            - generic [ref=e184]: Link 78\n            - generic [ref=e186]: Link 79\n            - generic [ref=e188]: Link 80\n            - generic [ref=e190]: Link 81\n            - generic [ref=e192]: Link 82\n            - generic [ref=e194]: Link 83\n            - generic [ref=e196]: Link 84\n            - generic [ref=e198]: Link 85\n            - generic [ref=e200]: Link 86\n            - generic [ref=e202]: Link 87\n            - generic [ref=e204]: Link 88\n            - generic [ref=e206]: Link 89\n            - generic [ref=e208]: Link 90\n            - generic [ref=e210]: Link 91\n            - generic [ref=e212]: Link 92\n            - generic [ref=e214]: Link 93\n            - generic [ref=e216]: Link 94\n            - generic [ref=e218]: Link 95\n        - generic [ref=e220]:\n          - region \"Digest panel\" [ref=e221]:\n            - heading \"Digest\" [level=2] [ref=e222]\n            - generic [ref=e223]:\n              - generic [ref=e224]: \"0\"\n              - generic [ref=e225]: \"0\"\n              - generic [ref=e226]: \"0\"\n              - generic [ref=e227]: \"0\"\n              - generic [ref=e228]: \"0\"\n              - generic [ref=e229]: \"0\"\n              - generic [ref=e230]: \"0\"\n              - generic [ref=e231]: \"0\"\n              - generic [ref=e232]: \"0\"\n              - generic [ref=e233]: \"0\"\n              - generic [ref=e234]: \"0\"\n              - generic [ref=e235]: \"0\"\n              - generic [ref=e236]: \"0\"\n              - generic [ref=e237]: \"0\"\n              - generic [ref=e238]: \"0\"\n              - generic [ref=e239]: \"0\"\n              - generic [ref=e240]: \"0\"\n              - generic [ref=e241]: \"0\"\n              - generic [ref=e242]: \"0\"\n              - generic [ref=e243]: \"0\"\n              - generic [ref=e244]: \"0\"\n              - generic [ref=e245]: \"0\"\n              - generic [ref=e246]: \"0\"\n              - generic [ref=e247]: \"0\"\n              - generic [ref=e248]: \"0\"\n              - generic [ref=e249]: \"0\"\n              - generic [ref=e250]: \"0\"\n              - generic [ref=e251]: \"0\"\n              - generic [ref=e252]: \"0\"\n              - generic [ref=e253]: \"0\"\n              - generic [ref=e254]: \"0\"\n              - generic [ref=e255]: \"0\"\n              - generic [ref=e256]: \"0\"\n              - generic [ref=e257]: \"0\"\n              - generic [ref=e258]: \"0\"\n              - generic [ref=e259]: \"0\"\n              - generic [ref=e260]: \"0\"\n              - generic [ref=e261]: \"0\"\n              - generic [ref=e262]: \"0\"\n              - generic [ref=e263]: \"0\"\n              - generic [ref=e264]: \"0\"\n              - generic [ref=e265]: \"0\"\n              - generic [ref=e266]: \"0\"\n              - generic [ref=e267]: \"0\"\n              - generic [ref=e268]: \"0\"\n              - generic [ref=e269]: \"0\"\n              - generic [ref=e270]: \"0\"\n              - generic [ref=e271]: \"0\"\n              - generic [ref=e272]: \"0\"\n              - generic [ref=e273]: \"0\"\n              - generic [ref=e274]: \"0\"\n              - generic [ref=e275]: \"0\"\n              - generic [ref=e276]: \"0\"\n              - generic [ref=e277]: \"0\"\n              - generic [ref=e278]: \"0\"\n              - generic [ref=e279]: \"0\"\n              - generic [ref=e280]: \"0\"\n              - generic [ref=e281]: \"0\"\n              - generic [ref=e282]: \"0\"\n              - generic [ref=e283]: \"0\"\n              - generic [ref=e284]: \"0\"\n              - generic [ref=e285]: \"0\"\n              - generic [ref=e286]: \"0\"\n              - generic [ref=e287]: \"0\"\n          - generic [ref=e288]:\n            - heading \"Anchors\" [level=2] [ref=e289]\n            - generic [ref=e290]: Current anchor\n            - textbox \"Current anchor\" [ref=e291]\n            - button \"Copy anchor\" [disabled] [ref=e292]\n            - generic [ref=e293]: Anchor to check\n            - textbox \"Anchor to check\" [ref=e294]\n            - button \"Check anchor\" [ref=e295] [cursor=pointer]\n            - status \"Anchor status\""
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
  "key": "ArrowRight"
}
```
- Result
```json
{}
```
