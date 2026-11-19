
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
  "page": "- Page URL: http://127.0.0.1:4173/\n- Page Title: Dotgain",
  "snapshot": "- generic [active] [ref=e1]:\n  - region \"Service notice\"\n  - banner [ref=e2]:\n    - link \"Dotgain\" [ref=e3] [cursor=pointer]:\n      - /url: /\n      - text: DOTGAIN\n    - navigation \"Site\" [ref=e4]:\n      - link \"Campaigns\" [ref=e5] [cursor=pointer]:\n        - /url: /campaigns\n      - link \"My pledges\" [ref=e6] [cursor=pointer]:\n        - /url: /pledges\n      - link \"Studio\" [ref=e7] [cursor=pointer]:\n        - /url: /studio\n  - region \"Dotgain hero\" [ref=e8]:\n    - generic [ref=e24]:\n      - heading \"PRINT IT IF THEY BACK IT\" [level=1] [ref=e25]: PRINT IT IFTHEY BACK IT\n      - paragraph [ref=e26]: All-or-nothing pledges for comics, zines and art books. No card is charged unless the print run is funded.\n      - link [ref=e27] [cursor=pointer]:\n        - /url: /studio\n        - button \"Start a campaign\" [ref=e28]\n  - main [ref=e29]:\n    - region [ref=e30]:\n      - heading \"Live campaigns\" [level=2] [ref=e31]\n      - list \"Live campaigns\" [ref=e32]:\n        - listitem [ref=e33]:\n          - link [ref=e35] [cursor=pointer]:\n            - /url: /campaigns/saltmarsh-nocturnes\n            - strong [ref=e36]: Saltmarsh Nocturnes\n          - generic [ref=e37]: £0.00\n          - 'img \"Plate Fill: 0%\" [ref=e39]':\n            - 'img \"Plate Fill: 0% of the minimum run\" [ref=e40]'\n        - listitem [ref=e41]:\n          - link [ref=e43] [cursor=pointer]:\n            - /url: /campaigns/fold-here\n            - strong [ref=e44]: Fold Here\n          - generic [ref=e45]: £10.00\n          - 'img \"Plate Fill: 1%\" [ref=e47]':\n            - 'img \"Plate Fill: 1% of the minimum run\" [ref=e48]'"
}
```

### Tool call: browser_navigate
- Args
```json
{
  "url": "http://127.0.0.1:4173/campaigns/fold-here"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/campaigns/fold-here\n- Page Title: Fold Here — Dotgain\n- Console: 1 errors, 0 warnings",
  "snapshot": "- generic [active] [ref=f1e1]:\n  - region \"Service notice\"\n  - banner [ref=f1e2]:\n    - link \"Dotgain\" [ref=f1e3] [cursor=pointer]:\n      - /url: /\n      - text: DOTGAIN\n    - navigation \"Site\" [ref=f1e4]:\n      - link \"Campaigns\" [ref=f1e5] [cursor=pointer]:\n        - /url: /campaigns\n      - link \"My pledges\" [ref=f1e6] [cursor=pointer]:\n        - /url: /pledges\n      - link \"Studio\" [ref=f1e7] [cursor=pointer]:\n        - /url: /studio\n  - main [ref=f1e8]:\n    - generic [ref=f1e9]:\n      - generic [ref=f1e10]:\n        - img \"Campaign cover\" [ref=f1e11]\n        - heading \"Fold Here\" [level=1] [ref=f1e12]\n        - paragraph [ref=f1e13]: by Ines Calloway\n        - paragraph [ref=f1e15]: A folded zine about origami for people with two left hands. Every page folds into a small paper animal by following the printed crease lines. The minimum digital run at my press is 100 copies.\n        - region [ref=f1e26]:\n          - heading \"Reward tiers\" [level=2] [ref=f1e27]\n          - generic [ref=f1e28]:\n            - heading \"Reward tier\" [level=3] [ref=f1e29]\n            - generic [ref=f1e31]:\n              - radio [ref=f1e32]\n              - generic [ref=f1e33]: Zine — £6.00\n              - generic [ref=f1e34]: Open edition\n              - button \"Open Zine\" [ref=f1e35] [cursor=pointer]\n            - generic [ref=f1e37]:\n              - radio [ref=f1e38]\n              - generic [ref=f1e39]: Zine and risograph print — £15.00\n              - generic [ref=f1e40]: 25 of 25 left\n              - button \"Open Zine and risograph print\" [ref=f1e41] [cursor=pointer]\n      - generic [ref=f1e42]:\n        - 'img \"Plate Fill: 3% of the minimum run\" [ref=f1e44]'\n        - generic [ref=f1e46]:\n          - paragraph [ref=f1e47]: Pledged so far\n          - paragraph [ref=f1e48]: £20.00\n          - generic [ref=f1e49]:\n            - paragraph [ref=f1e50]: Goal £600.00\n            - paragraph [ref=f1e51]: Minimum run 100 copies\n          - timer \"Time left\" [ref=f1e52]: 30 days 19:23:58\n        - region [ref=f1e53]:\n          - heading \"Pledge\" [level=2] [ref=f1e54]\n          - status [ref=f1e55]\n          - status \"Loading\" [ref=f1e57]"
}
```
