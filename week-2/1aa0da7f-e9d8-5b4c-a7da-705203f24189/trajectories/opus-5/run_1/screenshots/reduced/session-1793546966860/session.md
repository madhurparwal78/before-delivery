
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
  "depth": 5
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/sign-in\n- Page Title: Wardline",
  "inlineSnapshot": "- generic [ref=e2]:\n  - banner [ref=e3]\n  - main [ref=e4]:\n    - region \"Docket\" [ref=e6]\n    - region \"Inspector\" [ref=e7]\n  - main [ref=e8]:\n    - generic [ref=e9]:\n      - generic [ref=e10]: Wardline\n      - generic [ref=e11]: Custody and disclosure\n      - generic [ref=e12]:\n        - generic [ref=e13]: Email\n        - textbox \"Email\" [active] [ref=e14]\n        - generic [ref=e15]: Password\n        - textbox \"Password\" [ref=e16]\n        - paragraph [ref=e17]:\n          - button \"Sign in\" [ref=e18] [cursor=pointer]\n      - alert \"Sign-in status\""
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
  "snapshot": "- generic [ref=e2]:\n  - banner [ref=e3]:\n    - generic [ref=e19]: WARDLINE\n    - button \"Sign out\" [ref=e20] [cursor=pointer]\n  - main [ref=e4]:\n    - region \"Docket\" [ref=e6]\n    - region \"Inspector\" [ref=e7]\n  - main [ref=e8]:\n    - region \"Chain Walk\" [ref=e21]:\n      - generic [ref=e22]: \"0\"\n      - generic [ref=e23]: Verified through\n      - heading \"Chain Walk\" [level=1] [ref=e24]\n      - link \"Chain lattice\" [ref=e25] [cursor=pointer]:\n        - /url: /audit/chain\n      - status \"Walk result\"\n      - generic [ref=e26]:\n        - generic [ref=e27]:\n          - slider \"Ledger walk\" [ref=e28]: \"0\"\n          - generic [ref=e29]:\n            - generic [ref=e30]: Link 1\n            - generic [ref=e32]: Link 2\n            - generic [ref=e34]: Link 3\n            - generic [ref=e36]: Link 4\n            - generic [ref=e38]: Link 5\n            - generic [ref=e40]: Link 6\n            - generic [ref=e42]: Link 7\n            - generic [ref=e44]: Link 8\n            - generic [ref=e46]: Link 9\n            - generic [ref=e48]: Link 10\n            - generic [ref=e50]: Link 11\n            - generic [ref=e52]: Link 12\n            - generic [ref=e54]: Link 13\n            - generic [ref=e56]: Link 14\n            - generic [ref=e58]: Link 15\n            - generic [ref=e60]: Link 16\n            - generic [ref=e62]: Link 17\n            - generic [ref=e64]: Link 18\n            - generic [ref=e66]: Link 19\n            - generic [ref=e68]: Link 20\n            - generic [ref=e70]: Link 21\n            - generic [ref=e72]: Link 22\n            - generic [ref=e74]: Link 23\n            - generic [ref=e76]: Link 24\n            - generic [ref=e78]: Link 25\n            - generic [ref=e80]: Link 26\n            - generic [ref=e82]: Link 27\n            - generic [ref=e84]: Link 28\n            - generic [ref=e86]: Link 29\n            - generic [ref=e88]: Link 30\n            - generic [ref=e90]: Link 31\n            - generic [ref=e92]: Link 32\n            - generic [ref=e94]: Link 33\n            - generic [ref=e96]: Link 34\n            - generic [ref=e98]: Link 35\n            - generic [ref=e100]: Link 36\n            - generic [ref=e102]: Link 37\n            - generic [ref=e104]: Link 38\n            - generic [ref=e106]: Link 39\n            - generic [ref=e108]: Link 40\n            - generic [ref=e110]: Link 41\n            - generic [ref=e112]: Link 42\n            - generic [ref=e114]: Link 43\n            - generic [ref=e116]: Link 44\n            - generic [ref=e118]: Link 45\n            - generic [ref=e120]: Link 46\n            - generic [ref=e122]: Link 47\n            - generic [ref=e124]: Link 48\n            - generic [ref=e126]: Link 49\n            - generic [ref=e128]: Link 50\n            - generic [ref=e130]: Link 51\n            - generic [ref=e132]: Link 52\n            - generic [ref=e134]: Link 53\n            - generic [ref=e136]: Link 54\n            - generic [ref=e138]: Link 55\n            - generic [ref=e140]: Link 56\n            - generic [ref=e142]: Link 57\n            - generic [ref=e144]: Link 58\n            - generic [ref=e146]: Link 59\n            - generic [ref=e148]: Link 60\n            - generic [ref=e150]: Link 61\n            - generic [ref=e152]: Link 62\n            - generic [ref=e154]: Link 63\n            - generic [ref=e156]: Link 64\n            - generic [ref=e158]: Link 65\n            - generic [ref=e160]: Link 66\n            - generic [ref=e162]: Link 67\n            - generic [ref=e164]: Link 68\n            - generic [ref=e166]: Link 69\n            - generic [ref=e168]: Link 70\n            - generic [ref=e170]: Link 71\n            - generic [ref=e172]: Link 72\n            - generic [ref=e174]: Link 73\n            - generic [ref=e176]: Link 74\n            - generic [ref=e178]: Link 75\n        - generic [ref=e180]:\n          - region \"Digest panel\" [ref=e181]:\n            - heading \"Digest\" [level=2] [ref=e182]\n            - generic [ref=e183]:\n              - generic [ref=e184]: \"0\"\n              - generic [ref=e185]: \"0\"\n              - generic [ref=e186]: \"0\"\n              - generic [ref=e187]: \"0\"\n              - generic [ref=e188]: \"0\"\n              - generic [ref=e189]: \"0\"\n              - generic [ref=e190]: \"0\"\n              - generic [ref=e191]: \"0\"\n              - generic [ref=e192]: \"0\"\n              - generic [ref=e193]: \"0\"\n              - generic [ref=e194]: \"0\"\n              - generic [ref=e195]: \"0\"\n              - generic [ref=e196]: \"0\"\n              - generic [ref=e197]: \"0\"\n              - generic [ref=e198]: \"0\"\n              - generic [ref=e199]: \"0\"\n              - generic [ref=e200]: \"0\"\n              - generic [ref=e201]: \"0\"\n              - generic [ref=e202]: \"0\"\n              - generic [ref=e203]: \"0\"\n              - generic [ref=e204]: \"0\"\n              - generic [ref=e205]: \"0\"\n              - generic [ref=e206]: \"0\"\n              - generic [ref=e207]: \"0\"\n              - generic [ref=e208]: \"0\"\n              - generic [ref=e209]: \"0\"\n              - generic [ref=e210]: \"0\"\n              - generic [ref=e211]: \"0\"\n              - generic [ref=e212]: \"0\"\n              - generic [ref=e213]: \"0\"\n              - generic [ref=e214]: \"0\"\n              - generic [ref=e215]: \"0\"\n              - generic [ref=e216]: \"0\"\n              - generic [ref=e217]: \"0\"\n              - generic [ref=e218]: \"0\"\n              - generic [ref=e219]: \"0\"\n              - generic [ref=e220]: \"0\"\n              - generic [ref=e221]: \"0\"\n              - generic [ref=e222]: \"0\"\n              - generic [ref=e223]: \"0\"\n              - generic [ref=e224]: \"0\"\n              - generic [ref=e225]: \"0\"\n              - generic [ref=e226]: \"0\"\n              - generic [ref=e227]: \"0\"\n              - generic [ref=e228]: \"0\"\n              - generic [ref=e229]: \"0\"\n              - generic [ref=e230]: \"0\"\n              - generic [ref=e231]: \"0\"\n              - generic [ref=e232]: \"0\"\n              - generic [ref=e233]: \"0\"\n              - generic [ref=e234]: \"0\"\n              - generic [ref=e235]: \"0\"\n              - generic [ref=e236]: \"0\"\n              - generic [ref=e237]: \"0\"\n              - generic [ref=e238]: \"0\"\n              - generic [ref=e239]: \"0\"\n              - generic [ref=e240]: \"0\"\n              - generic [ref=e241]: \"0\"\n              - generic [ref=e242]: \"0\"\n              - generic [ref=e243]: \"0\"\n              - generic [ref=e244]: \"0\"\n              - generic [ref=e245]: \"0\"\n              - generic [ref=e246]: \"0\"\n              - generic [ref=e247]: \"0\"\n          - generic [ref=e248]:\n            - heading \"Anchors\" [level=2] [ref=e249]\n            - generic [ref=e250]: Current anchor\n            - textbox \"Current anchor\" [ref=e251]\n            - button \"Copy anchor\" [disabled] [ref=e252]\n            - generic [ref=e253]: Anchor to check\n            - textbox \"Anchor to check\" [ref=e254]\n            - button \"Check anchor\" [ref=e255] [cursor=pointer]\n            - status \"Anchor status\""
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
  "page": "- Page URL: http://127.0.0.1:4173/ledger\n- Page Title: Wardline",
  "inlineSnapshot": "- generic [ref=e2]:\n  - banner [ref=e3]:\n    - generic [ref=e19]: WARDLINE\n    - button \"Sign out\" [ref=e20] [cursor=pointer]\n  - main [ref=e4]:\n    - region \"Docket\" [ref=e6]\n    - region \"Inspector\" [ref=e7]\n  - main [ref=e8]:\n    - region \"Chain Walk\" [ref=e21]:\n      - generic [ref=e22]: \"0\"\n      - generic [ref=e23]: Verified through\n      - heading \"Chain Walk\" [level=1] [ref=e24]\n      - link \"Chain lattice\" [ref=e25] [cursor=pointer]:\n        - /url: /audit/chain\n      - status \"Walk result\"\n      - generic [ref=e26]:\n        - generic [ref=e27]:\n          - slider \"Ledger walk\" [ref=e28]: \"0\"\n          - generic [ref=e29]\n        - generic [ref=e180]:\n          - region \"Digest panel\" [ref=e181]\n          - generic [ref=e248]"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Ledger walk slider",
  "target": "e28"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/ledger\n- Page Title: Wardline",
  "snapshot": "- generic [ref=e2]:\n  - banner [ref=e3]:\n    - generic [ref=e19]: WARDLINE\n    - button \"Sign out\" [ref=e20] [cursor=pointer]\n  - main [ref=e4]:\n    - region \"Docket\" [ref=e6]\n    - region \"Inspector\" [ref=e7]\n  - main [ref=e8]:\n    - region \"Chain Walk\" [ref=e21]:\n      - generic [ref=e22]: \"38\"\n      - generic [ref=e23]: Verified through\n      - heading \"Chain Walk\" [level=1] [ref=e24]\n      - link \"Chain lattice\" [ref=e25] [cursor=pointer]:\n        - /url: /audit/chain\n      - status \"Walk result\"\n      - generic [ref=e26]:\n        - generic [ref=e27]:\n          - slider \"Ledger walk\" [active] [ref=e28]: \"38\"\n          - generic [ref=e29]:\n            - generic [ref=e256]:\n              - generic [ref=e257]: Link 1\n              - generic [ref=e258]: ✓ Verified\n            - generic [ref=e259]:\n              - generic [ref=e260]: Link 2\n              - generic [ref=e261]: ✓ Verified\n            - generic [ref=e262]:\n              - generic [ref=e263]: Link 3\n              - generic [ref=e264]: ✓ Verified\n            - generic [ref=e265]:\n              - generic [ref=e266]: Link 4\n              - generic [ref=e267]: ✓ Verified\n            - generic [ref=e268]:\n              - generic [ref=e269]: Link 5\n              - generic [ref=e270]: ✓ Verified\n            - generic [ref=e271]:\n              - generic [ref=e272]: Link 6\n              - generic [ref=e273]: ✓ Verified\n            - generic [ref=e274]:\n              - generic [ref=e275]: Link 7\n              - generic [ref=e276]: ✓ Verified\n            - generic [ref=e277]:\n              - generic [ref=e278]: Link 8\n              - generic [ref=e279]: ✓ Verified\n            - generic [ref=e280]:\n              - generic [ref=e281]: Link 9\n              - generic [ref=e282]: ✓ Verified\n            - generic [ref=e283]:\n              - generic [ref=e284]: Link 10\n              - generic [ref=e285]: ✓ Verified\n            - generic [ref=e286]:\n              - generic [ref=e287]: Link 11\n              - generic [ref=e288]: ✓ Verified\n            - generic [ref=e289]:\n              - generic [ref=e290]: Link 12\n              - generic [ref=e291]: ✓ Verified\n            - generic [ref=e292]:\n              - generic [ref=e293]: Link 13\n              - generic [ref=e294]: ✓ Verified\n            - generic [ref=e295]:\n              - generic [ref=e296]: Link 14\n              - generic [ref=e297]: ✓ Verified\n            - generic [ref=e298]:\n              - generic [ref=e299]: Link 15\n              - generic [ref=e300]: ✓ Verified\n            - generic [ref=e301]:\n              - generic [ref=e302]: Link 16\n              - generic [ref=e303]: ✓ Verified\n            - generic [ref=e304]:\n              - generic [ref=e305]: Link 17\n              - generic [ref=e306]: ✓ Verified\n            - generic [ref=e307]:\n              - generic [ref=e308]: Link 18\n              - generic [ref=e309]: ✓ Verified\n            - generic [ref=e310]:\n              - generic [ref=e311]: Link 19\n              - generic [ref=e312]: ✓ Verified\n            - generic [ref=e313]:\n              - generic [ref=e314]: Link 20\n              - generic [ref=e315]: ✓ Verified\n            - generic [ref=e316]:\n              - generic [ref=e317]: Link 21\n              - generic [ref=e318]: ✓ Verified\n            - generic [ref=e319]:\n              - generic [ref=e320]: Link 22\n              - generic [ref=e321]: ✓ Verified\n            - generic [ref=e322]:\n              - generic [ref=e323]: Link 23\n              - generic [ref=e324]: ✓ Verified\n            - generic [ref=e325]:\n              - generic [ref=e326]: Link 24\n              - generic [ref=e327]: ✓ Verified\n            - generic [ref=e328]:\n              - generic [ref=e329]: Link 25\n              - generic [ref=e330]: ✓ Verified\n            - generic [ref=e331]:\n              - generic [ref=e332]: Link 26\n              - generic [ref=e333]: ✓ Verified\n            - generic [ref=e334]:\n              - generic [ref=e335]: Link 27\n              - generic [ref=e336]: ✓ Verified\n            - generic [ref=e337]:\n              - generic [ref=e338]: Link 28\n              - generic [ref=e339]: ✓ Verified\n            - generic [ref=e340]:\n              - generic [ref=e341]: Link 29\n              - generic [ref=e342]: ✓ Verified\n            - generic [ref=e343]:\n              - generic [ref=e344]: Link 30\n              - generic [ref=e345]: ✓ Verified\n            - generic [ref=e346]:\n              - generic [ref=e347]: Link 31\n              - generic [ref=e348]: ✓ Verified\n            - generic [ref=e349]:\n              - generic [ref=e350]: Link 32\n              - generic [ref=e351]: ✓ Verified\n            - generic [ref=e352]:\n              - generic [ref=e353]: Link 33\n              - generic [ref=e354]: ✓ Verified\n            - generic [ref=e355]:\n              - generic [ref=e356]: Link 34\n              - generic [ref=e357]: ✓ Verified\n            - generic [ref=e358]:\n              - generic [ref=e359]: Link 35\n              - generic [ref=e360]: ✓ Verified\n            - generic [ref=e361]:\n              - generic [ref=e362]: Link 36\n              - generic [ref=e363]: ✓ Verified\n            - generic [ref=e364]:\n              - generic [ref=e365]: Link 37\n              - generic [ref=e366]: ✓ Verified\n            - generic [ref=e367]:\n              - generic [ref=e368]: Link 38\n              - generic [ref=e369]: ✓ Verified\n            - generic [ref=e370]: Link 39\n            - generic [ref=e372]: Link 40\n            - generic [ref=e374]: Link 41\n            - generic [ref=e376]: Link 42\n            - generic [ref=e378]: Link 43\n            - generic [ref=e380]: Link 44\n            - generic [ref=e382]: Link 45\n            - generic [ref=e384]: Link 46\n            - generic [ref=e386]: Link 47\n            - generic [ref=e388]: Link 48\n            - generic [ref=e390]: Link 49\n            - generic [ref=e392]: Link 50\n            - generic [ref=e394]: Link 51\n            - generic [ref=e396]: Link 52\n            - generic [ref=e398]: Link 53\n            - generic [ref=e400]: Link 54\n            - generic [ref=e402]: Link 55\n            - generic [ref=e404]: Link 56\n            - generic [ref=e406]: Link 57\n            - generic [ref=e408]: Link 58\n            - generic [ref=e410]: Link 59\n            - generic [ref=e412]: Link 60\n            - generic [ref=e414]: Link 61\n            - generic [ref=e416]: Link 62\n            - generic [ref=e418]: Link 63\n            - generic [ref=e420]: Link 64\n            - generic [ref=e422]: Link 65\n            - generic [ref=e424]: Link 66\n            - generic [ref=e426]: Link 67\n            - generic [ref=e428]: Link 68\n            - generic [ref=e430]: Link 69\n            - generic [ref=e432]: Link 70\n            - generic [ref=e434]: Link 71\n            - generic [ref=e436]: Link 72\n            - generic [ref=e438]: Link 73\n            - generic [ref=e440]: Link 74\n            - generic [ref=e442]: Link 75\n        - generic [ref=e180]:\n          - region \"Digest panel\" [ref=e181]:\n            - heading \"Digest\" [level=2] [ref=e182]\n            - generic [ref=e183]:\n              - generic [ref=e184]: c\n              - generic [ref=e185]: \"4\"\n              - generic [ref=e186]: \"0\"\n              - generic [ref=e187]: a\n              - generic [ref=e188]: e\n              - generic [ref=e189]: \"1\"\n              - generic [ref=e190]: \"5\"\n              - generic [ref=e191]: e\n              - generic [ref=e192]: d\n              - generic [ref=e193]: a\n              - generic [ref=e194]: b\n              - generic [ref=e195]: \"3\"\n              - generic [ref=e196]: \"5\"\n              - generic [ref=e197]: \"2\"\n              - generic [ref=e198]: \"9\"\n              - generic [ref=e199]: b\n              - generic [ref=e200]: \"5\"\n              - generic [ref=e201]: d\n              - generic [ref=e202]: \"1\"\n              - generic [ref=e203]: a\n              - generic [ref=e204]: c\n              - generic [ref=e205]: \"4\"\n              - generic [ref=e206]: d\n              - generic [ref=e207]: b\n              - generic [ref=e208]: \"8\"\n              - generic [ref=e209]: \"5\"\n              - generic [ref=e210]: d\n              - generic [ref=e211]: \"7\"\n              - generic [ref=e212]: \"2\"\n              - generic [ref=e213]: \"2\"\n              - generic [ref=e214]: \"6\"\n              - generic [ref=e215]: \"9\"\n              - generic [ref=e216]: f\n              - generic [ref=e217]: b\n              - generic [ref=e218]: \"1\"\n              - generic [ref=e219]: \"9\"\n              - generic [ref=e220]: d\n              - generic [ref=e221]: d\n              - generic [ref=e222]: \"3\"\n              - generic [ref=e223]: b\n              - generic [ref=e224]: \"5\"\n              - generic [ref=e225]: c\n              - generic [ref=e226]: \"0\"\n              - generic [ref=e227]: \"1\"\n              - generic [ref=e228]: a\n              - generic [ref=e229]: e\n              - generic [ref=e230]: \"7\"\n              - generic [ref=e231]: \"1\"\n              - generic [ref=e232]: e\n              - generic [ref=e233]: \"3\"\n              - generic [ref=e234]: \"5\"\n              - generic [ref=e235]: a\n              - generic [ref=e236]: \"7\"\n              - generic [ref=e237]: c\n              - generic [ref=e238]: \"6\"\n              - generic [ref=e239]: e\n              - generic [ref=e240]: b\n              - generic [ref=e241]: \"7\"\n              - generic [ref=e242]: b\n              - generic [ref=e243]: \"0\"\n              - generic [ref=e244]: \"1\"\n              - generic [ref=e245]: \"4\"\n              - generic [ref=e246]: \"4\"\n              - generic [ref=e247]: \"0\"\n          - generic [ref=e248]:\n            - heading \"Anchors\" [level=2] [ref=e249]\n            - generic [ref=e250]: Current anchor\n            - textbox \"Current anchor\" [ref=e251]: wardline-anchor:v1:38:c40ae15edab3529b5d1ac4db85d72269fb19dd3b5c01ae71e35a7c6eb7b01440\n            - button \"Copy anchor\" [ref=e252] [cursor=pointer]\n            - generic [ref=e253]: Anchor to check\n            - textbox \"Anchor to check\" [ref=e254]\n            - button \"Check anchor\" [ref=e255] [cursor=pointer]\n            - status \"Anchor status\""
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
