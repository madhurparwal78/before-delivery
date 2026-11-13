
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
  "page": "- Page URL: http://127.0.0.1:4173/\n- Page Title: Missions",
  "snapshot": "- main [ref=e2]:\n  - heading \"Missions\" [level=1] [ref=e3]\n  - region \"Missions\" [ref=e4]:\n    - list \"Missions\" [ref=e5]:\n      - listitem [ref=e6]:\n        - link \"Tessera-3\" [ref=e7] [cursor=pointer]:\n          - /url: /missions/6c75ecf7-7a5e-4105-8638-238058819bbc\n  - generic [ref=e8]:\n    - heading \"New mission\" [level=2] [ref=e9]\n    - generic [ref=e10]:\n      - generic [ref=e11]: Mission name\n      - textbox \"Mission name\" [ref=e12]\n    - generic [ref=e13]:\n      - generic [ref=e14]: Epoch (GMT)\n      - textbox \"Epoch (GMT)\" [ref=e15]:\n        - /placeholder: 2026-073/00:00:00\n    - button \"Create mission\" [ref=e16] [cursor=pointer]\n  - region [ref=e17]:\n    - heading \"Archive plan\" [level=2] [ref=e18]\n    - generic [ref=e19]:\n      - paragraph [ref=e20]: \"Plan Free: Free\"\n      - paragraph [ref=e21]: Used 51.9 KiB of 256.0 MiB\n      - paragraph [ref=e22]: Next invoice 2026-12-08\n      - paragraph [ref=e23]: Balance 0.00 USD\n    - group \"Plan\" [ref=e24]:\n      - radiogroup \"Plan\" [ref=e26]:\n        - generic [ref=e27] [cursor=pointer]:\n          - radio \"Free, 256.0 MiB\" [checked] [ref=e28]\n          - text: Free, 256.0 MiB\n        - generic [ref=e29] [cursor=pointer]:\n          - radio \"Archive 1 GiB, 4.00 USD/month\" [ref=e30]\n          - text: Archive 1 GiB, 4.00 USD/month\n        - generic [ref=e31] [cursor=pointer]:\n          - radio \"Archive 10 GiB, 24.00 USD/month, billed 288.00 USD yearly\" [ref=e32]\n          - text: Archive 10 GiB, 24.00 USD/month, billed 288.00 USD yearly\n      - button \"Change plan\" [ref=e33] [cursor=pointer]\n    - status [ref=e34]"
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
  "page": "- Page URL: http://127.0.0.1:4173/\n- Page Title: Missions",
  "inlineSnapshot": "- main [ref=e2]:\n  - heading \"Missions\" [level=1] [ref=e3]\n  - region \"Missions\" [ref=e4]:\n    - list \"Missions\" [ref=e5]:\n      - listitem [ref=e6]\n  - generic [ref=e8]:\n    - heading \"New mission\" [level=2] [ref=e9]\n    - generic [ref=e10]:\n      - generic [ref=e11]: Mission name\n      - textbox \"Mission name\" [ref=e12]\n    - generic [ref=e13]:\n      - generic [ref=e14]: Epoch (GMT)\n      - textbox \"Epoch (GMT)\" [ref=e15]:\n        - /placeholder: 2026-073/00:00:00\n    - button \"Create mission\" [ref=e16] [cursor=pointer]\n  - region [ref=e17]:\n    - heading \"Archive plan\" [level=2] [ref=e18]\n    - generic [ref=e19]:\n      - paragraph [ref=e20]: \"Plan Free: Free\"\n      - paragraph [ref=e21]: Used 51.9 KiB of 256.0 MiB\n      - paragraph [ref=e22]: Next invoice 2026-12-08\n      - paragraph [ref=e23]: Balance 0.00 USD\n    - group \"Plan\" [ref=e24]:\n      - radiogroup \"Plan\" [ref=e26]\n      - button \"Change plan\" [ref=e33] [cursor=pointer]\n    - status [ref=e34]"
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
  "page": "- Page URL: http://127.0.0.1:4173/\n- Page Title: Missions",
  "inlineSnapshot": "- main [ref=e2]:\n  - heading \"Missions\" [level=1] [ref=e3]\n  - region \"Missions\" [ref=e4]:\n    - list \"Missions\" [ref=e5]:\n      - listitem [ref=e6]:\n        - link \"Tessera-3\" [ref=e7] [cursor=pointer]:\n          - /url: /missions/6c75ecf7-7a5e-4105-8638-238058819bbc\n  - generic [ref=e8]:\n    - heading \"New mission\" [level=2] [ref=e9]\n    - generic [ref=e10]:\n      - generic [ref=e11]: Mission name\n      - textbox \"Mission name\" [ref=e12]\n    - generic [ref=e13]:\n      - generic [ref=e14]: Epoch (GMT)\n      - textbox \"Epoch (GMT)\" [ref=e15]:\n        - /placeholder: 2026-073/00:00:00\n    - button \"Create mission\" [ref=e16] [cursor=pointer]\n  - region [ref=e17]:\n    - heading \"Archive plan\" [level=2] [ref=e18]\n    - generic [ref=e19]:\n      - paragraph [ref=e20]: \"Plan Free: Free\"\n      - paragraph [ref=e21]: Used 51.9 KiB of 256.0 MiB\n      - paragraph [ref=e22]: Next invoice 2026-12-08\n      - paragraph [ref=e23]: Balance 0.00 USD\n    - group \"Plan\" [ref=e24]:\n      - radiogroup \"Plan\" [ref=e26]:\n        - generic [ref=e27] [cursor=pointer]:\n          - radio \"Free, 256.0 MiB\" [checked] [ref=e28]\n          - text: Free, 256.0 MiB\n        - generic [ref=e29] [cursor=pointer]:\n          - radio \"Archive 1 GiB, 4.00 USD/month\" [ref=e30]\n          - text: Archive 1 GiB, 4.00 USD/month\n        - generic [ref=e31] [cursor=pointer]:\n          - radio \"Archive 10 GiB, 24.00 USD/month, billed 288.00 USD yearly\" [ref=e32]\n          - text: Archive 10 GiB, 24.00 USD/month, billed 288.00 USD yearly\n      - button \"Change plan\" [ref=e33] [cursor=pointer]\n    - status [ref=e34]"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Tessera-3",
  "target": "e7"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/missions/6c75ecf7-7a5e-4105-8638-238058819bbc\n- Page Title: Tessera-3",
  "snapshot": "- generic [active] [ref=f1e1]:\n  - generic [ref=f1e2]:\n    - paragraph [ref=f1e3]: +000:01:00:00\n    - button \"Channels\" [ref=f1e4] [cursor=pointer]\n  - main [ref=f1e5]:\n    - generic [ref=f1e6]:\n      - heading \"Tessera-3\" [level=1] [ref=f1e7]\n      - paragraph [ref=f1e8]: Epoch 2026-073/00:00:00\n      - paragraph [ref=f1e9]: Perilune 20.0 km at +000:02:00:00\n    - paragraph [ref=f1e11]: +000:01:00:00\n    - generic [ref=f1e12]:\n      - slider \"Track loupe\" [ref=f1e13]\n      - group \"Readout\" [ref=f1e15]:\n        - paragraph [ref=f1e16]: MET +000:01:00:00\n        - paragraph [ref=f1e17]: GMT 2026-073/01:00:00\n        - paragraph [ref=f1e18]: LAT 0.00° N\n        - paragraph [ref=f1e19]: LON 0.00° E\n        - paragraph [ref=f1e20]: ALT 100.0 km\n        - paragraph [ref=f1e21]: SPD 1600 m/s\n    - generic [ref=f1e22]:\n      - generic [ref=f1e23]:\n        - generic [ref=f1e24]: Go to GMT\n        - textbox \"Go to GMT\" [ref=f1e25]:\n          - /placeholder: 2026-073/02:00:00\n        - button \"Go\" [ref=f1e26] [cursor=pointer]\n      - generic [ref=f1e27]:\n        - button \"Play\" [ref=f1e28] [cursor=pointer]\n        - radiogroup \"Playback rate\" [ref=f1e29]:\n          - generic [ref=f1e30] [cursor=pointer]:\n            - radio \"1×\" [checked] [ref=f1e31]\n            - text: 1×\n          - generic [ref=f1e32] [cursor=pointer]:\n            - radio \"10×\" [ref=f1e33]\n            - text: 10×\n          - generic [ref=f1e34] [cursor=pointer]:\n            - radio \"60×\" [ref=f1e35]\n            - text: 60×\n      - button \"Pin event\" [ref=f1e36] [cursor=pointer]\n    - region [ref=f1e37]:\n      - heading \"Transcript\" [level=2] [ref=f1e38]\n      - generic [ref=f1e39]: Search transcript\n      - searchbox \"Search transcript\" [ref=f1e40]\n      - list \"Search results\"\n      - status [ref=f1e41]\n      - heading \"Speakers\" [level=3] [ref=f1e42]\n      - list \"Speakers\" [ref=f1e43]:\n        - listitem [ref=f1e44]:\n          - generic [ref=f1e45]: KESTREL\n          - generic [ref=f1e46]: \"3\"\n        - listitem [ref=f1e47]:\n          - generic [ref=f1e48]: TESSERA\n          - generic [ref=f1e49]: \"3\"\n      - list \"Transcript lines\" [ref=f1e50]:\n        - listitem [ref=f1e51]:\n          - 'button \"+000:01:00:00 KESTREL: Tessera, Kestrel. Acquisition of signal, loud and clear.\" [ref=f1e52] [cursor=pointer]'\n        - listitem [ref=f1e53]:\n          - 'button \"+000:01:20:00 TESSERA: Kestrel, Tessera. Star tracker locked, attitude nominal.\" [ref=f1e54] [cursor=pointer]'\n        - listitem [ref=f1e55]:\n          - 'button \"+000:01:59:10 KESTREL: Coming up on perilune. Altimeter should read two zero kilometres.\" [ref=f1e56] [cursor=pointer]'\n        - listitem [ref=f1e57]:\n          - 'button \"+000:02:00:00 TESSERA: Perilune. Doppler steady, all channels green.\" [ref=f1e58] [cursor=pointer]'\n        - listitem [ref=f1e59]:\n          - 'button \"+000:02:40:00 KESTREL: Two minutes to loss of signal.\" [ref=f1e60] [cursor=pointer]'\n        - listitem [ref=f1e61]:\n          - 'button \"+000:02:59:50 TESSERA: Kestrel, Tessera. See you on the next pass.\" [ref=f1e62] [cursor=pointer]'\n    - region [ref=f1e63]:\n      - heading \"Events\" [level=2] [ref=f1e64]\n      - region \"Events\" [ref=f1e65]:\n        - table \"Events\" [ref=f1e66]:\n          - rowgroup [ref=f1e67]:\n            - row [ref=f1e68]:\n              - columnheader \"MET\" [ref=f1e69]\n              - columnheader \"Title\" [ref=f1e70]\n              - columnheader \"Altitude\" [ref=f1e71]\n              - columnheader \"Speed\" [ref=f1e72]\n              - columnheader \"Note\" [ref=f1e73]\n          - rowgroup [ref=f1e74]:\n            - row [ref=f1e75]:\n              - cell \"+000:02:00:00\" [ref=f1e76]\n              - cell \"Perilune pass\" [ref=f1e77]\n              - cell \"20.0 km\" [ref=f1e78]\n              - cell \"1700 m/s\" [ref=f1e79]\n              - cell \"Check against Kestrel log sheet 14 before publishing.\" [ref=f1e80]\n      - paragraph [ref=f1e81]:\n        - link \"Download dossier\" [ref=f1e82] [cursor=pointer]:\n          - /url: /api/missions/6c75ecf7-7a5e-4105-8638-238058819bbc/dossier.pdf\n      - status [ref=f1e83]\n    - region [ref=f1e84]:\n      - heading \"Landmarks\" [level=2] [ref=f1e85]\n      - generic [ref=f1e86]:\n        - generic [ref=f1e87]: Landmark name\n        - textbox \"Landmark name\" [ref=f1e88]:\n          - /placeholder: Tessera-3 landing site\n        - generic [ref=f1e89]: Latitude\n        - textbox \"Latitude\" [ref=f1e90]:\n          - /placeholder: 12.5° S\n        - generic [ref=f1e91]: Longitude\n        - textbox \"Longitude\" [ref=f1e92]:\n          - /placeholder: 45.25° W\n        - button \"Add landmark\" [ref=f1e93] [cursor=pointer]\n      - list \"Landmarks\" [ref=f1e94]:\n        - listitem [ref=f1e95]: No landmarks\n    - region [ref=f1e96]:\n      - heading \"Reference\" [level=2] [ref=f1e97]\n      - generic [ref=f1e98]: Reference target\n      - textbox \"Reference target\" [ref=f1e99]:\n        - /placeholder: TESSERA-3\n      - button \"Set reference\" [ref=f1e100] [cursor=pointer]\n      - button \"Refresh reference\" [ref=f1e101] [cursor=pointer]\n      - paragraph\n    - region [ref=f1e102]:\n      - heading \"Passes\" [level=2] [ref=f1e103]\n      - generic [ref=f1e104]: Capture file\n      - button \"Capture file\" [ref=f1e105]\n      - list \"Passes\"\n      - status [ref=f1e106]\n    - region [ref=f1e107]:\n      - heading \"Share\" [level=2] [ref=f1e108]\n      - generic [ref=f1e109]:\n        - generic [ref=f1e110]: Link expiry (GMT)\n        - textbox \"Link expiry (GMT)\" [ref=f1e111]:\n          - /placeholder: 2026-103/00:00:00\n        - button \"Create share link\" [ref=f1e112] [cursor=pointer]\n      - paragraph [ref=f1e113]: \"Readers now: unknown\"\n      - status [ref=f1e114]\n    - region [ref=f1e115]:\n      - heading \"Subscribers\" [level=2] [ref=f1e116]\n      - generic [ref=f1e117]: Subscriber URL\n      - textbox \"Subscriber URL\" [ref=f1e118]:\n        - /placeholder: https://club.example/hooks/perilune\n      - button \"Add subscriber\" [ref=f1e119] [cursor=pointer]\n      - list \"Subscribers\""
}
```

### Tool call: browser_evaluate
- Args
```json
{
  "function": "() => {const s=document.querySelector('[aria-label=\"Track loupe\"]'); const r=s?.getBoundingClientRect(); return r?.toJSON()}"
}
```
- Result
```json
{
  "result": "{\n  \"x\": 16,\n  \"y\": -186.265625,\n  \"width\": 343,\n  \"height\": 343,\n  \"top\": -186.265625,\n  \"right\": 359,\n  \"bottom\": 156.734375,\n  \"left\": 16\n}"
}
```

### Tool call: browser_take_screenshot
- Args
```json
{
  "target": "[aria-label=\"Track loupe\"]",
  "type": "png",
  "filename": "evidence/touch-disc.png",
  "scale": "css"
}
```
- Result
```json
{
  "result": "- [Screenshot of element](evidence/touch-disc.png)"
}
```

### Tool call: browser_take_screenshot
- Args
```json
{
  "type": "png",
  "filename": "evidence/touch-disc-plate.png",
  "fullPage": false,
  "scale": "css"
}
```
- Result
```json
{
  "result": "- [Screenshot of viewport](evidence/touch-disc-plate.png)"
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
  "page": "- Page URL: http://127.0.0.1:4173/missions/6c75ecf7-7a5e-4105-8638-238058819bbc\n- Page Title: Tessera-3",
  "inlineSnapshot": "- generic [active] [ref=f1e1]:\n  - generic [ref=f1e2]:\n    - paragraph [ref=f1e3]: +000:01:00:00\n    - button \"Channels\" [ref=f1e4] [cursor=pointer]\n  - main [ref=f1e5]:\n    - generic [ref=f1e6]:\n      - heading \"Tessera-3\" [level=1] [ref=f1e7]\n      - paragraph [ref=f1e8]: Epoch 2026-073/00:00:00\n      - paragraph [ref=f1e9]: Perilune 20.0 km at +000:02:00:00\n    - paragraph [ref=f1e11]: +000:01:00:00\n    - generic [ref=f1e12]:\n      - slider \"Track loupe\" [ref=f1e13]\n      - group \"Readout\" [ref=f1e15]\n    - generic [ref=f1e22]:\n      - generic [ref=f1e23]\n      - generic [ref=f1e27]\n      - button \"Pin event\" [ref=f1e36] [cursor=pointer]\n    - region [ref=f1e37]:\n      - heading \"Transcript\" [level=2] [ref=f1e38]\n      - generic [ref=f1e39]: Search transcript\n      - searchbox \"Search transcript\" [ref=f1e40]\n      - list \"Search results\"\n      - status [ref=f1e41]\n      - heading \"Speakers\" [level=3] [ref=f1e42]\n      - list \"Speakers\" [ref=f1e43]\n      - list \"Transcript lines\" [ref=f1e50]\n    - region [ref=f1e63]:\n      - heading \"Events\" [level=2] [ref=f1e64]\n      - region \"Events\" [ref=f1e65]\n      - paragraph [ref=f1e81]\n      - status [ref=f1e83]\n    - region [ref=f1e84]:\n      - heading \"Landmarks\" [level=2] [ref=f1e85]\n      - generic [ref=f1e86]\n      - list \"Landmarks\" [ref=f1e94]\n    - region [ref=f1e96]:\n      - heading \"Reference\" [level=2] [ref=f1e97]\n      - generic [ref=f1e98]: Reference target\n      - textbox \"Reference target\" [ref=f1e99]:\n        - /placeholder: TESSERA-3\n      - button \"Set reference\" [ref=f1e100] [cursor=pointer]\n      - button \"Refresh reference\" [ref=f1e101] [cursor=pointer]\n      - paragraph [ref=f1e121]: No reference target\n    - region [ref=f1e102]:\n      - heading \"Passes\" [level=2] [ref=f1e103]\n      - generic [ref=f1e104]: Capture file\n      - button \"Capture file\" [ref=f1e105]\n      - list \"Passes\" [ref=f1e122]\n      - status [ref=f1e106]\n    - region [ref=f1e107]:\n      - heading \"Share\" [level=2] [ref=f1e108]\n      - generic [ref=f1e109]\n      - paragraph [ref=f1e113]: \"Readers now: 0\"\n      - status [ref=f1e114]\n    - region [ref=f1e115]:\n      - heading \"Subscribers\" [level=2] [ref=f1e116]\n      - generic [ref=f1e117]: Subscriber URL\n      - textbox \"Subscriber URL\" [ref=f1e118]:\n        - /placeholder: https://club.example/hooks/perilune\n      - button \"Add subscriber\" [ref=f1e119] [cursor=pointer]\n      - list \"Subscribers\" [ref=f1e130]"
}
```

### Tool call: browser_take_screenshot
- Args
```json
{
  "target": "#events-region",
  "type": "png",
  "filename": "evidence/touch-events.png",
  "scale": "css"
}
```
- Result
```json
{
  "result": "- [Screenshot of element](evidence/touch-events.png)"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Channels",
  "target": "f1e4"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/missions/6c75ecf7-7a5e-4105-8638-238058819bbc\n- Page Title: Tessera-3",
  "snapshot": "- generic [ref=f1e1]:\n  - generic [ref=f1e2]:\n    - paragraph [ref=f1e3]: +000:01:00:00\n    - button \"Channels\" [expanded] [ref=f1e4] [cursor=pointer]\n  - main [ref=f1e5]:\n    - generic [ref=f1e6]:\n      - heading \"Tessera-3\" [level=1] [ref=f1e7]\n      - paragraph [ref=f1e8]: Epoch 2026-073/00:00:00\n      - paragraph [ref=f1e9]: Perilune 20.0 km at +000:02:00:00\n    - paragraph [ref=f1e11]: +000:01:00:00\n    - dialog \"Channels\" [ref=f1e132]:\n      - heading \"Channels\" [level=2] [ref=f1e133]\n      - group \"Distance\" [ref=f1e134]:\n        - radiogroup \"Distance\" [ref=f1e136]:\n          - generic [ref=f1e137] [cursor=pointer]:\n            - radio \"km\" [checked] [active] [ref=f1e138]\n            - text: km\n          - generic [ref=f1e139] [cursor=pointer]:\n            - radio \"nmi\" [ref=f1e140]\n            - text: nmi\n      - group \"Speed\" [ref=f1e141]:\n        - radiogroup \"Speed\" [ref=f1e143]:\n          - generic [ref=f1e144] [cursor=pointer]:\n            - radio \"m/s\" [checked] [ref=f1e145]\n            - text: m/s\n          - generic [ref=f1e146] [cursor=pointer]:\n            - radio \"ft/s\" [ref=f1e147]\n            - text: ft/s\n      - generic [ref=f1e148] [cursor=pointer]:\n        - checkbox \"Event pins\" [checked] [ref=f1e149]\n        - text: Event pins\n      - generic [ref=f1e150] [cursor=pointer]:\n        - checkbox \"Transcript ticks\" [checked] [ref=f1e151]\n        - text: Transcript ticks\n      - button \"Close channels\" [ref=f1e152] [cursor=pointer]\n    - generic [ref=f1e12]:\n      - slider \"Track loupe\" [ref=f1e13]\n      - group \"Readout\" [ref=f1e15]:\n        - paragraph [ref=f1e16]: MET +000:01:00:00\n        - paragraph [ref=f1e17]: GMT 2026-073/01:00:00\n        - paragraph [ref=f1e18]: LAT 0.00° N\n        - paragraph [ref=f1e19]: LON 0.00° E\n        - paragraph [ref=f1e20]: ALT 100.0 km\n        - paragraph [ref=f1e21]: SPD 1600 m/s\n    - generic [ref=f1e22]:\n      - generic [ref=f1e23]:\n        - generic [ref=f1e24]: Go to GMT\n        - textbox \"Go to GMT\" [ref=f1e25]:\n          - /placeholder: 2026-073/02:00:00\n        - button \"Go\" [ref=f1e26] [cursor=pointer]\n      - generic [ref=f1e27]:\n        - button \"Play\" [ref=f1e28] [cursor=pointer]\n        - radiogroup \"Playback rate\" [ref=f1e29]:\n          - generic [ref=f1e30] [cursor=pointer]:\n            - radio \"1×\" [checked] [ref=f1e31]\n            - text: 1×\n          - generic [ref=f1e32] [cursor=pointer]:\n            - radio \"10×\" [ref=f1e33]\n            - text: 10×\n          - generic [ref=f1e34] [cursor=pointer]:\n            - radio \"60×\" [ref=f1e35]\n            - text: 60×\n      - button \"Pin event\" [ref=f1e36] [cursor=pointer]\n    - region [ref=f1e37]:\n      - heading \"Transcript\" [level=2] [ref=f1e38]\n      - generic [ref=f1e39]: Search transcript\n      - searchbox \"Search transcript\" [ref=f1e40]\n      - list \"Search results\"\n      - status [ref=f1e41]\n      - heading \"Speakers\" [level=3] [ref=f1e42]\n      - list \"Speakers\" [ref=f1e43]:\n        - listitem [ref=f1e44]:\n          - generic [ref=f1e45]: KESTREL\n          - generic [ref=f1e46]: \"3\"\n        - listitem [ref=f1e47]:\n          - generic [ref=f1e48]: TESSERA\n          - generic [ref=f1e49]: \"3\"\n      - list \"Transcript lines\" [ref=f1e50]:\n        - listitem [ref=f1e51]:\n          - 'button \"+000:01:00:00 KESTREL: Tessera, Kestrel. Acquisition of signal, loud and clear.\" [ref=f1e52] [cursor=pointer]'\n        - listitem [ref=f1e53]:\n          - 'button \"+000:01:20:00 TESSERA: Kestrel, Tessera. Star tracker locked, attitude nominal.\" [ref=f1e54] [cursor=pointer]'\n        - listitem [ref=f1e55]:\n          - 'button \"+000:01:59:10 KESTREL: Coming up on perilune. Altimeter should read two zero kilometres.\" [ref=f1e56] [cursor=pointer]'\n        - listitem [ref=f1e57]:\n          - 'button \"+000:02:00:00 TESSERA: Perilune. Doppler steady, all channels green.\" [ref=f1e58] [cursor=pointer]'\n        - listitem [ref=f1e59]:\n          - 'button \"+000:02:40:00 KESTREL: Two minutes to loss of signal.\" [ref=f1e60] [cursor=pointer]'\n        - listitem [ref=f1e61]:\n          - 'button \"+000:02:59:50 TESSERA: Kestrel, Tessera. See you on the next pass.\" [ref=f1e62] [cursor=pointer]'\n    - region [ref=f1e63]:\n      - heading \"Events\" [level=2] [ref=f1e64]\n      - region \"Events\" [ref=f1e65]:\n        - table \"Events\" [ref=f1e66]:\n          - rowgroup [ref=f1e67]:\n            - row [ref=f1e68]:\n              - columnheader \"MET\" [ref=f1e69]\n              - columnheader \"Title\" [ref=f1e70]\n              - columnheader \"Altitude\" [ref=f1e71]\n              - columnheader \"Speed\" [ref=f1e72]\n              - columnheader \"Note\" [ref=f1e73]\n          - rowgroup [ref=f1e74]:\n            - row [ref=f1e75]:\n              - cell \"+000:02:00:00\" [ref=f1e76]\n              - cell \"Perilune pass\" [ref=f1e77]\n              - cell \"20.0 km\" [ref=f1e78]\n              - cell \"1700 m/s\" [ref=f1e79]\n              - cell \"Check against Kestrel log sheet 14 before publishing.\" [ref=f1e80]\n      - paragraph [ref=f1e81]:\n        - link \"Download dossier\" [ref=f1e82] [cursor=pointer]:\n          - /url: /api/missions/6c75ecf7-7a5e-4105-8638-238058819bbc/dossier.pdf\n      - status [ref=f1e83]\n    - region [ref=f1e84]:\n      - heading \"Landmarks\" [level=2] [ref=f1e85]\n      - generic [ref=f1e86]:\n        - generic [ref=f1e87]: Landmark name\n        - textbox \"Landmark name\" [ref=f1e88]:\n          - /placeholder: Tessera-3 landing site\n        - generic [ref=f1e89]: Latitude\n        - textbox \"Latitude\" [ref=f1e90]:\n          - /placeholder: 12.5° S\n        - generic [ref=f1e91]: Longitude\n        - textbox \"Longitude\" [ref=f1e92]:\n          - /placeholder: 45.25° W\n        - button \"Add landmark\" [ref=f1e93] [cursor=pointer]\n      - list \"Landmarks\" [ref=f1e94]:\n        - listitem [ref=f1e120]: No landmarks\n    - region [ref=f1e96]:\n      - heading \"Reference\" [level=2] [ref=f1e97]\n      - generic [ref=f1e98]: Reference target\n      - textbox \"Reference target\" [ref=f1e99]:\n        - /placeholder: TESSERA-3\n      - button \"Set reference\" [ref=f1e100] [cursor=pointer]\n      - button \"Refresh reference\" [ref=f1e101] [cursor=pointer]\n      - paragraph [ref=f1e121]: No reference target\n    - region [ref=f1e102]:\n      - heading \"Passes\" [level=2] [ref=f1e103]\n      - generic [ref=f1e104]: Capture file\n      - button \"Capture file\" [ref=f1e105]\n      - list \"Passes\" [ref=f1e122]:\n        - listitem [ref=f1e123]:\n          - generic [ref=f1e124]: tessera3-orbit1.cap\n          - generic [ref=f1e125]: \"Parsed: 720 samples\"\n          - generic [ref=f1e126]: 53144 bytes\n          - generic [ref=f1e127]:\n            - link \"Download tessera3-orbit1.cap\" [ref=f1e128] [cursor=pointer]:\n              - /url: /api/passes/5e63c77e-983b-42e5-b940-bbf6b4e011d4/capture\n              - text: Download\n            - button \"Delete tessera3-orbit1.cap\" [ref=f1e129] [cursor=pointer]: Delete\n      - status [ref=f1e106]\n    - region [ref=f1e107]:\n      - heading \"Share\" [level=2] [ref=f1e108]\n      - generic [ref=f1e109]:\n        - generic [ref=f1e110]: Link expiry (GMT)\n        - textbox \"Link expiry (GMT)\" [ref=f1e111]:\n          - /placeholder: 2026-103/00:00:00\n        - button \"Create share link\" [ref=f1e112] [cursor=pointer]\n      - paragraph [ref=f1e113]: \"Readers now: 0\"\n      - status [ref=f1e114]\n    - region [ref=f1e115]:\n      - heading \"Subscribers\" [level=2] [ref=f1e116]\n      - generic [ref=f1e117]: Subscriber URL\n      - textbox \"Subscriber URL\" [ref=f1e118]:\n        - /placeholder: https://club.example/hooks/perilune\n      - button \"Add subscriber\" [ref=f1e119] [cursor=pointer]\n      - list \"Subscribers\" [ref=f1e130]:\n        - listitem [ref=f1e131]: No subscribers"
}
```

### Tool call: browser_take_screenshot
- Args
```json
{
  "type": "png",
  "filename": "evidence/touch-channels.png",
  "fullPage": false,
  "scale": "css"
}
```
- Result
```json
{
  "result": "- [Screenshot of viewport](evidence/touch-channels.png)"
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
  "page": "- Page URL: http://127.0.0.1:4173/missions/6c75ecf7-7a5e-4105-8638-238058819bbc\n- Page Title: Tessera-3",
  "inlineSnapshot": "- generic [ref=f1e1]:\n  - generic [ref=f1e2]:\n    - paragraph [ref=f1e3]: +000:01:00:00\n    - button \"Channels\" [expanded] [ref=f1e4] [cursor=pointer]\n  - main [ref=f1e5]:\n    - generic [ref=f1e6]:\n      - heading \"Tessera-3\" [level=1] [ref=f1e7]\n      - paragraph [ref=f1e8]: Epoch 2026-073/00:00:00\n      - paragraph [ref=f1e9]: Perilune 20.0 km at +000:02:00:00\n    - paragraph [ref=f1e11]: +000:01:00:00\n    - dialog \"Channels\" [ref=f1e132]:\n      - heading \"Channels\" [level=2] [ref=f1e133]\n      - group \"Distance\" [ref=f1e134]\n      - group \"Speed\" [ref=f1e141]\n      - generic [ref=f1e148] [cursor=pointer]\n      - generic [ref=f1e150] [cursor=pointer]\n      - button \"Close channels\" [ref=f1e152] [cursor=pointer]\n    - generic [ref=f1e12]:\n      - slider \"Track loupe\" [ref=f1e13]\n      - group \"Readout\" [ref=f1e15]\n    - generic [ref=f1e22]:\n      - generic [ref=f1e23]\n      - generic [ref=f1e27]\n      - button \"Pin event\" [ref=f1e36] [cursor=pointer]\n    - region [ref=f1e37]:\n      - heading \"Transcript\" [level=2] [ref=f1e38]\n      - generic [ref=f1e39]: Search transcript\n      - searchbox \"Search transcript\" [ref=f1e40]\n      - list \"Search results\"\n      - status [ref=f1e41]\n      - heading \"Speakers\" [level=3] [ref=f1e42]\n      - list \"Speakers\" [ref=f1e43]\n      - list \"Transcript lines\" [ref=f1e50]\n    - region [ref=f1e63]:\n      - heading \"Events\" [level=2] [ref=f1e64]\n      - region \"Events\" [ref=f1e65]\n      - paragraph [ref=f1e81]\n      - status [ref=f1e83]\n    - region [ref=f1e84]:\n      - heading \"Landmarks\" [level=2] [ref=f1e85]\n      - generic [ref=f1e86]\n      - list \"Landmarks\" [ref=f1e94]\n    - region [ref=f1e96]:\n      - heading \"Reference\" [level=2] [ref=f1e97]\n      - generic [ref=f1e98]: Reference target\n      - textbox \"Reference target\" [ref=f1e99]:\n        - /placeholder: TESSERA-3\n      - button \"Set reference\" [ref=f1e100] [cursor=pointer]\n      - button \"Refresh reference\" [ref=f1e101] [cursor=pointer]\n      - paragraph [ref=f1e121]: No reference target\n    - region [ref=f1e102]:\n      - heading \"Passes\" [level=2] [ref=f1e103]\n      - generic [ref=f1e104]: Capture file\n      - button \"Capture file\" [ref=f1e105]\n      - list \"Passes\" [ref=f1e122]\n      - status [ref=f1e106]\n    - region [ref=f1e107]:\n      - heading \"Share\" [level=2] [ref=f1e108]\n      - generic [ref=f1e109]\n      - paragraph [ref=f1e113]: \"Readers now: 0\"\n      - status [ref=f1e114]\n    - region [ref=f1e115]:\n      - heading \"Subscribers\" [level=2] [ref=f1e116]\n      - generic [ref=f1e117]: Subscriber URL\n      - textbox \"Subscriber URL\" [ref=f1e118]:\n        - /placeholder: https://club.example/hooks/perilune\n      - button \"Add subscriber\" [ref=f1e119] [cursor=pointer]\n      - list \"Subscribers\" [ref=f1e130]"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Close channels",
  "target": "f1e152"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/missions/6c75ecf7-7a5e-4105-8638-238058819bbc\n- Page Title: Tessera-3",
  "snapshot": "- generic [ref=f1e1]:\n  - generic [ref=f1e2]:\n    - paragraph [ref=f1e3]: +000:01:00:00\n    - button \"Channels\" [active] [ref=f1e4] [cursor=pointer]\n  - main [ref=f1e5]:\n    - generic [ref=f1e6]:\n      - heading \"Tessera-3\" [level=1] [ref=f1e7]\n      - paragraph [ref=f1e8]: Epoch 2026-073/00:00:00\n      - paragraph [ref=f1e9]: Perilune 20.0 km at +000:02:00:00\n    - paragraph [ref=f1e11]: +000:01:00:00\n    - generic [ref=f1e12]:\n      - slider \"Track loupe\" [ref=f1e13]\n      - group \"Readout\" [ref=f1e15]:\n        - paragraph [ref=f1e16]: MET +000:01:00:00\n        - paragraph [ref=f1e17]: GMT 2026-073/01:00:00\n        - paragraph [ref=f1e18]: LAT 0.00° N\n        - paragraph [ref=f1e19]: LON 0.00° E\n        - paragraph [ref=f1e20]: ALT 100.0 km\n        - paragraph [ref=f1e21]: SPD 1600 m/s\n    - generic [ref=f1e22]:\n      - generic [ref=f1e23]:\n        - generic [ref=f1e24]: Go to GMT\n        - textbox \"Go to GMT\" [ref=f1e25]:\n          - /placeholder: 2026-073/02:00:00\n        - button \"Go\" [ref=f1e26] [cursor=pointer]\n      - generic [ref=f1e27]:\n        - button \"Play\" [ref=f1e28] [cursor=pointer]\n        - radiogroup \"Playback rate\" [ref=f1e29]:\n          - generic [ref=f1e30] [cursor=pointer]:\n            - radio \"1×\" [checked] [ref=f1e31]\n            - text: 1×\n          - generic [ref=f1e32] [cursor=pointer]:\n            - radio \"10×\" [ref=f1e33]\n            - text: 10×\n          - generic [ref=f1e34] [cursor=pointer]:\n            - radio \"60×\" [ref=f1e35]\n            - text: 60×\n      - button \"Pin event\" [ref=f1e36] [cursor=pointer]\n    - region [ref=f1e37]:\n      - heading \"Transcript\" [level=2] [ref=f1e38]\n      - generic [ref=f1e39]: Search transcript\n      - searchbox \"Search transcript\" [ref=f1e40]\n      - list \"Search results\"\n      - status [ref=f1e41]\n      - heading \"Speakers\" [level=3] [ref=f1e42]\n      - list \"Speakers\" [ref=f1e43]:\n        - listitem [ref=f1e44]:\n          - generic [ref=f1e45]: KESTREL\n          - generic [ref=f1e46]: \"3\"\n        - listitem [ref=f1e47]:\n          - generic [ref=f1e48]: TESSERA\n          - generic [ref=f1e49]: \"3\"\n      - list \"Transcript lines\" [ref=f1e50]:\n        - listitem [ref=f1e51]:\n          - 'button \"+000:01:00:00 KESTREL: Tessera, Kestrel. Acquisition of signal, loud and clear.\" [ref=f1e52] [cursor=pointer]'\n        - listitem [ref=f1e53]:\n          - 'button \"+000:01:20:00 TESSERA: Kestrel, Tessera. Star tracker locked, attitude nominal.\" [ref=f1e54] [cursor=pointer]'\n        - listitem [ref=f1e55]:\n          - 'button \"+000:01:59:10 KESTREL: Coming up on perilune. Altimeter should read two zero kilometres.\" [ref=f1e56] [cursor=pointer]'\n        - listitem [ref=f1e57]:\n          - 'button \"+000:02:00:00 TESSERA: Perilune. Doppler steady, all channels green.\" [ref=f1e58] [cursor=pointer]'\n        - listitem [ref=f1e59]:\n          - 'button \"+000:02:40:00 KESTREL: Two minutes to loss of signal.\" [ref=f1e60] [cursor=pointer]'\n        - listitem [ref=f1e61]:\n          - 'button \"+000:02:59:50 TESSERA: Kestrel, Tessera. See you on the next pass.\" [ref=f1e62] [cursor=pointer]'\n    - region [ref=f1e63]:\n      - heading \"Events\" [level=2] [ref=f1e64]\n      - region \"Events\" [ref=f1e65]:\n        - table \"Events\" [ref=f1e66]:\n          - rowgroup [ref=f1e67]:\n            - row [ref=f1e68]:\n              - columnheader \"MET\" [ref=f1e69]\n              - columnheader \"Title\" [ref=f1e70]\n              - columnheader \"Altitude\" [ref=f1e71]\n              - columnheader \"Speed\" [ref=f1e72]\n              - columnheader \"Note\" [ref=f1e73]\n          - rowgroup [ref=f1e74]:\n            - row [ref=f1e75]:\n              - cell \"+000:02:00:00\" [ref=f1e76]\n              - cell \"Perilune pass\" [ref=f1e77]\n              - cell \"20.0 km\" [ref=f1e78]\n              - cell \"1700 m/s\" [ref=f1e79]\n              - cell \"Check against Kestrel log sheet 14 before publishing.\" [ref=f1e80]\n      - paragraph [ref=f1e81]:\n        - link \"Download dossier\" [ref=f1e82] [cursor=pointer]:\n          - /url: /api/missions/6c75ecf7-7a5e-4105-8638-238058819bbc/dossier.pdf\n      - status [ref=f1e83]\n    - region [ref=f1e84]:\n      - heading \"Landmarks\" [level=2] [ref=f1e85]\n      - generic [ref=f1e86]:\n        - generic [ref=f1e87]: Landmark name\n        - textbox \"Landmark name\" [ref=f1e88]:\n          - /placeholder: Tessera-3 landing site\n        - generic [ref=f1e89]: Latitude\n        - textbox \"Latitude\" [ref=f1e90]:\n          - /placeholder: 12.5° S\n        - generic [ref=f1e91]: Longitude\n        - textbox \"Longitude\" [ref=f1e92]:\n          - /placeholder: 45.25° W\n        - button \"Add landmark\" [ref=f1e93] [cursor=pointer]\n      - list \"Landmarks\" [ref=f1e94]:\n        - listitem [ref=f1e120]: No landmarks\n    - region [ref=f1e96]:\n      - heading \"Reference\" [level=2] [ref=f1e97]\n      - generic [ref=f1e98]: Reference target\n      - textbox \"Reference target\" [ref=f1e99]:\n        - /placeholder: TESSERA-3\n      - button \"Set reference\" [ref=f1e100] [cursor=pointer]\n      - button \"Refresh reference\" [ref=f1e101] [cursor=pointer]\n      - paragraph [ref=f1e121]: No reference target\n    - region [ref=f1e102]:\n      - heading \"Passes\" [level=2] [ref=f1e103]\n      - generic [ref=f1e104]: Capture file\n      - button \"Capture file\" [ref=f1e105]\n      - list \"Passes\" [ref=f1e122]:\n        - listitem [ref=f1e123]:\n          - generic [ref=f1e124]: tessera3-orbit1.cap\n          - generic [ref=f1e125]: \"Parsed: 720 samples\"\n          - generic [ref=f1e126]: 53144 bytes\n          - generic [ref=f1e127]:\n            - link \"Download tessera3-orbit1.cap\" [ref=f1e128] [cursor=pointer]:\n              - /url: /api/passes/5e63c77e-983b-42e5-b940-bbf6b4e011d4/capture\n              - text: Download\n            - button \"Delete tessera3-orbit1.cap\" [ref=f1e129] [cursor=pointer]: Delete\n      - status [ref=f1e106]\n    - region [ref=f1e107]:\n      - heading \"Share\" [level=2] [ref=f1e108]\n      - generic [ref=f1e109]:\n        - generic [ref=f1e110]: Link expiry (GMT)\n        - textbox \"Link expiry (GMT)\" [ref=f1e111]:\n          - /placeholder: 2026-103/00:00:00\n        - button \"Create share link\" [ref=f1e112] [cursor=pointer]\n      - paragraph [ref=f1e113]: \"Readers now: 0\"\n      - status [ref=f1e114]\n    - region [ref=f1e115]:\n      - heading \"Subscribers\" [level=2] [ref=f1e116]\n      - generic [ref=f1e117]: Subscriber URL\n      - textbox \"Subscriber URL\" [ref=f1e118]:\n        - /placeholder: https://club.example/hooks/perilune\n      - button \"Add subscriber\" [ref=f1e119] [cursor=pointer]\n      - list \"Subscribers\" [ref=f1e130]:\n        - listitem [ref=f1e131]: No subscribers"
}
```
