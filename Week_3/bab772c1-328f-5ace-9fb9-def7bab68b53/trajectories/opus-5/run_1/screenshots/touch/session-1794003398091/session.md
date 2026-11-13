
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
  "page": "- Page URL: http://127.0.0.1:4173/\n- Page Title: Missions · Perilune Ledger",
  "snapshot": "- main [ref=e2]:\n  - heading \"Missions\" [level=1] [ref=e3]\n  - list \"Missions\" [ref=e4]:\n    - listitem [ref=e5]:\n      - link \"Tessera-3\" [ref=e6] [cursor=pointer]:\n        - /url: /missions/757bb96a-f6c3-47e3-93d0-09c32989a826\n  - generic [ref=e7]:\n    - heading \"New mission\" [level=2] [ref=e8]\n    - generic [ref=e9]: Mission name\n    - textbox \"Mission name\" [ref=e10]\n    - generic [ref=e11]: Epoch (GMT)\n    - textbox \"Epoch (GMT)\" [ref=e12]:\n      - /placeholder: 2026-073/00:00:00\n    - button \"Create mission\" [ref=e13] [cursor=pointer]\n  - region \"Archive plan\" [ref=e14]:\n    - heading \"Archive plan\" [level=2] [ref=e15]\n    - generic [ref=e16]:\n      - paragraph [ref=e17]: \"Plan Archive 1 GiB: 4.00 USD/month\"\n      - paragraph [ref=e18]: Used 51.9 KiB of 1.0 GiB\n      - paragraph [ref=e19]: Next invoice 2026-12-06\n      - paragraph [ref=e20]: Balance 4.00 USD\n    - radiogroup \"Plan\" [ref=e21]:\n      - generic [ref=e22]:\n        - radio \"Free, 256.0 MiB\" [ref=e23]\n        - generic [ref=e24]: Free, 256.0 MiB\n      - generic [ref=e25]:\n        - radio \"Archive 1 GiB, 4.00 USD/month\" [checked] [ref=e26]\n        - generic [ref=e27]: Archive 1 GiB, 4.00 USD/month\n      - generic [ref=e28]:\n        - radio \"Archive 10 GiB, 24.00 USD/month, billed 288.00 USD yearly\" [ref=e29]\n        - generic [ref=e30]: Archive 10 GiB, 24.00 USD/month, billed 288.00 USD yearly\n    - button \"Change plan\" [ref=e31] [cursor=pointer]\n    - status \"Plan status\" [ref=e32]"
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
  "page": "- Page URL: http://127.0.0.1:4173/\n- Page Title: Missions · Perilune Ledger",
  "inlineSnapshot": "- main [ref=e2]:\n  - heading \"Missions\" [level=1] [ref=e3]\n  - list \"Missions\" [ref=e4]:\n    - listitem [ref=e5]:\n      - link \"Tessera-3\" [ref=e6] [cursor=pointer]:\n        - /url: /missions/757bb96a-f6c3-47e3-93d0-09c32989a826\n  - generic [ref=e7]:\n    - heading \"New mission\" [level=2] [ref=e8]\n    - generic [ref=e9]: Mission name\n    - textbox \"Mission name\" [ref=e10]\n    - generic [ref=e11]: Epoch (GMT)\n    - textbox \"Epoch (GMT)\" [ref=e12]:\n      - /placeholder: 2026-073/00:00:00\n    - button \"Create mission\" [ref=e13] [cursor=pointer]\n  - region \"Archive plan\" [ref=e14]:\n    - heading \"Archive plan\" [level=2] [ref=e15]\n    - generic [ref=e16]:\n      - paragraph [ref=e17]: \"Plan Archive 1 GiB: 4.00 USD/month\"\n      - paragraph [ref=e18]: Used 51.9 KiB of 1.0 GiB\n      - paragraph [ref=e19]: Next invoice 2026-12-06\n      - paragraph [ref=e20]: Balance 4.00 USD\n    - radiogroup \"Plan\" [ref=e21]:\n      - generic [ref=e22]\n      - generic [ref=e25]\n      - generic [ref=e28]\n    - button \"Change plan\" [ref=e31] [cursor=pointer]\n    - status \"Plan status\" [ref=e32]"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Tessera-3",
  "target": "e6"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/missions/757bb96a-f6c3-47e3-93d0-09c32989a826\n- Page Title: Tessera-3 · Perilune Ledger",
  "snapshot": "- main [ref=f1e2]:\n  - generic [ref=f1e3]:\n    - status\n    - button \"Channels\" [ref=f1e4] [cursor=pointer]\n  - generic [ref=f1e5]:\n    - heading [level=1]\n    - paragraph\n    - paragraph\n    - paragraph\n  - generic [ref=f1e6]:\n    - slider \"Track loupe\" [ref=f1e7]\n    - generic [ref=f1e8]:\n      - heading \"No passes on this mission yet\" [level=2] [ref=f1e9]\n      - paragraph [ref=f1e10]: Upload a capture to draw the first ground track.\n    - group \"Readout\" [ref=f1e11]\n  - generic [ref=f1e12]:\n    - generic [ref=f1e13]: Go to GMT\n    - textbox \"Go to GMT\" [ref=f1e14]:\n      - /placeholder: 2026-073/02:00:00\n    - button \"Go\" [ref=f1e15] [cursor=pointer]\n  - generic [ref=f1e16]:\n    - button \"Play\" [ref=f1e17] [cursor=pointer]\n    - radiogroup \"Playback rate\" [ref=f1e18]:\n      - generic [ref=f1e19]:\n        - radio \"1×\" [checked] [ref=f1e20]\n        - generic [ref=f1e21]: 1×\n      - generic [ref=f1e22]:\n        - radio \"10×\" [ref=f1e23]\n        - generic [ref=f1e24]: 10×\n      - generic [ref=f1e25]:\n        - radio \"60×\" [ref=f1e26]\n        - generic [ref=f1e27]: 60×\n  - button \"Pin event\" [ref=f1e28] [cursor=pointer]\n  - region \"Transcript\" [ref=f1e29]:\n    - heading \"Transcript\" [level=2] [ref=f1e30]\n    - generic [ref=f1e31]: Search transcript\n    - searchbox \"Search transcript\" [ref=f1e32]\n    - list \"Search results\"\n    - status \"Search status\" [ref=f1e33]\n    - heading \"Speakers\" [level=3] [ref=f1e34]\n    - list \"Speakers\"\n    - paragraph [ref=f1e35]: No speakers\n    - heading \"Lines\" [level=3] [ref=f1e36]\n    - list \"Transcript lines\"\n  - region \"Events\" [ref=f1e37]:\n    - heading \"Events\" [level=2] [ref=f1e38]\n    - generic:\n      - table \"Events\":\n        - rowgroup\n        - rowgroup\n    - paragraph\n  - region \"Landmarks\" [ref=f1e39]:\n    - heading \"Landmarks\" [level=2] [ref=f1e40]\n    - generic [ref=f1e41]:\n      - generic [ref=f1e42]: Landmark name\n      - textbox \"Landmark name\" [ref=f1e43]:\n        - /placeholder: Tessera-3 landing site\n      - generic [ref=f1e44]: Latitude\n      - textbox \"Latitude\" [ref=f1e45]:\n        - /placeholder: 12.5° S\n      - generic [ref=f1e46]: Longitude\n      - textbox \"Longitude\" [ref=f1e47]:\n        - /placeholder: 45.25° W\n      - button \"Add landmark\" [ref=f1e48] [cursor=pointer]\n    - list \"Landmarks\"\n    - paragraph [ref=f1e49]: No landmarks\n  - region \"Reference\" [ref=f1e50]:\n    - heading \"Reference\" [level=2] [ref=f1e51]\n    - generic [ref=f1e52]:\n      - generic [ref=f1e53]: Reference target\n      - textbox \"Reference target\" [ref=f1e54]:\n        - /placeholder: TESSERA-3\n      - button \"Set reference\" [ref=f1e55] [cursor=pointer]\n      - button \"Refresh reference\" [ref=f1e56] [cursor=pointer]\n    - paragraph\n  - region \"Passes\" [ref=f1e57]:\n    - heading \"Passes\" [level=2] [ref=f1e58]\n    - generic [ref=f1e59]: Capture file\n    - button \"Capture file\" [ref=f1e60]\n    - list \"Passes\"\n  - region \"Share\" [ref=f1e62]:\n    - heading \"Share\" [level=2] [ref=f1e63]\n    - generic [ref=f1e64]: Link expiry (GMT)\n    - textbox \"Link expiry (GMT)\" [ref=f1e65]:\n      - /placeholder: 2026-103/00:00:00\n    - button \"Create share link\" [ref=f1e66] [cursor=pointer]\n    - generic [ref=f1e67]:\n      - textbox \"Share link\" [ref=f1e68]\n      - button \"Copy link\" [ref=f1e69] [cursor=pointer]\n      - button \"Replace share link\" [ref=f1e70] [cursor=pointer]\n      - button \"Revoke share link\" [ref=f1e71] [cursor=pointer]\n    - paragraph\n    - paragraph [ref=f1e72]: \"Readers now: 0\"\n  - region \"Subscribers\" [ref=f1e73]:\n    - heading \"Subscribers\" [level=2] [ref=f1e74]\n    - generic [ref=f1e75]:\n      - generic [ref=f1e76]: Subscriber URL\n      - textbox \"Subscriber URL\" [ref=f1e77]:\n        - /placeholder: https://club.example/hooks/perilune\n      - button \"Add subscriber\" [ref=f1e78] [cursor=pointer]\n    - list \"Subscribers\"\n    - paragraph [ref=f1e79]: No subscribers\n  - status \"Upload status\" [ref=f1e80]\n  - status \"Console status\" [ref=f1e81]\n  - status \"Download status\" [ref=f1e82]"
}
```

### Tool call: browser_evaluate
- Args
```json
{
  "function": "() => document.querySelector('[role=\"slider\"]').getBoundingClientRect().toJSON()"
}
```
- Result
```json
{
  "result": "{\n  \"x\": 12,\n  \"y\": -255.359375,\n  \"width\": 351,\n  \"height\": 351,\n  \"top\": -255.359375,\n  \"right\": 363,\n  \"bottom\": 95.640625,\n  \"left\": 12\n}"
}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "Home"
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
  "type": "png",
  "filename": "evidence/touch-disc.png",
  "fullPage": false,
  "scale": "css"
}
```
- Result
```json
{
  "result": "- [Screenshot of viewport](evidence/touch-disc.png)"
}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "End"
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
  "depth": 2
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/missions/757bb96a-f6c3-47e3-93d0-09c32989a826\n- Page Title: Tessera-3 · Perilune Ledger",
  "inlineSnapshot": "- main [ref=f1e2]:\n  - generic [ref=f1e3]:\n    - status [ref=f1e83]: +000:01:00:00\n    - button \"Channels\" [ref=f1e4] [cursor=pointer]\n  - generic [ref=f1e5]:\n    - heading \"Tessera-3\" [level=1] [ref=f1e84]\n    - paragraph [ref=f1e85]: Epoch 2026-073/00:00:00\n    - paragraph [ref=f1e86]: Perilune 20.0 km at +000:02:00:00\n  - generic [ref=f1e6]:\n    - slider \"Track loupe\" [ref=f1e7]\n    - group \"Readout\" [ref=f1e11]\n  - generic [ref=f1e12]:\n    - generic [ref=f1e13]: Go to GMT\n    - textbox \"Go to GMT\" [ref=f1e14]:\n      - /placeholder: 2026-073/02:00:00\n    - button \"Go\" [ref=f1e15] [cursor=pointer]\n  - generic [ref=f1e16]:\n    - button \"Play\" [ref=f1e17] [cursor=pointer]\n    - radiogroup \"Playback rate\" [ref=f1e18]\n  - button \"Pin event\" [ref=f1e28] [cursor=pointer]\n  - region \"Transcript\" [ref=f1e29]:\n    - heading \"Transcript\" [level=2] [ref=f1e30]\n    - generic [ref=f1e31]: Search transcript\n    - searchbox \"Search transcript\" [ref=f1e32]\n    - list \"Search results\"\n    - status \"Search status\" [ref=f1e33]\n    - heading \"Speakers\" [level=3] [ref=f1e34]\n    - list \"Speakers\" [ref=f1e111]\n    - heading \"Lines\" [level=3] [ref=f1e36]\n    - list \"Transcript lines\" [ref=f1e114]\n  - region \"Events\" [ref=f1e37]:\n    - heading \"Events\" [level=2] [ref=f1e38]\n    - table \"Events\" [ref=f1e128]\n    - paragraph [ref=f1e155]\n  - region \"Landmarks\" [ref=f1e39]:\n    - heading \"Landmarks\" [level=2] [ref=f1e40]\n    - generic [ref=f1e41]\n    - list \"Landmarks\" [ref=f1e157]\n  - region \"Reference\" [ref=f1e50]:\n    - heading \"Reference\" [level=2] [ref=f1e51]\n    - generic [ref=f1e52]\n    - paragraph [ref=f1e164]: No reference target\n  - region \"Passes\" [ref=f1e57]:\n    - heading \"Passes\" [level=2] [ref=f1e58]\n    - generic [ref=f1e59]: Capture file\n    - button \"Capture file\" [ref=f1e60]\n    - list \"Passes\" [ref=f1e165]\n  - region \"Share\" [ref=f1e62]:\n    - heading \"Share\" [level=2] [ref=f1e63]\n    - generic [ref=f1e64]: Link expiry (GMT)\n    - textbox \"Link expiry (GMT)\" [ref=f1e65]:\n      - /placeholder: 2026-103/00:00:00\n    - button \"Create share link\" [ref=f1e66] [cursor=pointer]\n    - paragraph [ref=f1e72]: \"Readers now: 0\"\n  - region \"Subscribers\" [ref=f1e73]:\n    - heading \"Subscribers\" [level=2] [ref=f1e74]\n    - generic [ref=f1e75]\n    - list \"Subscribers\"\n    - paragraph [ref=f1e79]: No subscribers\n  - status \"Upload status\" [ref=f1e80]\n  - status \"Console status\" [ref=f1e81]\n  - status \"Download status\" [ref=f1e82]"
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
  "page": "- Page URL: http://127.0.0.1:4173/missions/757bb96a-f6c3-47e3-93d0-09c32989a826\n- Page Title: Tessera-3 · Perilune Ledger",
  "snapshot": "- main [ref=f1e2]:\n  - generic [ref=f1e3]:\n    - status [ref=f1e83]: +000:01:00:00\n    - button \"Channels\" [expanded] [ref=f1e4] [cursor=pointer]\n  - dialog \"Channels\" [ref=f1e172]:\n    - radiogroup \"Distance\" [ref=f1e173]:\n      - generic [ref=f1e174]:\n        - radio \"km\" [checked] [active] [ref=f1e175]\n        - generic [ref=f1e176]: km\n      - generic [ref=f1e177]:\n        - radio \"nmi\" [ref=f1e178]\n        - generic [ref=f1e179]: nmi\n    - radiogroup \"Speed\" [ref=f1e180]:\n      - generic [ref=f1e181]:\n        - radio \"m/s\" [checked] [ref=f1e182]\n        - generic [ref=f1e183]: m/s\n      - generic [ref=f1e184]:\n        - radio \"ft/s\" [ref=f1e185]\n        - generic [ref=f1e186]: ft/s\n    - generic [ref=f1e187]:\n      - checkbox \"Event pins\" [checked] [ref=f1e188]\n      - generic [ref=f1e189]: Event pins\n    - generic [ref=f1e190]:\n      - checkbox \"Transcript ticks\" [checked] [ref=f1e191]\n      - generic [ref=f1e192]: Transcript ticks\n    - button \"Close channels\" [ref=f1e193] [cursor=pointer]\n  - generic [ref=f1e5]:\n    - heading \"Tessera-3\" [level=1] [ref=f1e84]\n    - paragraph [ref=f1e85]: Epoch 2026-073/00:00:00\n    - paragraph [ref=f1e86]: Perilune 20.0 km at +000:02:00:00\n  - generic [ref=f1e6]:\n    - slider \"Track loupe\" [ref=f1e7]\n    - group \"Readout\" [ref=f1e11]:\n      - generic [ref=f1e87]:\n        - generic [ref=f1e88]: MET\n        - generic [ref=f1e89]: +000:01:00:00\n      - generic [ref=f1e90]:\n        - generic [ref=f1e91]: GMT\n        - generic [ref=f1e92]: 2026-073/01:00:00\n      - generic [ref=f1e93]:\n        - generic [ref=f1e94]: LAT\n        - generic [ref=f1e95]: 0.00° N\n      - generic [ref=f1e96]:\n        - generic [ref=f1e97]: LON\n        - generic [ref=f1e98]: 0.00° E\n      - generic [ref=f1e99]:\n        - generic [ref=f1e100]: ALT\n        - generic [ref=f1e101]: 100.0 km\n      - generic [ref=f1e102]:\n        - generic [ref=f1e103]: SPD\n        - generic [ref=f1e104]: 1600 m/s\n      - generic [ref=f1e105]:\n        - generic [ref=f1e106]: Range to Judge Site A7K2Q9\n        - generic [ref=f1e107]: 4506.4 km\n      - generic [ref=f1e108]:\n        - generic [ref=f1e109]: Range to Judge Site X7K2Q9\n        - generic [ref=f1e110]: 4506.4 km\n  - generic [ref=f1e12]:\n    - generic [ref=f1e13]: Go to GMT\n    - textbox \"Go to GMT\" [ref=f1e14]:\n      - /placeholder: 2026-073/02:00:00\n    - button \"Go\" [ref=f1e15] [cursor=pointer]\n  - generic [ref=f1e16]:\n    - button \"Play\" [ref=f1e17] [cursor=pointer]\n    - radiogroup \"Playback rate\" [ref=f1e18]:\n      - generic [ref=f1e19]:\n        - radio \"1×\" [checked] [ref=f1e20]\n        - generic [ref=f1e21]: 1×\n      - generic [ref=f1e22]:\n        - radio \"10×\" [ref=f1e23]\n        - generic [ref=f1e24]: 10×\n      - generic [ref=f1e25]:\n        - radio \"60×\" [ref=f1e26]\n        - generic [ref=f1e27]: 60×\n  - button \"Pin event\" [ref=f1e28] [cursor=pointer]\n  - region \"Transcript\" [ref=f1e29]:\n    - heading \"Transcript\" [level=2] [ref=f1e30]\n    - generic [ref=f1e31]: Search transcript\n    - searchbox \"Search transcript\" [ref=f1e32]\n    - list \"Search results\"\n    - status \"Search status\" [ref=f1e33]\n    - heading \"Speakers\" [level=3] [ref=f1e34]\n    - list \"Speakers\" [ref=f1e111]:\n      - listitem [ref=f1e112]: KESTREL 3\n      - listitem [ref=f1e113]: TESSERA 3\n    - heading \"Lines\" [level=3] [ref=f1e36]\n    - list \"Transcript lines\" [ref=f1e114]:\n      - listitem [ref=f1e115]:\n        - 'button \"+000:01:00:00 KESTREL: Tessera, Kestrel. Acquisition of signal, loud and clear.\" [ref=f1e116] [cursor=pointer]'\n      - listitem [ref=f1e117]:\n        - 'button \"+000:01:20:00 TESSERA: Kestrel, Tessera. Star tracker locked, attitude nominal.\" [ref=f1e118] [cursor=pointer]'\n      - listitem [ref=f1e119]:\n        - 'button \"+000:01:59:10 KESTREL: Coming up on perilune. Altimeter should read two zero kilometres.\" [ref=f1e120] [cursor=pointer]'\n      - listitem [ref=f1e121]:\n        - 'button \"+000:02:00:00 TESSERA: Perilune. Doppler steady, all channels green.\" [ref=f1e122] [cursor=pointer]'\n      - listitem [ref=f1e123]:\n        - 'button \"+000:02:40:00 KESTREL: Two minutes to loss of signal.\" [ref=f1e124] [cursor=pointer]'\n      - listitem [ref=f1e125]:\n        - 'button \"+000:02:59:50 TESSERA: Kestrel, Tessera. See you on the next pass.\" [ref=f1e126] [cursor=pointer]'\n  - region \"Events\" [ref=f1e37]:\n    - heading \"Events\" [level=2] [ref=f1e38]\n    - table \"Events\" [ref=f1e128]:\n      - rowgroup [ref=f1e129]:\n        - row [ref=f1e130]:\n          - columnheader \"MET\" [ref=f1e131]\n          - columnheader \"Title\" [ref=f1e132]\n          - columnheader \"Altitude\" [ref=f1e133]\n          - columnheader \"Speed\" [ref=f1e134]\n          - columnheader \"Note\" [ref=f1e135]\n      - rowgroup [ref=f1e136]:\n        - row [ref=f1e137]:\n          - cell \"+000:01:55:00\" [ref=f1e138]\n          - cell \"Judge pin A7K2Q9\" [ref=f1e139]\n          - cell \"21.4 km\" [ref=f1e140]\n          - cell \"1698 m/s\" [ref=f1e141]\n          - cell \"judge note\" [ref=f1e142]\n        - row [ref=f1e143]:\n          - cell \"+000:01:55:00\" [ref=f1e144]\n          - cell \"Judge pin X7K2Q9\" [ref=f1e145]\n          - cell \"21.4 km\" [ref=f1e146]\n          - cell \"1698 m/s\" [ref=f1e147]\n          - cell \"judge note\" [ref=f1e148]\n        - row [ref=f1e149]:\n          - cell \"+000:02:00:00\" [ref=f1e150]\n          - cell \"Perilune pass\" [ref=f1e151]\n          - cell \"20.0 km\" [ref=f1e152]\n          - cell \"1700 m/s\" [ref=f1e153]\n          - cell \"Check against Kestrel log sheet 14 before publishing.\" [ref=f1e154]\n    - paragraph [ref=f1e155]:\n      - link \"Download dossier\" [ref=f1e156] [cursor=pointer]:\n        - /url: /api/missions/757bb96a-f6c3-47e3-93d0-09c32989a826/dossier.pdf\n  - region \"Landmarks\" [ref=f1e39]:\n    - heading \"Landmarks\" [level=2] [ref=f1e40]\n    - generic [ref=f1e41]:\n      - generic [ref=f1e42]: Landmark name\n      - textbox \"Landmark name\" [ref=f1e43]:\n        - /placeholder: Tessera-3 landing site\n      - generic [ref=f1e44]: Latitude\n      - textbox \"Latitude\" [ref=f1e45]:\n        - /placeholder: 12.5° S\n      - generic [ref=f1e46]: Longitude\n      - textbox \"Longitude\" [ref=f1e47]:\n        - /placeholder: 45.25° W\n      - button \"Add landmark\" [ref=f1e48] [cursor=pointer]\n    - list \"Landmarks\" [ref=f1e157]:\n      - listitem [ref=f1e158]:\n        - generic [ref=f1e159]: Judge Site A7K2Q9 10.50° N, 150.25° E\n        - button \"Remove Judge Site A7K2Q9\" [ref=f1e160] [cursor=pointer]: Remove\n      - listitem [ref=f1e161]:\n        - generic [ref=f1e162]: Judge Site X7K2Q9 10.50° N, 150.25° E\n        - button \"Remove Judge Site X7K2Q9\" [ref=f1e163] [cursor=pointer]: Remove\n  - region \"Reference\" [ref=f1e50]:\n    - heading \"Reference\" [level=2] [ref=f1e51]\n    - generic [ref=f1e52]:\n      - generic [ref=f1e53]: Reference target\n      - textbox \"Reference target\" [ref=f1e54]:\n        - /placeholder: TESSERA-3\n      - button \"Set reference\" [ref=f1e55] [cursor=pointer]\n    - paragraph [ref=f1e164]: No reference target\n  - region \"Passes\" [ref=f1e57]:\n    - heading \"Passes\" [level=2] [ref=f1e58]\n    - generic [ref=f1e59]: Capture file\n    - button \"Capture file\" [ref=f1e60]\n    - list \"Passes\" [ref=f1e165]:\n      - listitem [ref=f1e166]:\n        - generic [ref=f1e167]: tessera3-orbit1.cap\n        - generic [ref=f1e168]: \"Parsed: 720 samples\"\n        - generic [ref=f1e169]: 53144 bytes\n        - link \"Download tessera3-orbit1.cap\" [ref=f1e170] [cursor=pointer]:\n          - /url: /api/passes/0b649c4b-4ea5-41ef-a6f2-888557650512/capture\n          - text: Download\n        - button \"Delete tessera3-orbit1.cap\" [ref=f1e171] [cursor=pointer]: Delete\n  - region \"Share\" [ref=f1e62]:\n    - heading \"Share\" [level=2] [ref=f1e63]\n    - generic [ref=f1e64]: Link expiry (GMT)\n    - textbox \"Link expiry (GMT)\" [ref=f1e65]:\n      - /placeholder: 2026-103/00:00:00\n    - button \"Create share link\" [ref=f1e66] [cursor=pointer]\n    - paragraph [ref=f1e72]: \"Readers now: 0\"\n  - region \"Subscribers\" [ref=f1e73]:\n    - heading \"Subscribers\" [level=2] [ref=f1e74]\n    - generic [ref=f1e75]:\n      - generic [ref=f1e76]: Subscriber URL\n      - textbox \"Subscriber URL\" [ref=f1e77]:\n        - /placeholder: https://club.example/hooks/perilune\n      - button \"Add subscriber\" [ref=f1e78] [cursor=pointer]\n    - list \"Subscribers\"\n    - paragraph [ref=f1e79]: No subscribers\n  - status \"Upload status\" [ref=f1e80]\n  - status \"Console status\" [ref=f1e81]\n  - status \"Download status\" [ref=f1e82]"
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
  "page": "- Page URL: http://127.0.0.1:4173/missions/757bb96a-f6c3-47e3-93d0-09c32989a826\n- Page Title: Tessera-3 · Perilune Ledger",
  "inlineSnapshot": "- main [ref=f1e2]:\n  - generic [ref=f1e3]:\n    - status [ref=f1e83]: +000:01:00:00\n    - button \"Channels\" [expanded] [ref=f1e4] [cursor=pointer]\n  - dialog \"Channels\" [ref=f1e172]:\n    - radiogroup \"Distance\" [ref=f1e173]:\n      - generic [ref=f1e174]\n      - generic [ref=f1e177]\n    - radiogroup \"Speed\" [ref=f1e180]:\n      - generic [ref=f1e181]\n      - generic [ref=f1e184]\n    - generic [ref=f1e187]:\n      - checkbox \"Event pins\" [checked] [ref=f1e188]\n      - generic [ref=f1e189]: Event pins\n    - generic [ref=f1e190]:\n      - checkbox \"Transcript ticks\" [checked] [ref=f1e191]\n      - generic [ref=f1e192]: Transcript ticks\n    - button \"Close channels\" [ref=f1e193] [cursor=pointer]\n  - generic [ref=f1e5]:\n    - heading \"Tessera-3\" [level=1] [ref=f1e84]\n    - paragraph [ref=f1e85]: Epoch 2026-073/00:00:00\n    - paragraph [ref=f1e86]: Perilune 20.0 km at +000:02:00:00\n  - generic [ref=f1e6]:\n    - slider \"Track loupe\" [ref=f1e7]\n    - group \"Readout\" [ref=f1e11]:\n      - generic [ref=f1e87]\n      - generic [ref=f1e90]\n      - generic [ref=f1e93]\n      - generic [ref=f1e96]\n      - generic [ref=f1e99]\n      - generic [ref=f1e102]\n      - generic [ref=f1e105]\n      - generic [ref=f1e108]\n  - generic [ref=f1e12]:\n    - generic [ref=f1e13]: Go to GMT\n    - textbox \"Go to GMT\" [ref=f1e14]:\n      - /placeholder: 2026-073/02:00:00\n    - button \"Go\" [ref=f1e15] [cursor=pointer]\n  - generic [ref=f1e16]:\n    - button \"Play\" [ref=f1e17] [cursor=pointer]\n    - radiogroup \"Playback rate\" [ref=f1e18]:\n      - generic [ref=f1e19]\n      - generic [ref=f1e22]\n      - generic [ref=f1e25]\n  - button \"Pin event\" [ref=f1e28] [cursor=pointer]\n  - region \"Transcript\" [ref=f1e29]:\n    - heading \"Transcript\" [level=2] [ref=f1e30]\n    - generic [ref=f1e31]: Search transcript\n    - searchbox \"Search transcript\" [ref=f1e32]\n    - list \"Search results\"\n    - status \"Search status\" [ref=f1e33]\n    - heading \"Speakers\" [level=3] [ref=f1e34]\n    - list \"Speakers\" [ref=f1e111]:\n      - listitem [ref=f1e112]: KESTREL 3\n      - listitem [ref=f1e113]: TESSERA 3\n    - heading \"Lines\" [level=3] [ref=f1e36]\n    - list \"Transcript lines\" [ref=f1e114]:\n      - listitem [ref=f1e115]\n      - listitem [ref=f1e117]\n      - listitem [ref=f1e119]\n      - listitem [ref=f1e121]\n      - listitem [ref=f1e123]\n      - listitem [ref=f1e125]\n  - region \"Events\" [ref=f1e37]:\n    - heading \"Events\" [level=2] [ref=f1e38]\n    - table \"Events\" [ref=f1e128]:\n      - rowgroup [ref=f1e129]\n      - rowgroup [ref=f1e136]\n    - paragraph [ref=f1e155]:\n      - link \"Download dossier\" [ref=f1e156] [cursor=pointer]:\n        - /url: /api/missions/757bb96a-f6c3-47e3-93d0-09c32989a826/dossier.pdf\n  - region \"Landmarks\" [ref=f1e39]:\n    - heading \"Landmarks\" [level=2] [ref=f1e40]\n    - generic [ref=f1e41]:\n      - generic [ref=f1e42]: Landmark name\n      - textbox \"Landmark name\" [ref=f1e43]:\n        - /placeholder: Tessera-3 landing site\n      - generic [ref=f1e44]: Latitude\n      - textbox \"Latitude\" [ref=f1e45]:\n        - /placeholder: 12.5° S\n      - generic [ref=f1e46]: Longitude\n      - textbox \"Longitude\" [ref=f1e47]:\n        - /placeholder: 45.25° W\n      - button \"Add landmark\" [ref=f1e48] [cursor=pointer]\n    - list \"Landmarks\" [ref=f1e157]:\n      - listitem [ref=f1e158]\n      - listitem [ref=f1e161]\n  - region \"Reference\" [ref=f1e50]:\n    - heading \"Reference\" [level=2] [ref=f1e51]\n    - generic [ref=f1e52]:\n      - generic [ref=f1e53]: Reference target\n      - textbox \"Reference target\" [ref=f1e54]:\n        - /placeholder: TESSERA-3\n      - button \"Set reference\" [ref=f1e55] [cursor=pointer]\n    - paragraph [ref=f1e164]: No reference target\n  - region \"Passes\" [ref=f1e57]:\n    - heading \"Passes\" [level=2] [ref=f1e58]\n    - generic [ref=f1e59]: Capture file\n    - button \"Capture file\" [ref=f1e60]\n    - list \"Passes\" [ref=f1e165]:\n      - listitem [ref=f1e166]\n  - region \"Share\" [ref=f1e62]:\n    - heading \"Share\" [level=2] [ref=f1e63]\n    - generic [ref=f1e64]: Link expiry (GMT)\n    - textbox \"Link expiry (GMT)\" [ref=f1e65]:\n      - /placeholder: 2026-103/00:00:00\n    - button \"Create share link\" [ref=f1e66] [cursor=pointer]\n    - paragraph [ref=f1e72]: \"Readers now: 0\"\n  - region \"Subscribers\" [ref=f1e73]:\n    - heading \"Subscribers\" [level=2] [ref=f1e74]\n    - generic [ref=f1e75]:\n      - generic [ref=f1e76]: Subscriber URL\n      - textbox \"Subscriber URL\" [ref=f1e77]:\n        - /placeholder: https://club.example/hooks/perilune\n      - button \"Add subscriber\" [ref=f1e78] [cursor=pointer]\n    - list \"Subscribers\"\n    - paragraph [ref=f1e79]: No subscribers\n  - status \"Upload status\" [ref=f1e80]\n  - status \"Console status\" [ref=f1e81]\n  - status \"Download status\" [ref=f1e82]"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Close channels",
  "target": "f1e193"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/missions/757bb96a-f6c3-47e3-93d0-09c32989a826\n- Page Title: Tessera-3 · Perilune Ledger",
  "snapshot": "- main [ref=f1e2]:\n  - generic [ref=f1e3]:\n    - status [ref=f1e83]: +000:01:00:00\n    - button \"Channels\" [active] [ref=f1e4] [cursor=pointer]\n  - generic [ref=f1e5]:\n    - heading \"Tessera-3\" [level=1] [ref=f1e84]\n    - paragraph [ref=f1e85]: Epoch 2026-073/00:00:00\n    - paragraph [ref=f1e86]: Perilune 20.0 km at +000:02:00:00\n  - generic [ref=f1e6]:\n    - slider \"Track loupe\" [ref=f1e7]\n    - group \"Readout\" [ref=f1e11]:\n      - generic [ref=f1e87]:\n        - generic [ref=f1e88]: MET\n        - generic [ref=f1e89]: +000:01:00:00\n      - generic [ref=f1e90]:\n        - generic [ref=f1e91]: GMT\n        - generic [ref=f1e92]: 2026-073/01:00:00\n      - generic [ref=f1e93]:\n        - generic [ref=f1e94]: LAT\n        - generic [ref=f1e95]: 0.00° N\n      - generic [ref=f1e96]:\n        - generic [ref=f1e97]: LON\n        - generic [ref=f1e98]: 0.00° E\n      - generic [ref=f1e99]:\n        - generic [ref=f1e100]: ALT\n        - generic [ref=f1e101]: 100.0 km\n      - generic [ref=f1e102]:\n        - generic [ref=f1e103]: SPD\n        - generic [ref=f1e104]: 1600 m/s\n      - generic [ref=f1e105]:\n        - generic [ref=f1e106]: Range to Judge Site A7K2Q9\n        - generic [ref=f1e107]: 4506.4 km\n      - generic [ref=f1e108]:\n        - generic [ref=f1e109]: Range to Judge Site X7K2Q9\n        - generic [ref=f1e110]: 4506.4 km\n  - generic [ref=f1e12]:\n    - generic [ref=f1e13]: Go to GMT\n    - textbox \"Go to GMT\" [ref=f1e14]:\n      - /placeholder: 2026-073/02:00:00\n    - button \"Go\" [ref=f1e15] [cursor=pointer]\n  - generic [ref=f1e16]:\n    - button \"Play\" [ref=f1e17] [cursor=pointer]\n    - radiogroup \"Playback rate\" [ref=f1e18]:\n      - generic [ref=f1e19]:\n        - radio \"1×\" [checked] [ref=f1e20]\n        - generic [ref=f1e21]: 1×\n      - generic [ref=f1e22]:\n        - radio \"10×\" [ref=f1e23]\n        - generic [ref=f1e24]: 10×\n      - generic [ref=f1e25]:\n        - radio \"60×\" [ref=f1e26]\n        - generic [ref=f1e27]: 60×\n  - button \"Pin event\" [ref=f1e28] [cursor=pointer]\n  - region \"Transcript\" [ref=f1e29]:\n    - heading \"Transcript\" [level=2] [ref=f1e30]\n    - generic [ref=f1e31]: Search transcript\n    - searchbox \"Search transcript\" [ref=f1e32]\n    - list \"Search results\"\n    - status \"Search status\" [ref=f1e33]\n    - heading \"Speakers\" [level=3] [ref=f1e34]\n    - list \"Speakers\" [ref=f1e111]:\n      - listitem [ref=f1e112]: KESTREL 3\n      - listitem [ref=f1e113]: TESSERA 3\n    - heading \"Lines\" [level=3] [ref=f1e36]\n    - list \"Transcript lines\" [ref=f1e114]:\n      - listitem [ref=f1e115]:\n        - 'button \"+000:01:00:00 KESTREL: Tessera, Kestrel. Acquisition of signal, loud and clear.\" [ref=f1e116] [cursor=pointer]'\n      - listitem [ref=f1e117]:\n        - 'button \"+000:01:20:00 TESSERA: Kestrel, Tessera. Star tracker locked, attitude nominal.\" [ref=f1e118] [cursor=pointer]'\n      - listitem [ref=f1e119]:\n        - 'button \"+000:01:59:10 KESTREL: Coming up on perilune. Altimeter should read two zero kilometres.\" [ref=f1e120] [cursor=pointer]'\n      - listitem [ref=f1e121]:\n        - 'button \"+000:02:00:00 TESSERA: Perilune. Doppler steady, all channels green.\" [ref=f1e122] [cursor=pointer]'\n      - listitem [ref=f1e123]:\n        - 'button \"+000:02:40:00 KESTREL: Two minutes to loss of signal.\" [ref=f1e124] [cursor=pointer]'\n      - listitem [ref=f1e125]:\n        - 'button \"+000:02:59:50 TESSERA: Kestrel, Tessera. See you on the next pass.\" [ref=f1e126] [cursor=pointer]'\n  - region \"Events\" [ref=f1e37]:\n    - heading \"Events\" [level=2] [ref=f1e38]\n    - table \"Events\" [ref=f1e128]:\n      - rowgroup [ref=f1e129]:\n        - row [ref=f1e130]:\n          - columnheader \"MET\" [ref=f1e131]\n          - columnheader \"Title\" [ref=f1e132]\n          - columnheader \"Altitude\" [ref=f1e133]\n          - columnheader \"Speed\" [ref=f1e134]\n          - columnheader \"Note\" [ref=f1e135]\n      - rowgroup [ref=f1e136]:\n        - row [ref=f1e137]:\n          - cell \"+000:01:55:00\" [ref=f1e138]\n          - cell \"Judge pin A7K2Q9\" [ref=f1e139]\n          - cell \"21.4 km\" [ref=f1e140]\n          - cell \"1698 m/s\" [ref=f1e141]\n          - cell \"judge note\" [ref=f1e142]\n        - row [ref=f1e143]:\n          - cell \"+000:01:55:00\" [ref=f1e144]\n          - cell \"Judge pin X7K2Q9\" [ref=f1e145]\n          - cell \"21.4 km\" [ref=f1e146]\n          - cell \"1698 m/s\" [ref=f1e147]\n          - cell \"judge note\" [ref=f1e148]\n        - row [ref=f1e149]:\n          - cell \"+000:02:00:00\" [ref=f1e150]\n          - cell \"Perilune pass\" [ref=f1e151]\n          - cell \"20.0 km\" [ref=f1e152]\n          - cell \"1700 m/s\" [ref=f1e153]\n          - cell \"Check against Kestrel log sheet 14 before publishing.\" [ref=f1e154]\n    - paragraph [ref=f1e155]:\n      - link \"Download dossier\" [ref=f1e156] [cursor=pointer]:\n        - /url: /api/missions/757bb96a-f6c3-47e3-93d0-09c32989a826/dossier.pdf\n  - region \"Landmarks\" [ref=f1e39]:\n    - heading \"Landmarks\" [level=2] [ref=f1e40]\n    - generic [ref=f1e41]:\n      - generic [ref=f1e42]: Landmark name\n      - textbox \"Landmark name\" [ref=f1e43]:\n        - /placeholder: Tessera-3 landing site\n      - generic [ref=f1e44]: Latitude\n      - textbox \"Latitude\" [ref=f1e45]:\n        - /placeholder: 12.5° S\n      - generic [ref=f1e46]: Longitude\n      - textbox \"Longitude\" [ref=f1e47]:\n        - /placeholder: 45.25° W\n      - button \"Add landmark\" [ref=f1e48] [cursor=pointer]\n    - list \"Landmarks\" [ref=f1e157]:\n      - listitem [ref=f1e158]:\n        - generic [ref=f1e159]: Judge Site A7K2Q9 10.50° N, 150.25° E\n        - button \"Remove Judge Site A7K2Q9\" [ref=f1e160] [cursor=pointer]: Remove\n      - listitem [ref=f1e161]:\n        - generic [ref=f1e162]: Judge Site X7K2Q9 10.50° N, 150.25° E\n        - button \"Remove Judge Site X7K2Q9\" [ref=f1e163] [cursor=pointer]: Remove\n  - region \"Reference\" [ref=f1e50]:\n    - heading \"Reference\" [level=2] [ref=f1e51]\n    - generic [ref=f1e52]:\n      - generic [ref=f1e53]: Reference target\n      - textbox \"Reference target\" [ref=f1e54]:\n        - /placeholder: TESSERA-3\n      - button \"Set reference\" [ref=f1e55] [cursor=pointer]\n    - paragraph [ref=f1e164]: No reference target\n  - region \"Passes\" [ref=f1e57]:\n    - heading \"Passes\" [level=2] [ref=f1e58]\n    - generic [ref=f1e59]: Capture file\n    - button \"Capture file\" [ref=f1e60]\n    - list \"Passes\" [ref=f1e165]:\n      - listitem [ref=f1e166]:\n        - generic [ref=f1e167]: tessera3-orbit1.cap\n        - generic [ref=f1e168]: \"Parsed: 720 samples\"\n        - generic [ref=f1e169]: 53144 bytes\n        - link \"Download tessera3-orbit1.cap\" [ref=f1e170] [cursor=pointer]:\n          - /url: /api/passes/0b649c4b-4ea5-41ef-a6f2-888557650512/capture\n          - text: Download\n        - button \"Delete tessera3-orbit1.cap\" [ref=f1e171] [cursor=pointer]: Delete\n  - region \"Share\" [ref=f1e62]:\n    - heading \"Share\" [level=2] [ref=f1e63]\n    - generic [ref=f1e64]: Link expiry (GMT)\n    - textbox \"Link expiry (GMT)\" [ref=f1e65]:\n      - /placeholder: 2026-103/00:00:00\n    - button \"Create share link\" [ref=f1e66] [cursor=pointer]\n    - paragraph [ref=f1e72]: \"Readers now: 0\"\n  - region \"Subscribers\" [ref=f1e73]:\n    - heading \"Subscribers\" [level=2] [ref=f1e74]\n    - generic [ref=f1e75]:\n      - generic [ref=f1e76]: Subscriber URL\n      - textbox \"Subscriber URL\" [ref=f1e77]:\n        - /placeholder: https://club.example/hooks/perilune\n      - button \"Add subscriber\" [ref=f1e78] [cursor=pointer]\n    - list \"Subscribers\"\n    - paragraph [ref=f1e79]: No subscribers\n  - status \"Upload status\" [ref=f1e80]\n  - status \"Console status\" [ref=f1e81]\n  - status \"Download status\" [ref=f1e82]"
}
```
