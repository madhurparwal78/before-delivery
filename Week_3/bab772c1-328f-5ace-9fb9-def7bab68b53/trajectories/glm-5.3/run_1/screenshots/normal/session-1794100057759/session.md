
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
  "page": "- Page URL: http://127.0.0.1:4173/\n- Page Title: Missions",
  "snapshot": "- main [ref=e2]:\n  - heading \"Missions\" [level=1] [ref=e3]\n  - region \"Missions\" [ref=e4]:\n    - list \"Missions\" [ref=e5]:\n      - listitem [ref=e6]:\n        - link \"Tessera-3\" [ref=e7] [cursor=pointer]:\n          - /url: /missions/6c75ecf7-7a5e-4105-8638-238058819bbc\n  - generic [ref=e8]:\n    - heading \"New mission\" [level=2] [ref=e9]\n    - generic [ref=e10]:\n      - generic [ref=e11]: Mission name\n      - textbox \"Mission name\" [ref=e12]\n    - generic [ref=e13]:\n      - generic [ref=e14]: Epoch (GMT)\n      - textbox \"Epoch (GMT)\" [ref=e15]:\n        - /placeholder: 2026-073/00:00:00\n    - button \"Create mission\" [ref=e16] [cursor=pointer]\n  - region [ref=e17]:\n    - heading \"Archive plan\" [level=2] [ref=e18]\n    - generic [ref=e19]:\n      - paragraph [ref=e20]: \"Plan Free: Free\"\n      - paragraph [ref=e21]: Used 51.9 KiB of 256.0 MiB\n      - paragraph [ref=e22]: Next invoice 2026-12-08\n      - paragraph [ref=e23]: Balance 0.00 USD\n    - group \"Plan\" [ref=e24]:\n      - radiogroup \"Plan\" [ref=e26]:\n        - generic [ref=e27] [cursor=pointer]:\n          - radio \"Free, 256.0 MiB\" [checked] [ref=e28]\n          - text: Free, 256.0 MiB\n        - generic [ref=e29] [cursor=pointer]:\n          - radio \"Archive 1 GiB, 4.00 USD/month\" [ref=e30]\n          - text: Archive 1 GiB, 4.00 USD/month\n        - generic [ref=e31] [cursor=pointer]:\n          - radio \"Archive 10 GiB, 24.00 USD/month, billed 288.00 USD yearly\" [ref=e32]\n          - text: Archive 10 GiB, 24.00 USD/month, billed 288.00 USD yearly\n      - button \"Change plan\" [ref=e33] [cursor=pointer]\n    - status [ref=e34]"
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
  "element": "Tessera-3 link",
  "target": "e7"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/missions/6c75ecf7-7a5e-4105-8638-238058819bbc\n- Page Title: Tessera-3",
  "snapshot": "- main [ref=f1e2]:\n  - generic [ref=f1e3]:\n    - heading \"Tessera-3\" [level=1] [ref=f1e4]\n    - paragraph [ref=f1e5]: Epoch 2026-073/00:00:00\n    - paragraph [ref=f1e6]: Perilune 20.0 km at +000:02:00:00\n  - paragraph [ref=f1e8]: +000:01:00:00\n  - complementary \"Channels\" [ref=f1e9]:\n    - heading \"Channels\" [level=2] [ref=f1e10]\n    - group \"Distance\" [ref=f1e11]:\n      - radiogroup \"Distance\" [ref=f1e13]:\n        - generic [ref=f1e14] [cursor=pointer]:\n          - radio \"km\" [checked] [ref=f1e15]\n          - text: km\n        - generic [ref=f1e16] [cursor=pointer]:\n          - radio \"nmi\" [ref=f1e17]\n          - text: nmi\n    - group \"Speed\" [ref=f1e18]:\n      - radiogroup \"Speed\" [ref=f1e20]:\n        - generic [ref=f1e21] [cursor=pointer]:\n          - radio \"m/s\" [checked] [ref=f1e22]\n          - text: m/s\n        - generic [ref=f1e23] [cursor=pointer]:\n          - radio \"ft/s\" [ref=f1e24]\n          - text: ft/s\n    - generic [ref=f1e25] [cursor=pointer]:\n      - checkbox \"Event pins\" [checked] [ref=f1e26]\n      - text: Event pins\n    - generic [ref=f1e27] [cursor=pointer]:\n      - checkbox \"Transcript ticks\" [checked] [ref=f1e28]\n      - text: Transcript ticks\n    - button \"Close channels\" [ref=f1e29] [cursor=pointer]\n  - generic [ref=f1e30]:\n    - slider \"Track loupe\" [ref=f1e31]\n    - group \"Readout\" [ref=f1e33]:\n      - paragraph [ref=f1e34]: MET +000:01:00:00\n      - paragraph [ref=f1e35]: GMT 2026-073/01:00:00\n      - paragraph [ref=f1e36]: LAT 0.00° N\n      - paragraph [ref=f1e37]: LON 0.00° E\n      - paragraph [ref=f1e38]: ALT 100.0 km\n      - paragraph [ref=f1e39]: SPD 1600 m/s\n  - generic [ref=f1e40]:\n    - generic [ref=f1e41]:\n      - generic [ref=f1e42]: Go to GMT\n      - textbox \"Go to GMT\" [ref=f1e43]:\n        - /placeholder: 2026-073/02:00:00\n      - button \"Go\" [ref=f1e44] [cursor=pointer]\n    - generic [ref=f1e45]:\n      - button \"Play\" [ref=f1e46] [cursor=pointer]\n      - radiogroup \"Playback rate\" [ref=f1e47]:\n        - generic [ref=f1e48] [cursor=pointer]:\n          - radio \"1×\" [checked] [ref=f1e49]\n          - text: 1×\n        - generic [ref=f1e50] [cursor=pointer]:\n          - radio \"10×\" [ref=f1e51]\n          - text: 10×\n        - generic [ref=f1e52] [cursor=pointer]:\n          - radio \"60×\" [ref=f1e53]\n          - text: 60×\n    - button \"Pin event\" [ref=f1e54] [cursor=pointer]\n  - region [ref=f1e55]:\n    - heading \"Transcript\" [level=2] [ref=f1e56]\n    - generic [ref=f1e57]: Search transcript\n    - searchbox \"Search transcript\" [ref=f1e58]\n    - list \"Search results\"\n    - status [ref=f1e59]\n    - heading \"Speakers\" [level=3] [ref=f1e60]\n    - list \"Speakers\" [ref=f1e61]:\n      - listitem [ref=f1e62]:\n        - generic [ref=f1e63]: KESTREL\n        - generic [ref=f1e64]: \"3\"\n      - listitem [ref=f1e65]:\n        - generic [ref=f1e66]: TESSERA\n        - generic [ref=f1e67]: \"3\"\n    - list \"Transcript lines\" [ref=f1e68]:\n      - listitem [ref=f1e69]:\n        - 'button \"+000:01:00:00 KESTREL: Tessera, Kestrel. Acquisition of signal, loud and clear.\" [ref=f1e70] [cursor=pointer]'\n      - listitem [ref=f1e71]:\n        - 'button \"+000:01:20:00 TESSERA: Kestrel, Tessera. Star tracker locked, attitude nominal.\" [ref=f1e72] [cursor=pointer]'\n      - listitem [ref=f1e73]:\n        - 'button \"+000:01:59:10 KESTREL: Coming up on perilune. Altimeter should read two zero kilometres.\" [ref=f1e74] [cursor=pointer]'\n      - listitem [ref=f1e75]:\n        - 'button \"+000:02:00:00 TESSERA: Perilune. Doppler steady, all channels green.\" [ref=f1e76] [cursor=pointer]'\n      - listitem [ref=f1e77]:\n        - 'button \"+000:02:40:00 KESTREL: Two minutes to loss of signal.\" [ref=f1e78] [cursor=pointer]'\n      - listitem [ref=f1e79]:\n        - 'button \"+000:02:59:50 TESSERA: Kestrel, Tessera. See you on the next pass.\" [ref=f1e80] [cursor=pointer]'\n  - region [ref=f1e81]:\n    - heading \"Events\" [level=2] [ref=f1e82]\n    - region \"Events\" [ref=f1e83]:\n      - table \"Events\" [ref=f1e84]:\n        - rowgroup [ref=f1e85]:\n          - row [ref=f1e86]:\n            - columnheader \"MET\" [ref=f1e87]\n            - columnheader \"Title\" [ref=f1e88]\n            - columnheader \"Altitude\" [ref=f1e89]\n            - columnheader \"Speed\" [ref=f1e90]\n            - columnheader \"Note\" [ref=f1e91]\n        - rowgroup [ref=f1e92]:\n          - row [ref=f1e93]:\n            - cell \"+000:02:00:00\" [ref=f1e94]\n            - cell \"Perilune pass\" [ref=f1e95]\n            - cell \"20.0 km\" [ref=f1e96]\n            - cell \"1700 m/s\" [ref=f1e97]\n            - cell \"Check against Kestrel log sheet 14 before publishing.\" [ref=f1e98]\n    - paragraph [ref=f1e99]:\n      - link \"Download dossier\" [ref=f1e100] [cursor=pointer]:\n        - /url: /api/missions/6c75ecf7-7a5e-4105-8638-238058819bbc/dossier.pdf\n    - status [ref=f1e101]\n  - region [ref=f1e102]:\n    - heading \"Landmarks\" [level=2] [ref=f1e103]\n    - generic [ref=f1e104]:\n      - generic [ref=f1e105]: Landmark name\n      - textbox \"Landmark name\" [ref=f1e106]:\n        - /placeholder: Tessera-3 landing site\n      - generic [ref=f1e107]: Latitude\n      - textbox \"Latitude\" [ref=f1e108]:\n        - /placeholder: 12.5° S\n      - generic [ref=f1e109]: Longitude\n      - textbox \"Longitude\" [ref=f1e110]:\n        - /placeholder: 45.25° W\n      - button \"Add landmark\" [ref=f1e111] [cursor=pointer]\n    - list \"Landmarks\" [ref=f1e112]:\n      - listitem [ref=f1e113]: No landmarks\n  - region [ref=f1e114]:\n    - heading \"Reference\" [level=2] [ref=f1e115]\n    - generic [ref=f1e116]: Reference target\n    - textbox \"Reference target\" [ref=f1e117]:\n      - /placeholder: TESSERA-3\n    - button \"Set reference\" [ref=f1e118] [cursor=pointer]\n    - button \"Refresh reference\" [ref=f1e119] [cursor=pointer]\n    - paragraph\n  - region [ref=f1e120]:\n    - heading \"Passes\" [level=2] [ref=f1e121]\n    - generic [ref=f1e122]: Capture file\n    - button \"Capture file\" [ref=f1e123]\n    - list \"Passes\"\n    - status [ref=f1e124]\n  - region [ref=f1e125]:\n    - heading \"Share\" [level=2] [ref=f1e126]\n    - generic [ref=f1e127]:\n      - generic [ref=f1e128]: Link expiry (GMT)\n      - textbox \"Link expiry (GMT)\" [ref=f1e129]:\n        - /placeholder: 2026-103/00:00:00\n      - button \"Create share link\" [ref=f1e130] [cursor=pointer]\n    - paragraph [ref=f1e131]: \"Readers now: unknown\"\n    - status [ref=f1e132]\n  - region [ref=f1e133]:\n    - heading \"Subscribers\" [level=2] [ref=f1e134]\n    - generic [ref=f1e135]: Subscriber URL\n    - textbox \"Subscriber URL\" [ref=f1e136]:\n      - /placeholder: https://club.example/hooks/perilune\n    - button \"Add subscriber\" [ref=f1e137] [cursor=pointer]\n    - list \"Subscribers\""
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
  "page": "- Page URL: http://127.0.0.1:4173/missions/6c75ecf7-7a5e-4105-8638-238058819bbc\n- Page Title: Tessera-3",
  "inlineSnapshot": "- main [ref=f1e2]:\n  - generic [ref=f1e3]:\n    - heading \"Tessera-3\" [level=1] [ref=f1e4]\n    - paragraph [ref=f1e5]: Epoch 2026-073/00:00:00\n    - paragraph [ref=f1e6]: Perilune 20.0 km at +000:02:00:00\n  - paragraph [ref=f1e8]: +000:01:00:00\n  - complementary \"Channels\" [ref=f1e9]:\n    - heading \"Channels\" [level=2] [ref=f1e10]\n    - group \"Distance\" [ref=f1e11]:\n      - radiogroup \"Distance\" [ref=f1e13]:\n        - generic [ref=f1e14] [cursor=pointer]:\n          - radio \"km\" [checked] [ref=f1e15]\n          - text: km\n        - generic [ref=f1e16] [cursor=pointer]:\n          - radio \"nmi\" [ref=f1e17]\n          - text: nmi\n    - group \"Speed\" [ref=f1e18]:\n      - radiogroup \"Speed\" [ref=f1e20]:\n        - generic [ref=f1e21] [cursor=pointer]:\n          - radio \"m/s\" [checked] [ref=f1e22]\n          - text: m/s\n        - generic [ref=f1e23] [cursor=pointer]:\n          - radio \"ft/s\" [ref=f1e24]\n          - text: ft/s\n    - generic [ref=f1e25] [cursor=pointer]:\n      - checkbox \"Event pins\" [checked] [ref=f1e26]\n      - text: Event pins\n    - generic [ref=f1e27] [cursor=pointer]:\n      - checkbox \"Transcript ticks\" [checked] [ref=f1e28]\n      - text: Transcript ticks\n    - button \"Close channels\" [ref=f1e29] [cursor=pointer]\n  - generic [ref=f1e30]:\n    - slider \"Track loupe\" [ref=f1e31]\n    - group \"Readout\" [ref=f1e33]:\n      - paragraph [ref=f1e34]: MET +000:01:00:00\n      - paragraph [ref=f1e35]: GMT 2026-073/01:00:00\n      - paragraph [ref=f1e36]: LAT 0.00° N\n      - paragraph [ref=f1e37]: LON 0.00° E\n      - paragraph [ref=f1e38]: ALT 100.0 km\n      - paragraph [ref=f1e39]: SPD 1600 m/s\n  - generic [ref=f1e40]:\n    - generic [ref=f1e41]:\n      - generic [ref=f1e42]: Go to GMT\n      - textbox \"Go to GMT\" [ref=f1e43]:\n        - /placeholder: 2026-073/02:00:00\n      - button \"Go\" [ref=f1e44] [cursor=pointer]\n    - generic [ref=f1e45]:\n      - button \"Play\" [ref=f1e46] [cursor=pointer]\n      - radiogroup \"Playback rate\" [ref=f1e47]:\n        - generic [ref=f1e48] [cursor=pointer]:\n          - radio \"1×\" [checked] [ref=f1e49]\n          - text: 1×\n        - generic [ref=f1e50] [cursor=pointer]:\n          - radio \"10×\" [ref=f1e51]\n          - text: 10×\n        - generic [ref=f1e52] [cursor=pointer]:\n          - radio \"60×\" [ref=f1e53]\n          - text: 60×\n    - button \"Pin event\" [ref=f1e54] [cursor=pointer]\n  - region [ref=f1e55]:\n    - heading \"Transcript\" [level=2] [ref=f1e56]\n    - generic [ref=f1e57]: Search transcript\n    - searchbox \"Search transcript\" [ref=f1e58]\n    - list \"Search results\"\n    - status [ref=f1e59]\n    - heading \"Speakers\" [level=3] [ref=f1e60]\n    - list \"Speakers\" [ref=f1e61]:\n      - listitem [ref=f1e62]:\n        - generic [ref=f1e63]: KESTREL\n        - generic [ref=f1e64]: \"3\"\n      - listitem [ref=f1e65]:\n        - generic [ref=f1e66]: TESSERA\n        - generic [ref=f1e67]: \"3\"\n    - list \"Transcript lines\" [ref=f1e68]:\n      - listitem [ref=f1e69]:\n        - 'button \"+000:01:00:00 KESTREL: Tessera, Kestrel. Acquisition of signal, loud and clear.\" [ref=f1e70] [cursor=pointer]'\n      - listitem [ref=f1e71]:\n        - 'button \"+000:01:20:00 TESSERA: Kestrel, Tessera. Star tracker locked, attitude nominal.\" [ref=f1e72] [cursor=pointer]'\n      - listitem [ref=f1e73]:\n        - 'button \"+000:01:59:10 KESTREL: Coming up on perilune. Altimeter should read two zero kilometres.\" [ref=f1e74] [cursor=pointer]'\n      - listitem [ref=f1e75]:\n        - 'button \"+000:02:00:00 TESSERA: Perilune. Doppler steady, all channels green.\" [ref=f1e76] [cursor=pointer]'\n      - listitem [ref=f1e77]:\n        - 'button \"+000:02:40:00 KESTREL: Two minutes to loss of signal.\" [ref=f1e78] [cursor=pointer]'\n      - listitem [ref=f1e79]:\n        - 'button \"+000:02:59:50 TESSERA: Kestrel, Tessera. See you on the next pass.\" [ref=f1e80] [cursor=pointer]'\n  - region [ref=f1e81]:\n    - heading \"Events\" [level=2] [ref=f1e82]\n    - region \"Events\" [ref=f1e83]:\n      - table \"Events\" [ref=f1e84]:\n        - rowgroup [ref=f1e85]:\n          - row \"MET Title Altitude Speed Note\" [ref=f1e86]\n        - rowgroup [ref=f1e92]:\n          - row \"+000:02:00:00 Perilune pass 20.0 km 1700 m/s Check against Kestrel log sheet 14 before publishing.\" [ref=f1e93]\n    - paragraph [ref=f1e99]:\n      - link \"Download dossier\" [ref=f1e100] [cursor=pointer]:\n        - /url: /api/missions/6c75ecf7-7a5e-4105-8638-238058819bbc/dossier.pdf\n    - status [ref=f1e101]\n  - region [ref=f1e102]:\n    - heading \"Landmarks\" [level=2] [ref=f1e103]\n    - generic [ref=f1e104]:\n      - generic [ref=f1e105]: Landmark name\n      - textbox \"Landmark name\" [ref=f1e106]:\n        - /placeholder: Tessera-3 landing site\n      - generic [ref=f1e107]: Latitude\n      - textbox \"Latitude\" [ref=f1e108]:\n        - /placeholder: 12.5° S\n      - generic [ref=f1e109]: Longitude\n      - textbox \"Longitude\" [ref=f1e110]:\n        - /placeholder: 45.25° W\n      - button \"Add landmark\" [ref=f1e111] [cursor=pointer]\n    - list \"Landmarks\" [ref=f1e112]:\n      - listitem [ref=f1e138]: No landmarks\n  - region [ref=f1e114]:\n    - heading \"Reference\" [level=2] [ref=f1e115]\n    - generic [ref=f1e116]: Reference target\n    - textbox \"Reference target\" [ref=f1e117]:\n      - /placeholder: TESSERA-3\n    - button \"Set reference\" [ref=f1e118] [cursor=pointer]\n    - button \"Refresh reference\" [ref=f1e119] [cursor=pointer]\n    - paragraph [ref=f1e139]: No reference target\n  - region [ref=f1e120]:\n    - heading \"Passes\" [level=2] [ref=f1e121]\n    - generic [ref=f1e122]: Capture file\n    - button \"Capture file\" [ref=f1e123]\n    - list \"Passes\" [ref=f1e140]:\n      - listitem [ref=f1e141]:\n        - generic [ref=f1e142]: tessera3-orbit1.cap\n        - generic [ref=f1e143]: \"Parsed: 720 samples\"\n        - generic [ref=f1e144]: 53144 bytes\n        - generic [ref=f1e145]:\n          - link \"Download tessera3-orbit1.cap\" [ref=f1e146] [cursor=pointer]:\n            - /url: /api/passes/5e63c77e-983b-42e5-b940-bbf6b4e011d4/capture\n            - text: Download\n          - button \"Delete tessera3-orbit1.cap\" [ref=f1e147] [cursor=pointer]: Delete\n    - status [ref=f1e124]\n  - region [ref=f1e125]:\n    - heading \"Share\" [level=2] [ref=f1e126]\n    - generic [ref=f1e127]:\n      - generic [ref=f1e128]: Link expiry (GMT)\n      - textbox \"Link expiry (GMT)\" [ref=f1e129]:\n        - /placeholder: 2026-103/00:00:00\n      - button \"Create share link\" [ref=f1e130] [cursor=pointer]\n    - paragraph [ref=f1e131]: \"Readers now: 0\"\n    - status [ref=f1e132]\n  - region [ref=f1e133]:\n    - heading \"Subscribers\" [level=2] [ref=f1e134]\n    - generic [ref=f1e135]: Subscriber URL\n    - textbox \"Subscriber URL\" [ref=f1e136]:\n      - /placeholder: https://club.example/hooks/perilune\n    - button \"Add subscriber\" [ref=f1e137] [cursor=pointer]\n    - list \"Subscribers\" [ref=f1e148]:\n      - listitem [ref=f1e149]: No subscribers"
}
```

### Tool call: browser_take_screenshot
- Args
```json
{
  "element": "disc pane",
  "target": "f1e30",
  "filename": "evidence/initial-disc.png",
  "scale": "css"
}
```
- Result
```json
{
  "result": "- [Screenshot of disc pane](evidence/initial-disc.png)"
}
```

### Tool call: browser_fill_form
- Args
```json
{
  "fields": [
    {
      "target": "f1e43",
      "name": "Go to GMT",
      "type": "textbox",
      "value": "2026-073"
    }
  ]
}
```
- Result
```json
{}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Go button",
  "target": "f1e44"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/missions/6c75ecf7-7a5e-4105-8638-238058819bbc\n- Page Title: Tessera-3",
  "snapshot": "- main [ref=f1e2]:\n  - generic [ref=f1e3]:\n    - heading \"Tessera-3\" [level=1] [ref=f1e4]\n    - paragraph [ref=f1e5]: Epoch 2026-073/00:00:00\n    - paragraph [ref=f1e6]: Perilune 20.0 km at +000:02:00:00\n  - paragraph [ref=f1e8]: +000:01:00:00\n  - complementary \"Channels\" [ref=f1e9]:\n    - heading \"Channels\" [level=2] [ref=f1e10]\n    - group \"Distance\" [ref=f1e11]:\n      - radiogroup \"Distance\" [ref=f1e13]:\n        - generic [ref=f1e14] [cursor=pointer]:\n          - radio \"km\" [checked] [ref=f1e15]\n          - text: km\n        - generic [ref=f1e16] [cursor=pointer]:\n          - radio \"nmi\" [ref=f1e17]\n          - text: nmi\n    - group \"Speed\" [ref=f1e18]:\n      - radiogroup \"Speed\" [ref=f1e20]:\n        - generic [ref=f1e21] [cursor=pointer]:\n          - radio \"m/s\" [checked] [ref=f1e22]\n          - text: m/s\n        - generic [ref=f1e23] [cursor=pointer]:\n          - radio \"ft/s\" [ref=f1e24]\n          - text: ft/s\n    - generic [ref=f1e25] [cursor=pointer]:\n      - checkbox \"Event pins\" [checked] [ref=f1e26]\n      - text: Event pins\n    - generic [ref=f1e27] [cursor=pointer]:\n      - checkbox \"Transcript ticks\" [checked] [ref=f1e28]\n      - text: Transcript ticks\n    - button \"Close channels\" [ref=f1e29] [cursor=pointer]\n  - generic [ref=f1e30]:\n    - slider \"Track loupe\" [ref=f1e31]\n    - group \"Readout\" [ref=f1e33]:\n      - paragraph [ref=f1e34]: MET +000:01:00:00\n      - paragraph [ref=f1e35]: GMT 2026-073/01:00:00\n      - paragraph [ref=f1e36]: LAT 0.00° N\n      - paragraph [ref=f1e37]: LON 0.00° E\n      - paragraph [ref=f1e38]: ALT 100.0 km\n      - paragraph [ref=f1e39]: SPD 1600 m/s\n  - generic [ref=f1e40]:\n    - generic [ref=f1e41]:\n      - generic [ref=f1e42]: Go to GMT\n      - textbox \"Go to GMT\" [invalid] [ref=f1e43]:\n        - /placeholder: 2026-073/02:00:00\n        - text: 2026-073\n      - paragraph [ref=f1e150]: \"Use GMT day-of-year: YYYY-DDD/HH:MM:SS.\"\n      - button \"Go\" [active] [ref=f1e44] [cursor=pointer]\n    - generic [ref=f1e45]:\n      - button \"Play\" [ref=f1e46] [cursor=pointer]\n      - radiogroup \"Playback rate\" [ref=f1e47]:\n        - generic [ref=f1e48] [cursor=pointer]:\n          - radio \"1×\" [checked] [ref=f1e49]\n          - text: 1×\n        - generic [ref=f1e50] [cursor=pointer]:\n          - radio \"10×\" [ref=f1e51]\n          - text: 10×\n        - generic [ref=f1e52] [cursor=pointer]:\n          - radio \"60×\" [ref=f1e53]\n          - text: 60×\n    - button \"Pin event\" [ref=f1e54] [cursor=pointer]\n  - region [ref=f1e55]:\n    - heading \"Transcript\" [level=2] [ref=f1e56]\n    - generic [ref=f1e57]: Search transcript\n    - searchbox \"Search transcript\" [ref=f1e58]\n    - list \"Search results\"\n    - status [ref=f1e59]\n    - heading \"Speakers\" [level=3] [ref=f1e60]\n    - list \"Speakers\" [ref=f1e61]:\n      - listitem [ref=f1e62]:\n        - generic [ref=f1e63]: KESTREL\n        - generic [ref=f1e64]: \"3\"\n      - listitem [ref=f1e65]:\n        - generic [ref=f1e66]: TESSERA\n        - generic [ref=f1e67]: \"3\"\n    - list \"Transcript lines\" [ref=f1e68]:\n      - listitem [ref=f1e69]:\n        - 'button \"+000:01:00:00 KESTREL: Tessera, Kestrel. Acquisition of signal, loud and clear.\" [ref=f1e70] [cursor=pointer]'\n      - listitem [ref=f1e71]:\n        - 'button \"+000:01:20:00 TESSERA: Kestrel, Tessera. Star tracker locked, attitude nominal.\" [ref=f1e72] [cursor=pointer]'\n      - listitem [ref=f1e73]:\n        - 'button \"+000:01:59:10 KESTREL: Coming up on perilune. Altimeter should read two zero kilometres.\" [ref=f1e74] [cursor=pointer]'\n      - listitem [ref=f1e75]:\n        - 'button \"+000:02:00:00 TESSERA: Perilune. Doppler steady, all channels green.\" [ref=f1e76] [cursor=pointer]'\n      - listitem [ref=f1e77]:\n        - 'button \"+000:02:40:00 KESTREL: Two minutes to loss of signal.\" [ref=f1e78] [cursor=pointer]'\n      - listitem [ref=f1e79]:\n        - 'button \"+000:02:59:50 TESSERA: Kestrel, Tessera. See you on the next pass.\" [ref=f1e80] [cursor=pointer]'\n  - region [ref=f1e81]:\n    - heading \"Events\" [level=2] [ref=f1e82]\n    - region \"Events\" [ref=f1e83]:\n      - table \"Events\" [ref=f1e84]:\n        - rowgroup [ref=f1e85]:\n          - row [ref=f1e86]:\n            - columnheader \"MET\" [ref=f1e87]\n            - columnheader \"Title\" [ref=f1e88]\n            - columnheader \"Altitude\" [ref=f1e89]\n            - columnheader \"Speed\" [ref=f1e90]\n            - columnheader \"Note\" [ref=f1e91]\n        - rowgroup [ref=f1e92]:\n          - row [ref=f1e93]:\n            - cell \"+000:02:00:00\" [ref=f1e94]\n            - cell \"Perilune pass\" [ref=f1e95]\n            - cell \"20.0 km\" [ref=f1e96]\n            - cell \"1700 m/s\" [ref=f1e97]\n            - cell \"Check against Kestrel log sheet 14 before publishing.\" [ref=f1e98]\n    - paragraph [ref=f1e99]:\n      - link \"Download dossier\" [ref=f1e100] [cursor=pointer]:\n        - /url: /api/missions/6c75ecf7-7a5e-4105-8638-238058819bbc/dossier.pdf\n    - status [ref=f1e101]\n  - region [ref=f1e102]:\n    - heading \"Landmarks\" [level=2] [ref=f1e103]\n    - generic [ref=f1e104]:\n      - generic [ref=f1e105]: Landmark name\n      - textbox \"Landmark name\" [ref=f1e106]:\n        - /placeholder: Tessera-3 landing site\n      - generic [ref=f1e107]: Latitude\n      - textbox \"Latitude\" [ref=f1e108]:\n        - /placeholder: 12.5° S\n      - generic [ref=f1e109]: Longitude\n      - textbox \"Longitude\" [ref=f1e110]:\n        - /placeholder: 45.25° W\n      - button \"Add landmark\" [ref=f1e111] [cursor=pointer]\n    - list \"Landmarks\" [ref=f1e112]:\n      - listitem [ref=f1e138]: No landmarks\n  - region [ref=f1e114]:\n    - heading \"Reference\" [level=2] [ref=f1e115]\n    - generic [ref=f1e116]: Reference target\n    - textbox \"Reference target\" [ref=f1e117]:\n      - /placeholder: TESSERA-3\n    - button \"Set reference\" [ref=f1e118] [cursor=pointer]\n    - button \"Refresh reference\" [ref=f1e119] [cursor=pointer]\n    - paragraph [ref=f1e139]: No reference target\n  - region [ref=f1e120]:\n    - heading \"Passes\" [level=2] [ref=f1e121]\n    - generic [ref=f1e122]: Capture file\n    - button \"Capture file\" [ref=f1e123]\n    - list \"Passes\" [ref=f1e140]:\n      - listitem [ref=f1e141]:\n        - generic [ref=f1e142]: tessera3-orbit1.cap\n        - generic [ref=f1e143]: \"Parsed: 720 samples\"\n        - generic [ref=f1e144]: 53144 bytes\n        - generic [ref=f1e145]:\n          - link \"Download tessera3-orbit1.cap\" [ref=f1e146] [cursor=pointer]:\n            - /url: /api/passes/5e63c77e-983b-42e5-b940-bbf6b4e011d4/capture\n            - text: Download\n          - button \"Delete tessera3-orbit1.cap\" [ref=f1e147] [cursor=pointer]: Delete\n    - status [ref=f1e124]\n  - region [ref=f1e125]:\n    - heading \"Share\" [level=2] [ref=f1e126]\n    - generic [ref=f1e127]:\n      - generic [ref=f1e128]: Link expiry (GMT)\n      - textbox \"Link expiry (GMT)\" [ref=f1e129]:\n        - /placeholder: 2026-103/00:00:00\n      - button \"Create share link\" [ref=f1e130] [cursor=pointer]\n    - paragraph [ref=f1e131]: \"Readers now: 0\"\n    - status [ref=f1e132]\n  - region [ref=f1e133]:\n    - heading \"Subscribers\" [level=2] [ref=f1e134]\n    - generic [ref=f1e135]: Subscriber URL\n    - textbox \"Subscriber URL\" [ref=f1e136]:\n      - /placeholder: https://club.example/hooks/perilune\n    - button \"Add subscriber\" [ref=f1e137] [cursor=pointer]\n    - list \"Subscribers\" [ref=f1e148]:\n      - listitem [ref=f1e149]: No subscribers"
}
```

### Tool call: browser_snapshot
- Args
```json
{
  "target": "f1e40",
  "depth": 3
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/missions/6c75ecf7-7a5e-4105-8638-238058819bbc\n- Page Title: Tessera-3",
  "inlineSnapshot": "- generic [ref=f1e40]:\n  - generic [ref=f1e41]:\n    - generic [ref=f1e42]: Go to GMT\n    - textbox \"Go to GMT\" [invalid] [ref=f1e43]:\n      - /placeholder: 2026-073/02:00:00\n      - text: 2026-073\n    - paragraph [ref=f1e150]: \"Use GMT day-of-year: YYYY-DDD/HH:MM:SS.\"\n    - button \"Go\" [active] [ref=f1e44] [cursor=pointer]\n  - generic [ref=f1e45]:\n    - button \"Play\" [ref=f1e46] [cursor=pointer]\n    - radiogroup \"Playback rate\" [ref=f1e47]:\n      - generic [ref=f1e48] [cursor=pointer]\n      - generic [ref=f1e50] [cursor=pointer]\n      - generic [ref=f1e52] [cursor=pointer]\n  - button \"Pin event\" [ref=f1e54] [cursor=pointer]"
}
```

### Tool call: browser_fill_form
- Args
```json
{
  "fields": [
    {
      "target": "f1e43",
      "name": "Go to GMT",
      "type": "textbox",
      "value": "2026-073/01:55:00"
    }
  ]
}
```
- Result
```json
{}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Go button",
  "target": "f1e44"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/missions/6c75ecf7-7a5e-4105-8638-238058819bbc?t=6900\n- Page Title: Tessera-3",
  "snapshot": "- main [ref=f1e2]:\n  - generic [ref=f1e3]:\n    - heading \"Tessera-3\" [level=1] [ref=f1e4]\n    - paragraph [ref=f1e5]: Epoch 2026-073/00:00:00\n    - paragraph [ref=f1e6]: Perilune 20.0 km at +000:02:00:00\n  - paragraph [ref=f1e8]: +000:01:55:00\n  - complementary \"Channels\" [ref=f1e9]:\n    - heading \"Channels\" [level=2] [ref=f1e10]\n    - group \"Distance\" [ref=f1e11]:\n      - radiogroup \"Distance\" [ref=f1e13]:\n        - generic [ref=f1e14] [cursor=pointer]:\n          - radio \"km\" [checked] [ref=f1e15]\n          - text: km\n        - generic [ref=f1e16] [cursor=pointer]:\n          - radio \"nmi\" [ref=f1e17]\n          - text: nmi\n    - group \"Speed\" [ref=f1e18]:\n      - radiogroup \"Speed\" [ref=f1e20]:\n        - generic [ref=f1e21] [cursor=pointer]:\n          - radio \"m/s\" [checked] [ref=f1e22]\n          - text: m/s\n        - generic [ref=f1e23] [cursor=pointer]:\n          - radio \"ft/s\" [ref=f1e24]\n          - text: ft/s\n    - generic [ref=f1e25] [cursor=pointer]:\n      - checkbox \"Event pins\" [checked] [ref=f1e26]\n      - text: Event pins\n    - generic [ref=f1e27] [cursor=pointer]:\n      - checkbox \"Transcript ticks\" [checked] [ref=f1e28]\n      - text: Transcript ticks\n    - button \"Close channels\" [ref=f1e29] [cursor=pointer]\n  - generic [ref=f1e30]:\n    - slider \"Track loupe\" [ref=f1e31]\n    - group \"Readout\" [ref=f1e33]:\n      - paragraph [ref=f1e34]: MET +000:01:55:00\n      - paragraph [ref=f1e35]: GMT 2026-073/01:55:00\n      - paragraph [ref=f1e36]: LAT 7.44° N\n      - paragraph [ref=f1e37]: LON 166.94° E\n      - paragraph [ref=f1e38]: ALT 21.4 km\n      - paragraph [ref=f1e39]: SPD 1698 m/s\n  - generic [ref=f1e40]:\n    - generic [ref=f1e41]:\n      - generic [ref=f1e42]: Go to GMT\n      - textbox \"Go to GMT\" [ref=f1e43]:\n        - /placeholder: 2026-073/02:00:00\n        - text: 2026-073/01:55:00\n      - button \"Go\" [active] [ref=f1e44] [cursor=pointer]\n    - generic [ref=f1e45]:\n      - button \"Play\" [ref=f1e46] [cursor=pointer]\n      - radiogroup \"Playback rate\" [ref=f1e47]:\n        - generic [ref=f1e48] [cursor=pointer]:\n          - radio \"1×\" [checked] [ref=f1e49]\n          - text: 1×\n        - generic [ref=f1e50] [cursor=pointer]:\n          - radio \"10×\" [ref=f1e51]\n          - text: 10×\n        - generic [ref=f1e52] [cursor=pointer]:\n          - radio \"60×\" [ref=f1e53]\n          - text: 60×\n    - button \"Pin event\" [ref=f1e54] [cursor=pointer]\n  - region [ref=f1e55]:\n    - heading \"Transcript\" [level=2] [ref=f1e56]\n    - generic [ref=f1e57]: Search transcript\n    - searchbox \"Search transcript\" [ref=f1e58]\n    - list \"Search results\"\n    - status [ref=f1e59]\n    - heading \"Speakers\" [level=3] [ref=f1e60]\n    - list \"Speakers\" [ref=f1e61]:\n      - listitem [ref=f1e62]:\n        - generic [ref=f1e63]: KESTREL\n        - generic [ref=f1e64]: \"3\"\n      - listitem [ref=f1e65]:\n        - generic [ref=f1e66]: TESSERA\n        - generic [ref=f1e67]: \"3\"\n    - list \"Transcript lines\" [ref=f1e68]:\n      - listitem [ref=f1e69]:\n        - 'button \"+000:01:00:00 KESTREL: Tessera, Kestrel. Acquisition of signal, loud and clear.\" [ref=f1e70] [cursor=pointer]'\n      - listitem [ref=f1e71]:\n        - 'button \"+000:01:20:00 TESSERA: Kestrel, Tessera. Star tracker locked, attitude nominal.\" [ref=f1e72] [cursor=pointer]'\n      - listitem [ref=f1e73]:\n        - 'button \"+000:01:59:10 KESTREL: Coming up on perilune. Altimeter should read two zero kilometres.\" [ref=f1e74] [cursor=pointer]'\n      - listitem [ref=f1e75]:\n        - 'button \"+000:02:00:00 TESSERA: Perilune. Doppler steady, all channels green.\" [ref=f1e76] [cursor=pointer]'\n      - listitem [ref=f1e77]:\n        - 'button \"+000:02:40:00 KESTREL: Two minutes to loss of signal.\" [ref=f1e78] [cursor=pointer]'\n      - listitem [ref=f1e79]:\n        - 'button \"+000:02:59:50 TESSERA: Kestrel, Tessera. See you on the next pass.\" [ref=f1e80] [cursor=pointer]'\n  - region [ref=f1e81]:\n    - heading \"Events\" [level=2] [ref=f1e82]\n    - region \"Events\" [ref=f1e83]:\n      - table \"Events\" [ref=f1e84]:\n        - rowgroup [ref=f1e85]:\n          - row [ref=f1e86]:\n            - columnheader \"MET\" [ref=f1e87]\n            - columnheader \"Title\" [ref=f1e88]\n            - columnheader \"Altitude\" [ref=f1e89]\n            - columnheader \"Speed\" [ref=f1e90]\n            - columnheader \"Note\" [ref=f1e91]\n        - rowgroup [ref=f1e92]:\n          - row [ref=f1e93]:\n            - cell \"+000:02:00:00\" [ref=f1e94]\n            - cell \"Perilune pass\" [ref=f1e95]\n            - cell \"20.0 km\" [ref=f1e96]\n            - cell \"1700 m/s\" [ref=f1e97]\n            - cell \"Check against Kestrel log sheet 14 before publishing.\" [ref=f1e98]\n    - paragraph [ref=f1e99]:\n      - link \"Download dossier\" [ref=f1e100] [cursor=pointer]:\n        - /url: /api/missions/6c75ecf7-7a5e-4105-8638-238058819bbc/dossier.pdf\n    - status [ref=f1e101]\n  - region [ref=f1e102]:\n    - heading \"Landmarks\" [level=2] [ref=f1e103]\n    - generic [ref=f1e104]:\n      - generic [ref=f1e105]: Landmark name\n      - textbox \"Landmark name\" [ref=f1e106]:\n        - /placeholder: Tessera-3 landing site\n      - generic [ref=f1e107]: Latitude\n      - textbox \"Latitude\" [ref=f1e108]:\n        - /placeholder: 12.5° S\n      - generic [ref=f1e109]: Longitude\n      - textbox \"Longitude\" [ref=f1e110]:\n        - /placeholder: 45.25° W\n      - button \"Add landmark\" [ref=f1e111] [cursor=pointer]\n    - list \"Landmarks\" [ref=f1e112]:\n      - listitem [ref=f1e138]: No landmarks\n  - region [ref=f1e114]:\n    - heading \"Reference\" [level=2] [ref=f1e115]\n    - generic [ref=f1e116]: Reference target\n    - textbox \"Reference target\" [ref=f1e117]:\n      - /placeholder: TESSERA-3\n    - button \"Set reference\" [ref=f1e118] [cursor=pointer]\n    - button \"Refresh reference\" [ref=f1e119] [cursor=pointer]\n    - paragraph [ref=f1e139]: No reference target\n  - region [ref=f1e120]:\n    - heading \"Passes\" [level=2] [ref=f1e121]\n    - generic [ref=f1e122]: Capture file\n    - button \"Capture file\" [ref=f1e123]\n    - list \"Passes\" [ref=f1e140]:\n      - listitem [ref=f1e141]:\n        - generic [ref=f1e142]: tessera3-orbit1.cap\n        - generic [ref=f1e143]: \"Parsed: 720 samples\"\n        - generic [ref=f1e144]: 53144 bytes\n        - generic [ref=f1e145]:\n          - link \"Download tessera3-orbit1.cap\" [ref=f1e146] [cursor=pointer]:\n            - /url: /api/passes/5e63c77e-983b-42e5-b940-bbf6b4e011d4/capture\n            - text: Download\n          - button \"Delete tessera3-orbit1.cap\" [ref=f1e147] [cursor=pointer]: Delete\n    - status [ref=f1e124]\n  - region [ref=f1e125]:\n    - heading \"Share\" [level=2] [ref=f1e126]\n    - generic [ref=f1e127]:\n      - generic [ref=f1e128]: Link expiry (GMT)\n      - textbox \"Link expiry (GMT)\" [ref=f1e129]:\n        - /placeholder: 2026-103/00:00:00\n      - button \"Create share link\" [ref=f1e130] [cursor=pointer]\n    - paragraph [ref=f1e131]: \"Readers now: 0\"\n    - status [ref=f1e132]\n  - region [ref=f1e133]:\n    - heading \"Subscribers\" [level=2] [ref=f1e134]\n    - generic [ref=f1e135]: Subscriber URL\n    - textbox \"Subscriber URL\" [ref=f1e136]:\n      - /placeholder: https://club.example/hooks/perilune\n    - button \"Add subscriber\" [ref=f1e137] [cursor=pointer]\n    - list \"Subscribers\" [ref=f1e148]:\n      - listitem [ref=f1e149]: No subscribers"
}
```

### Tool call: browser_take_screenshot
- Args
```json
{
  "filename": "evidence/pin-blocked.png",
  "scale": "css"
}
```
- Result
```json
{
  "result": "- [Screenshot of viewport](evidence/pin-blocked.png)"
}
```

### Tool call: browser_take_screenshot
- Args
```json
{
  "filename": "evidence/pin-blocked-retry.png",
  "scale": "css"
}
```
- Result
```json
{
  "result": "- [Screenshot of viewport](evidence/pin-blocked-retry.png)"
}
```

### Tool call: browser_evaluate
- Args
```json
{
  "function": "() => ({innerWidth,innerHeight,dpr:devicePixelRatio,scrollY})"
}
```
- Result
```json
{
  "result": "{\n  \"innerWidth\": 1280,\n  \"innerHeight\": 800,\n  \"dpr\": 1,\n  \"scrollY\": 705\n}"
}
```

### Tool call: browser_navigate
- Args
```json
{
  "url": "http://127.0.0.1:4173/missions/6c75ecf7-7a5e-4105-8638-238058819bbc"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/missions/6c75ecf7-7a5e-4105-8638-238058819bbc\n- Page Title: Tessera-3",
  "snapshot": "- main [ref=f2e2]:\n  - generic [ref=f2e3]:\n    - heading \"Tessera-3\" [level=1] [ref=f2e4]\n    - paragraph [ref=f2e5]: Epoch 2026-073/00:00:00\n    - paragraph [ref=f2e6]: Perilune 20.0 km at +000:02:00:00\n  - paragraph [ref=f2e8]: +000:01:00:00\n  - complementary \"Channels\" [ref=f2e9]:\n    - heading \"Channels\" [level=2] [ref=f2e10]\n    - group \"Distance\" [ref=f2e11]:\n      - radiogroup \"Distance\" [ref=f2e13]:\n        - generic [ref=f2e14] [cursor=pointer]:\n          - radio \"km\" [checked] [ref=f2e15]\n          - text: km\n        - generic [ref=f2e16] [cursor=pointer]:\n          - radio \"nmi\" [ref=f2e17]\n          - text: nmi\n    - group \"Speed\" [ref=f2e18]:\n      - radiogroup \"Speed\" [ref=f2e20]:\n        - generic [ref=f2e21] [cursor=pointer]:\n          - radio \"m/s\" [checked] [ref=f2e22]\n          - text: m/s\n        - generic [ref=f2e23] [cursor=pointer]:\n          - radio \"ft/s\" [ref=f2e24]\n          - text: ft/s\n    - generic [ref=f2e25] [cursor=pointer]:\n      - checkbox \"Event pins\" [checked] [ref=f2e26]\n      - text: Event pins\n    - generic [ref=f2e27] [cursor=pointer]:\n      - checkbox \"Transcript ticks\" [checked] [ref=f2e28]\n      - text: Transcript ticks\n    - button \"Close channels\" [ref=f2e29] [cursor=pointer]\n  - generic [ref=f2e30]:\n    - slider \"Track loupe\" [ref=f2e31]\n    - group \"Readout\" [ref=f2e33]:\n      - paragraph [ref=f2e34]: MET +000:01:00:00\n      - paragraph [ref=f2e35]: GMT 2026-073/01:00:00\n      - paragraph [ref=f2e36]: LAT 0.00° N\n      - paragraph [ref=f2e37]: LON 0.00° E\n      - paragraph [ref=f2e38]: ALT 100.0 km\n      - paragraph [ref=f2e39]: SPD 1600 m/s\n  - generic [ref=f2e40]:\n    - generic [ref=f2e41]:\n      - generic [ref=f2e42]: Go to GMT\n      - textbox \"Go to GMT\" [ref=f2e43]:\n        - /placeholder: 2026-073/02:00:00\n      - button \"Go\" [ref=f2e44] [cursor=pointer]\n    - generic [ref=f2e45]:\n      - button \"Play\" [ref=f2e46] [cursor=pointer]\n      - radiogroup \"Playback rate\" [ref=f2e47]:\n        - generic [ref=f2e48] [cursor=pointer]:\n          - radio \"1×\" [checked] [ref=f2e49]\n          - text: 1×\n        - generic [ref=f2e50] [cursor=pointer]:\n          - radio \"10×\" [ref=f2e51]\n          - text: 10×\n        - generic [ref=f2e52] [cursor=pointer]:\n          - radio \"60×\" [ref=f2e53]\n          - text: 60×\n    - button \"Pin event\" [ref=f2e54] [cursor=pointer]\n  - region [ref=f2e55]:\n    - heading \"Transcript\" [level=2] [ref=f2e56]\n    - generic [ref=f2e57]: Search transcript\n    - searchbox \"Search transcript\" [ref=f2e58]\n    - list \"Search results\"\n    - status [ref=f2e59]\n    - heading \"Speakers\" [level=3] [ref=f2e60]\n    - list \"Speakers\" [ref=f2e61]:\n      - listitem [ref=f2e62]:\n        - generic [ref=f2e63]: KESTREL\n        - generic [ref=f2e64]: \"3\"\n      - listitem [ref=f2e65]:\n        - generic [ref=f2e66]: TESSERA\n        - generic [ref=f2e67]: \"3\"\n    - list \"Transcript lines\" [ref=f2e68]:\n      - listitem [ref=f2e69]:\n        - 'button \"+000:01:00:00 KESTREL: Tessera, Kestrel. Acquisition of signal, loud and clear.\" [ref=f2e70] [cursor=pointer]'\n      - listitem [ref=f2e71]:\n        - 'button \"+000:01:20:00 TESSERA: Kestrel, Tessera. Star tracker locked, attitude nominal.\" [ref=f2e72] [cursor=pointer]'\n      - listitem [ref=f2e73]:\n        - 'button \"+000:01:59:10 KESTREL: Coming up on perilune. Altimeter should read two zero kilometres.\" [ref=f2e74] [cursor=pointer]'\n      - listitem [ref=f2e75]:\n        - 'button \"+000:02:00:00 TESSERA: Perilune. Doppler steady, all channels green.\" [ref=f2e76] [cursor=pointer]'\n      - listitem [ref=f2e77]:\n        - 'button \"+000:02:40:00 KESTREL: Two minutes to loss of signal.\" [ref=f2e78] [cursor=pointer]'\n      - listitem [ref=f2e79]:\n        - 'button \"+000:02:59:50 TESSERA: Kestrel, Tessera. See you on the next pass.\" [ref=f2e80] [cursor=pointer]'\n  - region [ref=f2e81]:\n    - heading \"Events\" [level=2] [ref=f2e82]\n    - region \"Events\" [ref=f2e83]:\n      - table \"Events\" [ref=f2e84]:\n        - rowgroup [ref=f2e85]:\n          - row [ref=f2e86]:\n            - columnheader \"MET\" [ref=f2e87]\n            - columnheader \"Title\" [ref=f2e88]\n            - columnheader \"Altitude\" [ref=f2e89]\n            - columnheader \"Speed\" [ref=f2e90]\n            - columnheader \"Note\" [ref=f2e91]\n        - rowgroup [ref=f2e92]:\n          - row [ref=f2e93]:\n            - cell \"+000:02:00:00\" [ref=f2e94]\n            - cell \"Perilune pass\" [ref=f2e95]\n            - cell \"20.0 km\" [ref=f2e96]\n            - cell \"1700 m/s\" [ref=f2e97]\n            - cell \"Check against Kestrel log sheet 14 before publishing.\" [ref=f2e98]\n    - paragraph [ref=f2e99]:\n      - link \"Download dossier\" [ref=f2e100] [cursor=pointer]:\n        - /url: /api/missions/6c75ecf7-7a5e-4105-8638-238058819bbc/dossier.pdf\n    - status [ref=f2e101]\n  - region [ref=f2e102]:\n    - heading \"Landmarks\" [level=2] [ref=f2e103]\n    - generic [ref=f2e104]:\n      - generic [ref=f2e105]: Landmark name\n      - textbox \"Landmark name\" [ref=f2e106]:\n        - /placeholder: Tessera-3 landing site\n      - generic [ref=f2e107]: Latitude\n      - textbox \"Latitude\" [ref=f2e108]:\n        - /placeholder: 12.5° S\n      - generic [ref=f2e109]: Longitude\n      - textbox \"Longitude\" [ref=f2e110]:\n        - /placeholder: 45.25° W\n      - button \"Add landmark\" [ref=f2e111] [cursor=pointer]\n    - list \"Landmarks\" [ref=f2e112]:\n      - listitem [ref=f2e113]: No landmarks\n  - region [ref=f2e114]:\n    - heading \"Reference\" [level=2] [ref=f2e115]\n    - generic [ref=f2e116]: Reference target\n    - textbox \"Reference target\" [ref=f2e117]:\n      - /placeholder: TESSERA-3\n    - button \"Set reference\" [ref=f2e118] [cursor=pointer]\n    - button \"Refresh reference\" [ref=f2e119] [cursor=pointer]\n    - paragraph\n  - region [ref=f2e120]:\n    - heading \"Passes\" [level=2] [ref=f2e121]\n    - generic [ref=f2e122]: Capture file\n    - button \"Capture file\" [ref=f2e123]\n    - list \"Passes\"\n    - status [ref=f2e124]\n  - region [ref=f2e125]:\n    - heading \"Share\" [level=2] [ref=f2e126]\n    - generic [ref=f2e127]:\n      - generic [ref=f2e128]: Link expiry (GMT)\n      - textbox \"Link expiry (GMT)\" [ref=f2e129]:\n        - /placeholder: 2026-103/00:00:00\n      - button \"Create share link\" [ref=f2e130] [cursor=pointer]\n    - paragraph [ref=f2e131]: \"Readers now: unknown\"\n    - status [ref=f2e132]\n  - region [ref=f2e133]:\n    - heading \"Subscribers\" [level=2] [ref=f2e134]\n    - generic [ref=f2e135]: Subscriber URL\n    - textbox \"Subscriber URL\" [ref=f2e136]:\n      - /placeholder: https://club.example/hooks/perilune\n    - button \"Add subscriber\" [ref=f2e137] [cursor=pointer]\n    - list \"Subscribers\""
}
```

### Tool call: browser_evaluate
- Args
```json
{
  "function": "() => { const q=(s)=>document.querySelector(s); const cs=(e)=>getComputedStyle(e); const h=q('h1'), line=q('[aria-label=\"Transcript lines\"] button'), met=[...document.querySelectorAll('p')].find(x=>x.textContent?.startsWith('+000:')); const props=e=>({family:cs(e).fontFamily,weight:cs(e).fontWeight,style:cs(e).fontStyle,size:cs(e).fontSize}); const check=e=>document.fonts.check(`${cs(e).fontStyle} ${cs(e).fontWeight} ${cs(e).fontSize} ${cs(e).fontFamily}`); const name=q('input[aria-label=\"Landmark name\"]'); return {viewport:[innerWidth,innerHeight],bodyBg:cs(document.body).backgroundColor,nameBg:cs(name).backgroundColor,heading:{...props(h),loaded:check(h)},line:{...props(line),loaded:check(line)},met:{...props(met),loaded:check(met)}} }"
}
```
- Result
```json
{
  "error": "TypeError: Failed to execute 'getComputedStyle' on 'Window': parameter 1 is not of type 'Element'.\n    at cs (eval at <anonymous> (eval at evaluate (:368:30)), <anonymous>:1:64)\n    at eval (eval at <anonymous> (eval at evaluate (:368:30)), <anonymous>:1:605)\n    at eval (eval at evaluate (:368:30), <anonymous>:4:50)\n    at UtilityScript.evaluate (<anonymous>:370:16)\n    at UtilityScript.<anonymous> (<anonymous>:1:44)",
  "isError": true
}
```

### Tool call: browser_evaluate
- Args
```json
{
  "function": "() => [...document.querySelectorAll('input')].map(e=>({id:e.id,aria:e.getAttribute('aria-label'),type:e.type}))"
}
```
- Result
```json
{
  "result": "[\n  {\n    \"id\": \"\",\n    \"aria\": null,\n    \"type\": \"radio\"\n  },\n  {\n    \"id\": \"\",\n    \"aria\": null,\n    \"type\": \"radio\"\n  },\n  {\n    \"id\": \"\",\n    \"aria\": null,\n    \"type\": \"radio\"\n  },\n  {\n    \"id\": \"\",\n    \"aria\": null,\n    \"type\": \"radio\"\n  },\n  {\n    \"id\": \"event-pins\",\n    \"aria\": null,\n    \"type\": \"checkbox\"\n  },\n  {\n    \"id\": \"transcript-ticks\",\n    \"aria\": null,\n    \"type\": \"checkbox\"\n  },\n  {\n    \"id\": \"go-to-gmt\",\n    \"aria\": null,\n    \"type\": \"text\"\n  },\n  {\n    \"id\": \"\",\n    \"aria\": null,\n    \"type\": \"radio\"\n  },\n  {\n    \"id\": \"\",\n    \"aria\": null,\n    \"type\": \"radio\"\n  },\n  {\n    \"id\": \"\",\n    \"aria\": null,\n    \"type\": \"radio\"\n  },\n  {\n    \"id\": \"search-transcript\",\n    \"aria\": null,\n    \"type\": \"search\"\n  },\n  {\n    \"id\": \"landmark-name\",\n    \"aria\": null,\n    \"type\": \"text\"\n  },\n  {\n    \"id\": \"landmark-lat\",\n    \"aria\": null,\n    \"type\": \"text\"\n  },\n  {\n    \"id\": \"landmark-lon\",\n    \"aria\": null,\n    \"type\": \"text\"\n  },\n  {\n    \"id\": \"reference-target\",\n    \"aria\": null,\n    \"type\": \"text\"\n  },\n  {\n    \"id\": \"capture-file\",\n    \"aria\": null,\n    \"type\": \"file\"\n  },\n  {\n    \"id\": \"link-expiry\",\n    \"aria\": null,\n    \"type\": \"text\"\n  },\n  {\n    \"id\": \"share-link\",\n    \"aria\": null,\n    \"type\": \"text\"\n  },\n  {\n    \"id\": \"subscriber-url\",\n    \"aria\": null,\n    \"type\": \"text\"\n  },\n  {\n    \"id\": \"pin-met\",\n    \"aria\": null,\n    \"type\": \"text\"\n  },\n  {\n    \"id\": \"pin-title\",\n    \"aria\": null,\n    \"type\": \"text\"\n  },\n  {\n    \"id\": \"pin-note\",\n    \"aria\": null,\n    \"type\": \"text\"\n  }\n]"
}
```

### Tool call: browser_evaluate
- Args
```json
{
  "function": "() => [...document.querySelectorAll('p')].filter(x=>x.textContent?.startsWith('+000:')).map(x=>({text:x.textContent,class:x.className}))"
}
```
- Result
```json
{
  "result": "[\n  {\n    \"text\": \"+000:01:00:00\",\n    \"class\": \"band-met\"\n  },\n  {\n    \"text\": \"+000:01:00:00\",\n    \"class\": \"met-readout\"\n  }\n]"
}
```

### Tool call: browser_evaluate
- Args
```json
{
  "function": "() => { const cs=(e)=>getComputedStyle(e); const h=document.querySelector('h1'), line=document.querySelector('.transcript-list button'), met=document.querySelector('.met-readout'), name=document.querySelector('#landmark-name'); const props=e=>({family:cs(e).fontFamily,weight:cs(e).fontWeight,style:cs(e).fontStyle,size:cs(e).fontSize,loaded:document.fonts.check(`${cs(e).fontStyle} ${cs(e).fontWeight} ${cs(e).fontSize} ${cs(e).fontFamily}`)}); return {bodyBg:cs(document.body).backgroundColor,nameBg:cs(name).backgroundColor,heading:props(h),line:props(line),met:props(met)} }"
}
```
- Result
```json
{
  "error": "TypeError: Failed to execute 'getComputedStyle' on 'Window': parameter 1 is not of type 'Element'.\n    at cs (eval at <anonymous> (eval at evaluate (:368:30)), <anonymous>:1:24)\n    at props (eval at <anonymous> (eval at evaluate (:368:30)), <anonymous>:1:254)\n    at eval (eval at <anonymous> (eval at evaluate (:368:30)), <anonymous>:1:551)\n    at eval (eval at evaluate (:368:30), <anonymous>:4:50)\n    at UtilityScript.evaluate (<anonymous>:370:16)\n    at UtilityScript.<anonymous> (<anonymous>:1:44)",
  "isError": true
}
```

### Tool call: browser_evaluate
- Args
```json
{
  "function": "() => { const cs=(e)=>getComputedStyle(e); const h=document.querySelector('h1'), line=[...document.querySelectorAll('button')].find(e=>e.textContent?.startsWith('+000:')), met=document.querySelector('.met-readout'), name=document.querySelector('#landmark-name'); const props=e=>({family:cs(e).fontFamily,weight:cs(e).fontWeight,style:cs(e).fontStyle,size:cs(e).fontSize,loaded:document.fonts.check(`${cs(e).fontStyle} ${cs(e).fontWeight} ${cs(e).fontSize} ${cs(e).fontFamily}`)}); return {found:[!!h,!!line,!!met,!!name],bodyBg:cs(document.body).backgroundColor,nameBg:cs(name).backgroundColor,heading:props(h),line:props(line),met:props(met)} }"
}
```
- Result
```json
{
  "result": "{\n  \"found\": [\n    true,\n    true,\n    true,\n    true\n  ],\n  \"bodyBg\": \"rgb(216, 210, 200)\",\n  \"nameBg\": \"rgb(226, 220, 210)\",\n  \"heading\": {\n    \"family\": \"Archivo, system-ui, sans-serif\",\n    \"weight\": \"700\",\n    \"style\": \"normal\",\n    \"size\": \"32px\",\n    \"loaded\": true\n  },\n  \"line\": {\n    \"family\": \"\\\"IBM Plex Mono\\\", monospace\",\n    \"weight\": \"400\",\n    \"style\": \"normal\",\n    \"size\": \"14.4px\",\n    \"loaded\": true\n  },\n  \"met\": {\n    \"family\": \"\\\"IBM Plex Mono\\\", monospace\",\n    \"weight\": \"600\",\n    \"style\": \"normal\",\n    \"size\": \"73.6px\",\n    \"loaded\": true\n  }\n}"
}
```

### Tool call: browser_evaluate
- Args
```json
{
  "function": "() => { const style=e=>{const c=getComputedStyle(e);return {tag:e.tagName,shadow:c.boxShadow,bg:c.backgroundImage,radius:c.borderRadius}}; const byRegion=n=>{const h=[...document.querySelectorAll('h2')].find(x=>x.textContent===n);return h?.parentElement}; const out={}; for(const n of ['Events','Landmarks','Reference','Passes','Share']) out[n]=style(byRegion(n)); out.pin=style(document.querySelector('#pin-event-button')); out.name=style(document.querySelector('#landmark-name')); return out }"
}
```
- Result
```json
{
  "result": "{\n  \"Events\": {\n    \"tag\": \"SECTION\",\n    \"shadow\": \"none\",\n    \"bg\": \"none\",\n    \"radius\": \"0px\"\n  },\n  \"Landmarks\": {\n    \"tag\": \"SECTION\",\n    \"shadow\": \"none\",\n    \"bg\": \"none\",\n    \"radius\": \"0px\"\n  },\n  \"Reference\": {\n    \"tag\": \"SECTION\",\n    \"shadow\": \"none\",\n    \"bg\": \"none\",\n    \"radius\": \"0px\"\n  },\n  \"Passes\": {\n    \"tag\": \"SECTION\",\n    \"shadow\": \"none\",\n    \"bg\": \"none\",\n    \"radius\": \"0px\"\n  },\n  \"Share\": {\n    \"tag\": \"SECTION\",\n    \"shadow\": \"none\",\n    \"bg\": \"none\",\n    \"radius\": \"0px\"\n  },\n  \"pin\": {\n    \"tag\": \"BUTTON\",\n    \"shadow\": \"none\",\n    \"bg\": \"none\",\n    \"radius\": \"0px\"\n  },\n  \"name\": {\n    \"tag\": \"INPUT\",\n    \"shadow\": \"none\",\n    \"bg\": \"none\",\n    \"radius\": \"0px\"\n  }\n}"
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
  "function": "() => ({tag:document.activeElement?.tagName,id:document.activeElement?.id,text:document.activeElement?.textContent})"
}
```
- Result
```json
{
  "result": "{\n  \"tag\": \"BUTTON\",\n  \"id\": \"\",\n  \"text\": \"+000:01:20:00 TESSERA: Kestrel, Tessera. Star tracker locked, attitude nominal.\"\n}"
}
```

### Tool call: browser_fill_form
- Args
```json
{
  "fields": [
    {
      "target": "#search-transcript",
      "name": "Search transcript",
      "type": "textbox",
      "value": "perilune"
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
  "depth": 4
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/missions/6c75ecf7-7a5e-4105-8638-238058819bbc?q=perilune\n- Page Title: Tessera-3",
  "inlineSnapshot": "- main [ref=f2e2]:\n  - generic [ref=f2e3]:\n    - heading \"Tessera-3\" [level=1] [ref=f2e4]\n    - paragraph [ref=f2e5]: Epoch 2026-073/00:00:00\n    - paragraph [ref=f2e6]: Perilune 20.0 km at +000:02:00:00\n  - paragraph [ref=f2e8]: +000:01:00:00\n  - complementary \"Channels\" [ref=f2e9]:\n    - heading \"Channels\" [level=2] [ref=f2e10]\n    - group \"Distance\" [ref=f2e11]:\n      - radiogroup \"Distance\" [ref=f2e13]:\n        - generic [ref=f2e14] [cursor=pointer]\n        - generic [ref=f2e16] [cursor=pointer]\n    - group \"Speed\" [ref=f2e18]:\n      - radiogroup \"Speed\" [ref=f2e20]:\n        - generic [ref=f2e21] [cursor=pointer]\n        - generic [ref=f2e23] [cursor=pointer]\n    - generic [ref=f2e25] [cursor=pointer]:\n      - checkbox \"Event pins\" [checked] [ref=f2e26]\n      - text: Event pins\n    - generic [ref=f2e27] [cursor=pointer]:\n      - checkbox \"Transcript ticks\" [checked] [ref=f2e28]\n      - text: Transcript ticks\n    - button \"Close channels\" [ref=f2e29] [cursor=pointer]\n  - generic [ref=f2e30]:\n    - slider \"Track loupe\" [ref=f2e31]\n    - group \"Readout\" [ref=f2e33]:\n      - paragraph [ref=f2e34]: MET +000:01:00:00\n      - paragraph [ref=f2e35]: GMT 2026-073/01:00:00\n      - paragraph [ref=f2e36]: LAT 0.00° N\n      - paragraph [ref=f2e37]: LON 0.00° E\n      - paragraph [ref=f2e38]: ALT 100.0 km\n      - paragraph [ref=f2e39]: SPD 1600 m/s\n  - generic [ref=f2e40]:\n    - generic [ref=f2e41]:\n      - generic [ref=f2e42]: Go to GMT\n      - textbox \"Go to GMT\" [ref=f2e43]:\n        - /placeholder: 2026-073/02:00:00\n      - button \"Go\" [ref=f2e44] [cursor=pointer]\n    - generic [ref=f2e45]:\n      - button \"Play\" [ref=f2e46] [cursor=pointer]\n      - radiogroup \"Playback rate\" [ref=f2e47]:\n        - generic [ref=f2e48] [cursor=pointer]\n        - generic [ref=f2e50] [cursor=pointer]\n        - generic [ref=f2e52] [cursor=pointer]\n    - button \"Pin event\" [ref=f2e54] [cursor=pointer]\n  - region [ref=f2e55]:\n    - heading \"Transcript\" [level=2] [ref=f2e56]\n    - generic [ref=f2e57]: Search transcript\n    - searchbox \"Search transcript\" [active] [ref=f2e58]: perilune\n    - list \"Search results\" [ref=f2e138]:\n      - listitem [ref=f2e139]:\n        - 'button \"+000:01:59:10 KESTREL: Coming up on perilune. Altimeter should read two zero kilometres.\" [ref=f2e140] [cursor=pointer]'\n      - listitem [ref=f2e141]:\n        - 'button \"+000:02:00:00 TESSERA: Perilune. Doppler steady, all channels green.\" [ref=f2e142] [cursor=pointer]'\n      - listitem [ref=f2e143]:\n        - button \"+000:02:00:00 Perilune pass\" [ref=f2e144] [cursor=pointer]\n    - status [ref=f2e59]: 3 results for \"perilune\"\n    - heading \"Speakers\" [level=3] [ref=f2e60]\n    - list \"Speakers\" [ref=f2e61]:\n      - listitem [ref=f2e62]:\n        - generic [ref=f2e63]: KESTREL\n        - generic [ref=f2e64]: \"3\"\n      - listitem [ref=f2e65]:\n        - generic [ref=f2e66]: TESSERA\n        - generic [ref=f2e67]: \"3\"\n    - list \"Transcript lines\" [ref=f2e68]:\n      - listitem [ref=f2e69]:\n        - 'button \"+000:01:00:00 KESTREL: Tessera, Kestrel. Acquisition of signal, loud and clear.\" [ref=f2e70] [cursor=pointer]'\n      - listitem [ref=f2e71]:\n        - 'button \"+000:01:20:00 TESSERA: Kestrel, Tessera. Star tracker locked, attitude nominal.\" [ref=f2e72] [cursor=pointer]'\n      - listitem [ref=f2e73]:\n        - 'button \"+000:01:59:10 KESTREL: Coming up on perilune. Altimeter should read two zero kilometres.\" [ref=f2e74] [cursor=pointer]'\n      - listitem [ref=f2e75]:\n        - 'button \"+000:02:00:00 TESSERA: Perilune. Doppler steady, all channels green.\" [ref=f2e76] [cursor=pointer]'\n      - listitem [ref=f2e77]:\n        - 'button \"+000:02:40:00 KESTREL: Two minutes to loss of signal.\" [ref=f2e78] [cursor=pointer]'\n      - listitem [ref=f2e79]:\n        - 'button \"+000:02:59:50 TESSERA: Kestrel, Tessera. See you on the next pass.\" [ref=f2e80] [cursor=pointer]'\n  - region [ref=f2e81]:\n    - heading \"Events\" [level=2] [ref=f2e82]\n    - region \"Events\" [ref=f2e83]:\n      - table \"Events\" [ref=f2e84]:\n        - rowgroup [ref=f2e85]\n        - rowgroup [ref=f2e92]\n    - paragraph [ref=f2e99]:\n      - link \"Download dossier\" [ref=f2e100] [cursor=pointer]:\n        - /url: /api/missions/6c75ecf7-7a5e-4105-8638-238058819bbc/dossier.pdf\n    - status [ref=f2e101]\n  - region [ref=f2e102]:\n    - heading \"Landmarks\" [level=2] [ref=f2e103]\n    - generic [ref=f2e104]:\n      - generic [ref=f2e105]: Landmark name\n      - textbox \"Landmark name\" [ref=f2e106]:\n        - /placeholder: Tessera-3 landing site\n      - generic [ref=f2e107]: Latitude\n      - textbox \"Latitude\" [ref=f2e108]:\n        - /placeholder: 12.5° S\n      - generic [ref=f2e109]: Longitude\n      - textbox \"Longitude\" [ref=f2e110]:\n        - /placeholder: 45.25° W\n      - button \"Add landmark\" [ref=f2e111] [cursor=pointer]\n    - list \"Landmarks\" [ref=f2e112]:\n      - listitem [ref=f2e145]: No landmarks\n  - region [ref=f2e114]:\n    - heading \"Reference\" [level=2] [ref=f2e115]\n    - generic [ref=f2e116]: Reference target\n    - textbox \"Reference target\" [ref=f2e117]:\n      - /placeholder: TESSERA-3\n    - button \"Set reference\" [ref=f2e118] [cursor=pointer]\n    - button \"Refresh reference\" [ref=f2e119] [cursor=pointer]\n    - paragraph [ref=f2e146]: No reference target\n  - region [ref=f2e120]:\n    - heading \"Passes\" [level=2] [ref=f2e121]\n    - generic [ref=f2e122]: Capture file\n    - button \"Capture file\" [ref=f2e123]\n    - list \"Passes\" [ref=f2e147]:\n      - listitem [ref=f2e148]:\n        - generic [ref=f2e149]: tessera3-orbit1.cap\n        - generic [ref=f2e150]: \"Parsed: 720 samples\"\n        - generic [ref=f2e151]: 53144 bytes\n        - generic [ref=f2e152]\n    - status [ref=f2e124]\n  - region [ref=f2e125]:\n    - heading \"Share\" [level=2] [ref=f2e126]\n    - generic [ref=f2e127]:\n      - generic [ref=f2e128]: Link expiry (GMT)\n      - textbox \"Link expiry (GMT)\" [ref=f2e129]:\n        - /placeholder: 2026-103/00:00:00\n      - button \"Create share link\" [ref=f2e130] [cursor=pointer]\n    - paragraph [ref=f2e131]: \"Readers now: 0\"\n    - status [ref=f2e132]\n  - region [ref=f2e133]:\n    - heading \"Subscribers\" [level=2] [ref=f2e134]\n    - generic [ref=f2e135]: Subscriber URL\n    - textbox \"Subscriber URL\" [ref=f2e136]:\n      - /placeholder: https://club.example/hooks/perilune\n    - button \"Add subscriber\" [ref=f2e137] [cursor=pointer]\n    - list \"Subscribers\" [ref=f2e155]:\n      - listitem [ref=f2e156]: No subscribers"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Perilune transcript search result",
  "target": "f2e142"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/missions/6c75ecf7-7a5e-4105-8638-238058819bbc?q=perilune&t=7200\n- Page Title: Tessera-3",
  "snapshot": "- main [ref=f2e2]:\n  - generic [ref=f2e3]:\n    - heading \"Tessera-3\" [level=1] [ref=f2e4]\n    - paragraph [ref=f2e5]: Epoch 2026-073/00:00:00\n    - paragraph [ref=f2e6]: Perilune 20.0 km at +000:02:00:00\n  - paragraph [ref=f2e8]: +000:02:00:00\n  - complementary \"Channels\" [ref=f2e9]:\n    - heading \"Channels\" [level=2] [ref=f2e10]\n    - group \"Distance\" [ref=f2e11]:\n      - radiogroup \"Distance\" [ref=f2e13]:\n        - generic [ref=f2e14] [cursor=pointer]:\n          - radio \"km\" [checked] [ref=f2e15]\n          - text: km\n        - generic [ref=f2e16] [cursor=pointer]:\n          - radio \"nmi\" [ref=f2e17]\n          - text: nmi\n    - group \"Speed\" [ref=f2e18]:\n      - radiogroup \"Speed\" [ref=f2e20]:\n        - generic [ref=f2e21] [cursor=pointer]:\n          - radio \"m/s\" [checked] [ref=f2e22]\n          - text: m/s\n        - generic [ref=f2e23] [cursor=pointer]:\n          - radio \"ft/s\" [ref=f2e24]\n          - text: ft/s\n    - generic [ref=f2e25] [cursor=pointer]:\n      - checkbox \"Event pins\" [checked] [ref=f2e26]\n      - text: Event pins\n    - generic [ref=f2e27] [cursor=pointer]:\n      - checkbox \"Transcript ticks\" [checked] [ref=f2e28]\n      - text: Transcript ticks\n    - button \"Close channels\" [ref=f2e29] [cursor=pointer]\n  - generic [ref=f2e30]:\n    - slider \"Track loupe\" [ref=f2e31]\n    - group \"Readout\" [ref=f2e33]:\n      - paragraph [ref=f2e34]: MET +000:02:00:00\n      - paragraph [ref=f2e35]: GMT 2026-073/02:00:00\n      - paragraph [ref=f2e36]: LAT 0.00° N\n      - paragraph [ref=f2e37]: LON 180.00° E\n      - paragraph [ref=f2e38]: ALT 20.0 km\n      - paragraph [ref=f2e39]: SPD 1700 m/s\n  - generic [ref=f2e40]:\n    - generic [ref=f2e41]:\n      - generic [ref=f2e42]: Go to GMT\n      - textbox \"Go to GMT\" [ref=f2e43]:\n        - /placeholder: 2026-073/02:00:00\n      - button \"Go\" [ref=f2e44] [cursor=pointer]\n    - generic [ref=f2e45]:\n      - button \"Play\" [ref=f2e46] [cursor=pointer]\n      - radiogroup \"Playback rate\" [ref=f2e47]:\n        - generic [ref=f2e48] [cursor=pointer]:\n          - radio \"1×\" [checked] [ref=f2e49]\n          - text: 1×\n        - generic [ref=f2e50] [cursor=pointer]:\n          - radio \"10×\" [ref=f2e51]\n          - text: 10×\n        - generic [ref=f2e52] [cursor=pointer]:\n          - radio \"60×\" [ref=f2e53]\n          - text: 60×\n    - button \"Pin event\" [ref=f2e54] [cursor=pointer]\n  - region [ref=f2e55]:\n    - heading \"Transcript\" [level=2] [ref=f2e56]\n    - generic [ref=f2e57]: Search transcript\n    - searchbox \"Search transcript\" [ref=f2e58]: perilune\n    - list \"Search results\" [ref=f2e138]:\n      - listitem [ref=f2e139]:\n        - 'button \"+000:01:59:10 KESTREL: Coming up on perilune. Altimeter should read two zero kilometres.\" [ref=f2e140] [cursor=pointer]'\n      - listitem [ref=f2e141]:\n        - 'button \"+000:02:00:00 TESSERA: Perilune. Doppler steady, all channels green.\" [active] [ref=f2e142] [cursor=pointer]'\n      - listitem [ref=f2e143]:\n        - button \"+000:02:00:00 Perilune pass\" [ref=f2e144] [cursor=pointer]\n    - status [ref=f2e59]: 3 results for \"perilune\"\n    - heading \"Speakers\" [level=3] [ref=f2e60]\n    - list \"Speakers\" [ref=f2e61]:\n      - listitem [ref=f2e62]:\n        - generic [ref=f2e63]: KESTREL\n        - generic [ref=f2e64]: \"3\"\n      - listitem [ref=f2e65]:\n        - generic [ref=f2e66]: TESSERA\n        - generic [ref=f2e67]: \"3\"\n    - list \"Transcript lines\" [ref=f2e68]:\n      - listitem [ref=f2e69]:\n        - 'button \"+000:01:00:00 KESTREL: Tessera, Kestrel. Acquisition of signal, loud and clear.\" [ref=f2e70] [cursor=pointer]'\n      - listitem [ref=f2e71]:\n        - 'button \"+000:01:20:00 TESSERA: Kestrel, Tessera. Star tracker locked, attitude nominal.\" [ref=f2e72] [cursor=pointer]'\n      - listitem [ref=f2e73]:\n        - 'button \"+000:01:59:10 KESTREL: Coming up on perilune. Altimeter should read two zero kilometres.\" [ref=f2e74] [cursor=pointer]'\n      - listitem [ref=f2e75]:\n        - 'button \"+000:02:00:00 TESSERA: Perilune. Doppler steady, all channels green.\" [ref=f2e76] [cursor=pointer]'\n      - listitem [ref=f2e77]:\n        - 'button \"+000:02:40:00 KESTREL: Two minutes to loss of signal.\" [ref=f2e78] [cursor=pointer]'\n      - listitem [ref=f2e79]:\n        - 'button \"+000:02:59:50 TESSERA: Kestrel, Tessera. See you on the next pass.\" [ref=f2e80] [cursor=pointer]'\n  - region [ref=f2e81]:\n    - heading \"Events\" [level=2] [ref=f2e82]\n    - region \"Events\" [ref=f2e83]:\n      - table \"Events\" [ref=f2e84]:\n        - rowgroup [ref=f2e85]:\n          - row [ref=f2e86]:\n            - columnheader \"MET\" [ref=f2e87]\n            - columnheader \"Title\" [ref=f2e88]\n            - columnheader \"Altitude\" [ref=f2e89]\n            - columnheader \"Speed\" [ref=f2e90]\n            - columnheader \"Note\" [ref=f2e91]\n        - rowgroup [ref=f2e92]:\n          - row [ref=f2e93]:\n            - cell \"+000:02:00:00\" [ref=f2e94]\n            - cell \"Perilune pass\" [ref=f2e95]\n            - cell \"20.0 km\" [ref=f2e96]\n            - cell \"1700 m/s\" [ref=f2e97]\n            - cell \"Check against Kestrel log sheet 14 before publishing.\" [ref=f2e98]\n    - paragraph [ref=f2e99]:\n      - link \"Download dossier\" [ref=f2e100] [cursor=pointer]:\n        - /url: /api/missions/6c75ecf7-7a5e-4105-8638-238058819bbc/dossier.pdf\n    - status [ref=f2e101]\n  - region [ref=f2e102]:\n    - heading \"Landmarks\" [level=2] [ref=f2e103]\n    - generic [ref=f2e104]:\n      - generic [ref=f2e105]: Landmark name\n      - textbox \"Landmark name\" [ref=f2e106]:\n        - /placeholder: Tessera-3 landing site\n      - generic [ref=f2e107]: Latitude\n      - textbox \"Latitude\" [ref=f2e108]:\n        - /placeholder: 12.5° S\n      - generic [ref=f2e109]: Longitude\n      - textbox \"Longitude\" [ref=f2e110]:\n        - /placeholder: 45.25° W\n      - button \"Add landmark\" [ref=f2e111] [cursor=pointer]\n    - list \"Landmarks\" [ref=f2e112]:\n      - listitem [ref=f2e145]: No landmarks\n  - region [ref=f2e114]:\n    - heading \"Reference\" [level=2] [ref=f2e115]\n    - generic [ref=f2e116]: Reference target\n    - textbox \"Reference target\" [ref=f2e117]:\n      - /placeholder: TESSERA-3\n    - button \"Set reference\" [ref=f2e118] [cursor=pointer]\n    - button \"Refresh reference\" [ref=f2e119] [cursor=pointer]\n    - paragraph [ref=f2e146]: No reference target\n  - region [ref=f2e120]:\n    - heading \"Passes\" [level=2] [ref=f2e121]\n    - generic [ref=f2e122]: Capture file\n    - button \"Capture file\" [ref=f2e123]\n    - list \"Passes\" [ref=f2e147]:\n      - listitem [ref=f2e148]:\n        - generic [ref=f2e149]: tessera3-orbit1.cap\n        - generic [ref=f2e150]: \"Parsed: 720 samples\"\n        - generic [ref=f2e151]: 53144 bytes\n        - generic [ref=f2e152]:\n          - link \"Download tessera3-orbit1.cap\" [ref=f2e153] [cursor=pointer]:\n            - /url: /api/passes/5e63c77e-983b-42e5-b940-bbf6b4e011d4/capture\n            - text: Download\n          - button \"Delete tessera3-orbit1.cap\" [ref=f2e154] [cursor=pointer]: Delete\n    - status [ref=f2e124]\n  - region [ref=f2e125]:\n    - heading \"Share\" [level=2] [ref=f2e126]\n    - generic [ref=f2e127]:\n      - generic [ref=f2e128]: Link expiry (GMT)\n      - textbox \"Link expiry (GMT)\" [ref=f2e129]:\n        - /placeholder: 2026-103/00:00:00\n      - button \"Create share link\" [ref=f2e130] [cursor=pointer]\n    - paragraph [ref=f2e131]: \"Readers now: 0\"\n    - status [ref=f2e132]\n  - region [ref=f2e133]:\n    - heading \"Subscribers\" [level=2] [ref=f2e134]\n    - generic [ref=f2e135]: Subscriber URL\n    - textbox \"Subscriber URL\" [ref=f2e136]:\n      - /placeholder: https://club.example/hooks/perilune\n    - button \"Add subscriber\" [ref=f2e137] [cursor=pointer]\n    - list \"Subscribers\" [ref=f2e155]:\n      - listitem [ref=f2e156]: No subscribers"
}
```

### Tool call: browser_take_screenshot
- Args
```json
{
  "filename": "evidence/search-jump.png",
  "scale": "css"
}
```
- Result
```json
{
  "result": "- [Screenshot of viewport](evidence/search-jump.png)"
}
```

### Tool call: browser_evaluate
- Args
```json
{
  "function": "() => [...document.querySelectorAll('button')].find(e=>e.textContent?.includes('Perilune. Doppler steady'))?.click()"
}
```
- Result
```json
{
  "result": "undefined"
}
```

### Tool call: browser_wait_for
- Args
```json
{
  "text": "MET +000:02:00:00"
}
```
- Result
```json
{
  "result": "Waited for MET +000:02:00:00",
  "page": "- Page URL: http://127.0.0.1:4173/missions/6c75ecf7-7a5e-4105-8638-238058819bbc?q=perilune&t=7200\n- Page Title: Tessera-3",
  "snapshot": "- main [ref=f2e2]:\n  - generic [ref=f2e3]:\n    - heading \"Tessera-3\" [level=1] [ref=f2e4]\n    - paragraph [ref=f2e5]: Epoch 2026-073/00:00:00\n    - paragraph [ref=f2e6]: Perilune 20.0 km at +000:02:00:00\n  - paragraph [ref=f2e8]: +000:02:00:00\n  - complementary \"Channels\" [ref=f2e9]:\n    - heading \"Channels\" [level=2] [ref=f2e10]\n    - group \"Distance\" [ref=f2e11]:\n      - radiogroup \"Distance\" [ref=f2e13]:\n        - generic [ref=f2e14] [cursor=pointer]:\n          - radio \"km\" [checked] [ref=f2e15]\n          - text: km\n        - generic [ref=f2e16] [cursor=pointer]:\n          - radio \"nmi\" [ref=f2e17]\n          - text: nmi\n    - group \"Speed\" [ref=f2e18]:\n      - radiogroup \"Speed\" [ref=f2e20]:\n        - generic [ref=f2e21] [cursor=pointer]:\n          - radio \"m/s\" [checked] [ref=f2e22]\n          - text: m/s\n        - generic [ref=f2e23] [cursor=pointer]:\n          - radio \"ft/s\" [ref=f2e24]\n          - text: ft/s\n    - generic [ref=f2e25] [cursor=pointer]:\n      - checkbox \"Event pins\" [checked] [ref=f2e26]\n      - text: Event pins\n    - generic [ref=f2e27] [cursor=pointer]:\n      - checkbox \"Transcript ticks\" [checked] [ref=f2e28]\n      - text: Transcript ticks\n    - button \"Close channels\" [ref=f2e29] [cursor=pointer]\n  - generic [ref=f2e30]:\n    - slider \"Track loupe\" [ref=f2e31]\n    - group \"Readout\" [ref=f2e33]:\n      - paragraph [ref=f2e34]: MET +000:02:00:00\n      - paragraph [ref=f2e35]: GMT 2026-073/02:00:00\n      - paragraph [ref=f2e36]: LAT 0.00° N\n      - paragraph [ref=f2e37]: LON 180.00° E\n      - paragraph [ref=f2e38]: ALT 20.0 km\n      - paragraph [ref=f2e39]: SPD 1700 m/s\n  - generic [ref=f2e40]:\n    - generic [ref=f2e41]:\n      - generic [ref=f2e42]: Go to GMT\n      - textbox \"Go to GMT\" [ref=f2e43]:\n        - /placeholder: 2026-073/02:00:00\n      - button \"Go\" [ref=f2e44] [cursor=pointer]\n    - generic [ref=f2e45]:\n      - button \"Play\" [ref=f2e46] [cursor=pointer]\n      - radiogroup \"Playback rate\" [ref=f2e47]:\n        - generic [ref=f2e48] [cursor=pointer]:\n          - radio \"1×\" [checked] [ref=f2e49]\n          - text: 1×\n        - generic [ref=f2e50] [cursor=pointer]:\n          - radio \"10×\" [ref=f2e51]\n          - text: 10×\n        - generic [ref=f2e52] [cursor=pointer]:\n          - radio \"60×\" [ref=f2e53]\n          - text: 60×\n    - button \"Pin event\" [ref=f2e54] [cursor=pointer]\n  - region [ref=f2e55]:\n    - heading \"Transcript\" [level=2] [ref=f2e56]\n    - generic [ref=f2e57]: Search transcript\n    - searchbox \"Search transcript\" [ref=f2e58]: perilune\n    - list \"Search results\" [ref=f2e138]:\n      - listitem [ref=f2e139]:\n        - 'button \"+000:01:59:10 KESTREL: Coming up on perilune. Altimeter should read two zero kilometres.\" [ref=f2e140] [cursor=pointer]'\n      - listitem [ref=f2e141]:\n        - 'button \"+000:02:00:00 TESSERA: Perilune. Doppler steady, all channels green.\" [active] [ref=f2e142] [cursor=pointer]'\n      - listitem [ref=f2e143]:\n        - button \"+000:02:00:00 Perilune pass\" [ref=f2e144] [cursor=pointer]\n    - status [ref=f2e59]: 3 results for \"perilune\"\n    - heading \"Speakers\" [level=3] [ref=f2e60]\n    - list \"Speakers\" [ref=f2e61]:\n      - listitem [ref=f2e62]:\n        - generic [ref=f2e63]: KESTREL\n        - generic [ref=f2e64]: \"3\"\n      - listitem [ref=f2e65]:\n        - generic [ref=f2e66]: TESSERA\n        - generic [ref=f2e67]: \"3\"\n    - list \"Transcript lines\" [ref=f2e68]:\n      - listitem [ref=f2e69]:\n        - 'button \"+000:01:00:00 KESTREL: Tessera, Kestrel. Acquisition of signal, loud and clear.\" [ref=f2e70] [cursor=pointer]'\n      - listitem [ref=f2e71]:\n        - 'button \"+000:01:20:00 TESSERA: Kestrel, Tessera. Star tracker locked, attitude nominal.\" [ref=f2e72] [cursor=pointer]'\n      - listitem [ref=f2e73]:\n        - 'button \"+000:01:59:10 KESTREL: Coming up on perilune. Altimeter should read two zero kilometres.\" [ref=f2e74] [cursor=pointer]'\n      - listitem [ref=f2e75]:\n        - 'button \"+000:02:00:00 TESSERA: Perilune. Doppler steady, all channels green.\" [ref=f2e76] [cursor=pointer]'\n      - listitem [ref=f2e77]:\n        - 'button \"+000:02:40:00 KESTREL: Two minutes to loss of signal.\" [ref=f2e78] [cursor=pointer]'\n      - listitem [ref=f2e79]:\n        - 'button \"+000:02:59:50 TESSERA: Kestrel, Tessera. See you on the next pass.\" [ref=f2e80] [cursor=pointer]'\n  - region [ref=f2e81]:\n    - heading \"Events\" [level=2] [ref=f2e82]\n    - region \"Events\" [ref=f2e83]:\n      - table \"Events\" [ref=f2e84]:\n        - rowgroup [ref=f2e85]:\n          - row [ref=f2e86]:\n            - columnheader \"MET\" [ref=f2e87]\n            - columnheader \"Title\" [ref=f2e88]\n            - columnheader \"Altitude\" [ref=f2e89]\n            - columnheader \"Speed\" [ref=f2e90]\n            - columnheader \"Note\" [ref=f2e91]\n        - rowgroup [ref=f2e92]:\n          - row [ref=f2e93]:\n            - cell \"+000:02:00:00\" [ref=f2e94]\n            - cell \"Perilune pass\" [ref=f2e95]\n            - cell \"20.0 km\" [ref=f2e96]\n            - cell \"1700 m/s\" [ref=f2e97]\n            - cell \"Check against Kestrel log sheet 14 before publishing.\" [ref=f2e98]\n    - paragraph [ref=f2e99]:\n      - link \"Download dossier\" [ref=f2e100] [cursor=pointer]:\n        - /url: /api/missions/6c75ecf7-7a5e-4105-8638-238058819bbc/dossier.pdf\n    - status [ref=f2e101]\n  - region [ref=f2e102]:\n    - heading \"Landmarks\" [level=2] [ref=f2e103]\n    - generic [ref=f2e104]:\n      - generic [ref=f2e105]: Landmark name\n      - textbox \"Landmark name\" [ref=f2e106]:\n        - /placeholder: Tessera-3 landing site\n      - generic [ref=f2e107]: Latitude\n      - textbox \"Latitude\" [ref=f2e108]:\n        - /placeholder: 12.5° S\n      - generic [ref=f2e109]: Longitude\n      - textbox \"Longitude\" [ref=f2e110]:\n        - /placeholder: 45.25° W\n      - button \"Add landmark\" [ref=f2e111] [cursor=pointer]\n    - list \"Landmarks\" [ref=f2e112]:\n      - listitem [ref=f2e145]: No landmarks\n  - region [ref=f2e114]:\n    - heading \"Reference\" [level=2] [ref=f2e115]\n    - generic [ref=f2e116]: Reference target\n    - textbox \"Reference target\" [ref=f2e117]:\n      - /placeholder: TESSERA-3\n    - button \"Set reference\" [ref=f2e118] [cursor=pointer]\n    - button \"Refresh reference\" [ref=f2e119] [cursor=pointer]\n    - paragraph [ref=f2e146]: No reference target\n  - region [ref=f2e120]:\n    - heading \"Passes\" [level=2] [ref=f2e121]\n    - generic [ref=f2e122]: Capture file\n    - button \"Capture file\" [ref=f2e123]\n    - list \"Passes\" [ref=f2e147]:\n      - listitem [ref=f2e148]:\n        - generic [ref=f2e149]: tessera3-orbit1.cap\n        - generic [ref=f2e150]: \"Parsed: 720 samples\"\n        - generic [ref=f2e151]: 53144 bytes\n        - generic [ref=f2e152]:\n          - link \"Download tessera3-orbit1.cap\" [ref=f2e153] [cursor=pointer]:\n            - /url: /api/passes/5e63c77e-983b-42e5-b940-bbf6b4e011d4/capture\n            - text: Download\n          - button \"Delete tessera3-orbit1.cap\" [ref=f2e154] [cursor=pointer]: Delete\n    - status [ref=f2e124]\n  - region [ref=f2e125]:\n    - heading \"Share\" [level=2] [ref=f2e126]\n    - generic [ref=f2e127]:\n      - generic [ref=f2e128]: Link expiry (GMT)\n      - textbox \"Link expiry (GMT)\" [ref=f2e129]:\n        - /placeholder: 2026-103/00:00:00\n      - button \"Create share link\" [ref=f2e130] [cursor=pointer]\n    - paragraph [ref=f2e131]: \"Readers now: 0\"\n    - status [ref=f2e132]\n  - region [ref=f2e133]:\n    - heading \"Subscribers\" [level=2] [ref=f2e134]\n    - generic [ref=f2e135]: Subscriber URL\n    - textbox \"Subscriber URL\" [ref=f2e136]:\n      - /placeholder: https://club.example/hooks/perilune\n    - button \"Add subscriber\" [ref=f2e137] [cursor=pointer]\n    - list \"Subscribers\" [ref=f2e155]:\n      - listitem [ref=f2e156]: No subscribers"
}
```

### Tool call: browser_take_screenshot
- Args
```json
{
  "filename": "evidence/transcript-script-jump.png",
  "scale": "css"
}
```
- Result
```json
{
  "result": "- [Screenshot of viewport](evidence/transcript-script-jump.png)"
}
```

### Tool call: browser_resize
- Args
```json
{
  "width": 768,
  "height": 1024
}
```
- Result
```json
{}
```

### Tool call: browser_navigate
- Args
```json
{
  "url": "http://127.0.0.1:4173/missions/6c75ecf7-7a5e-4105-8638-238058819bbc"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/missions/6c75ecf7-7a5e-4105-8638-238058819bbc\n- Page Title: Tessera-3",
  "snapshot": "- generic [active] [ref=f3e1]:\n  - generic [ref=f3e2]:\n    - paragraph [ref=f3e3]: +000:01:00:00\n    - button \"Channels\" [ref=f3e4] [cursor=pointer]\n  - main [ref=f3e5]:\n    - generic [ref=f3e6]:\n      - heading \"Tessera-3\" [level=1] [ref=f3e7]\n      - paragraph [ref=f3e8]: Epoch 2026-073/00:00:00\n      - paragraph [ref=f3e9]: Perilune 20.0 km at +000:02:00:00\n    - paragraph [ref=f3e11]: +000:01:00:00\n    - generic [ref=f3e12]:\n      - slider \"Track loupe\" [ref=f3e13]\n      - group \"Readout\" [ref=f3e15]:\n        - paragraph [ref=f3e16]: MET +000:01:00:00\n        - paragraph [ref=f3e17]: GMT 2026-073/01:00:00\n        - paragraph [ref=f3e18]: LAT 0.00° N\n        - paragraph [ref=f3e19]: LON 0.00° E\n        - paragraph [ref=f3e20]: ALT 100.0 km\n        - paragraph [ref=f3e21]: SPD 1600 m/s\n    - generic [ref=f3e22]:\n      - generic [ref=f3e23]:\n        - generic [ref=f3e24]: Go to GMT\n        - textbox \"Go to GMT\" [ref=f3e25]:\n          - /placeholder: 2026-073/02:00:00\n        - button \"Go\" [ref=f3e26] [cursor=pointer]\n      - generic [ref=f3e27]:\n        - button \"Play\" [ref=f3e28] [cursor=pointer]\n        - radiogroup \"Playback rate\" [ref=f3e29]:\n          - generic [ref=f3e30] [cursor=pointer]:\n            - radio \"1×\" [checked] [ref=f3e31]\n            - text: 1×\n          - generic [ref=f3e32] [cursor=pointer]:\n            - radio \"10×\" [ref=f3e33]\n            - text: 10×\n          - generic [ref=f3e34] [cursor=pointer]:\n            - radio \"60×\" [ref=f3e35]\n            - text: 60×\n      - button \"Pin event\" [ref=f3e36] [cursor=pointer]\n    - region [ref=f3e37]:\n      - heading \"Transcript\" [level=2] [ref=f3e38]\n      - generic [ref=f3e39]: Search transcript\n      - searchbox \"Search transcript\" [ref=f3e40]\n      - list \"Search results\"\n      - status [ref=f3e41]\n      - heading \"Speakers\" [level=3] [ref=f3e42]\n      - list \"Speakers\" [ref=f3e43]:\n        - listitem [ref=f3e44]:\n          - generic [ref=f3e45]: KESTREL\n          - generic [ref=f3e46]: \"3\"\n        - listitem [ref=f3e47]:\n          - generic [ref=f3e48]: TESSERA\n          - generic [ref=f3e49]: \"3\"\n      - list \"Transcript lines\" [ref=f3e50]:\n        - listitem [ref=f3e51]:\n          - 'button \"+000:01:00:00 KESTREL: Tessera, Kestrel. Acquisition of signal, loud and clear.\" [ref=f3e52] [cursor=pointer]'\n        - listitem [ref=f3e53]:\n          - 'button \"+000:01:20:00 TESSERA: Kestrel, Tessera. Star tracker locked, attitude nominal.\" [ref=f3e54] [cursor=pointer]'\n        - listitem [ref=f3e55]:\n          - 'button \"+000:01:59:10 KESTREL: Coming up on perilune. Altimeter should read two zero kilometres.\" [ref=f3e56] [cursor=pointer]'\n        - listitem [ref=f3e57]:\n          - 'button \"+000:02:00:00 TESSERA: Perilune. Doppler steady, all channels green.\" [ref=f3e58] [cursor=pointer]'\n        - listitem [ref=f3e59]:\n          - 'button \"+000:02:40:00 KESTREL: Two minutes to loss of signal.\" [ref=f3e60] [cursor=pointer]'\n        - listitem [ref=f3e61]:\n          - 'button \"+000:02:59:50 TESSERA: Kestrel, Tessera. See you on the next pass.\" [ref=f3e62] [cursor=pointer]'\n    - region [ref=f3e63]:\n      - heading \"Events\" [level=2] [ref=f3e64]\n      - region \"Events\" [ref=f3e65]:\n        - table \"Events\" [ref=f3e66]:\n          - rowgroup [ref=f3e67]:\n            - row [ref=f3e68]:\n              - columnheader \"MET\" [ref=f3e69]\n              - columnheader \"Title\" [ref=f3e70]\n              - columnheader \"Altitude\" [ref=f3e71]\n              - columnheader \"Speed\" [ref=f3e72]\n              - columnheader \"Note\" [ref=f3e73]\n          - rowgroup [ref=f3e74]:\n            - row [ref=f3e75]:\n              - cell \"+000:02:00:00\" [ref=f3e76]\n              - cell \"Perilune pass\" [ref=f3e77]\n              - cell \"20.0 km\" [ref=f3e78]\n              - cell \"1700 m/s\" [ref=f3e79]\n              - cell \"Check against Kestrel log sheet 14 before publishing.\" [ref=f3e80]\n      - paragraph [ref=f3e81]:\n        - link \"Download dossier\" [ref=f3e82] [cursor=pointer]:\n          - /url: /api/missions/6c75ecf7-7a5e-4105-8638-238058819bbc/dossier.pdf\n      - status [ref=f3e83]\n    - region [ref=f3e84]:\n      - heading \"Landmarks\" [level=2] [ref=f3e85]\n      - generic [ref=f3e86]:\n        - generic [ref=f3e87]: Landmark name\n        - textbox \"Landmark name\" [ref=f3e88]:\n          - /placeholder: Tessera-3 landing site\n        - generic [ref=f3e89]: Latitude\n        - textbox \"Latitude\" [ref=f3e90]:\n          - /placeholder: 12.5° S\n        - generic [ref=f3e91]: Longitude\n        - textbox \"Longitude\" [ref=f3e92]:\n          - /placeholder: 45.25° W\n        - button \"Add landmark\" [ref=f3e93] [cursor=pointer]\n      - list \"Landmarks\" [ref=f3e94]:\n        - listitem [ref=f3e95]: No landmarks\n    - region [ref=f3e96]:\n      - heading \"Reference\" [level=2] [ref=f3e97]\n      - generic [ref=f3e98]: Reference target\n      - textbox \"Reference target\" [ref=f3e99]:\n        - /placeholder: TESSERA-3\n      - button \"Set reference\" [ref=f3e100] [cursor=pointer]\n      - button \"Refresh reference\" [ref=f3e101] [cursor=pointer]\n      - paragraph\n    - region [ref=f3e102]:\n      - heading \"Passes\" [level=2] [ref=f3e103]\n      - generic [ref=f3e104]: Capture file\n      - button \"Capture file\" [ref=f3e105]\n      - list \"Passes\"\n      - status [ref=f3e106]\n    - region [ref=f3e107]:\n      - heading \"Share\" [level=2] [ref=f3e108]\n      - generic [ref=f3e109]:\n        - generic [ref=f3e110]: Link expiry (GMT)\n        - textbox \"Link expiry (GMT)\" [ref=f3e111]:\n          - /placeholder: 2026-103/00:00:00\n        - button \"Create share link\" [ref=f3e112] [cursor=pointer]\n      - paragraph [ref=f3e113]: \"Readers now: unknown\"\n      - status [ref=f3e114]\n    - region [ref=f3e115]:\n      - heading \"Subscribers\" [level=2] [ref=f3e116]\n      - generic [ref=f3e117]: Subscriber URL\n      - textbox \"Subscriber URL\" [ref=f3e118]:\n        - /placeholder: https://club.example/hooks/perilune\n      - button \"Add subscriber\" [ref=f3e119] [cursor=pointer]\n      - list \"Subscribers\""
}
```

### Tool call: browser_take_screenshot
- Args
```json
{
  "filename": "evidence/tablet-console.png",
  "scale": "css"
}
```
- Result
```json
{
  "result": "- [Screenshot of viewport](evidence/tablet-console.png)"
}
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
  "page": "- Page URL: http://127.0.0.1:4173/missions/6c75ecf7-7a5e-4105-8638-238058819bbc\n- Page Title: Tessera-3",
  "inlineSnapshot": "- generic [active] [ref=f3e1]:\n  - generic [ref=f3e2]:\n    - paragraph [ref=f3e3]: +000:01:00:00\n    - button \"Channels\" [ref=f3e4] [cursor=pointer]\n  - main [ref=f3e5]:\n    - generic [ref=f3e6]\n    - paragraph [ref=f3e11]: +000:01:00:00\n    - generic [ref=f3e12]\n    - generic [ref=f3e22]\n    - region \"Transcript\" [ref=f3e37]\n    - region \"Events\" [ref=f3e63]\n    - region \"Landmarks\" [ref=f3e84]\n    - region \"Reference\" [ref=f3e96]\n    - region \"Passes\" [ref=f3e102]\n    - region \"Share\" [ref=f3e107]\n    - region \"Subscribers\" [ref=f3e115]"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Channels button",
  "target": "f3e4"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/missions/6c75ecf7-7a5e-4105-8638-238058819bbc\n- Page Title: Tessera-3",
  "snapshot": "- generic [ref=f3e1]:\n  - generic [ref=f3e2]:\n    - paragraph [ref=f3e3]: +000:01:00:00\n    - button \"Channels\" [expanded] [ref=f3e4] [cursor=pointer]\n  - main [ref=f3e5]:\n    - generic [ref=f3e6]:\n      - heading \"Tessera-3\" [level=1] [ref=f3e7]\n      - paragraph [ref=f3e8]: Epoch 2026-073/00:00:00\n      - paragraph [ref=f3e9]: Perilune 20.0 km at +000:02:00:00\n    - paragraph [ref=f3e11]: +000:01:00:00\n    - dialog \"Channels\" [ref=f3e132]:\n      - heading \"Channels\" [level=2] [ref=f3e133]\n      - group \"Distance\" [ref=f3e134]:\n        - radiogroup \"Distance\" [ref=f3e136]:\n          - generic [ref=f3e137] [cursor=pointer]:\n            - radio \"km\" [checked] [active] [ref=f3e138]\n            - text: km\n          - generic [ref=f3e139] [cursor=pointer]:\n            - radio \"nmi\" [ref=f3e140]\n            - text: nmi\n      - group \"Speed\" [ref=f3e141]:\n        - radiogroup \"Speed\" [ref=f3e143]:\n          - generic [ref=f3e144] [cursor=pointer]:\n            - radio \"m/s\" [checked] [ref=f3e145]\n            - text: m/s\n          - generic [ref=f3e146] [cursor=pointer]:\n            - radio \"ft/s\" [ref=f3e147]\n            - text: ft/s\n      - generic [ref=f3e148] [cursor=pointer]:\n        - checkbox \"Event pins\" [checked] [ref=f3e149]\n        - text: Event pins\n      - generic [ref=f3e150] [cursor=pointer]:\n        - checkbox \"Transcript ticks\" [checked] [ref=f3e151]\n        - text: Transcript ticks\n      - button \"Close channels\" [ref=f3e152] [cursor=pointer]\n    - generic [ref=f3e12]:\n      - slider \"Track loupe\" [ref=f3e13]\n      - group \"Readout\" [ref=f3e15]:\n        - paragraph [ref=f3e16]: MET +000:01:00:00\n        - paragraph [ref=f3e17]: GMT 2026-073/01:00:00\n        - paragraph [ref=f3e18]: LAT 0.00° N\n        - paragraph [ref=f3e19]: LON 0.00° E\n        - paragraph [ref=f3e20]: ALT 100.0 km\n        - paragraph [ref=f3e21]: SPD 1600 m/s\n    - generic [ref=f3e22]:\n      - generic [ref=f3e23]:\n        - generic [ref=f3e24]: Go to GMT\n        - textbox \"Go to GMT\" [ref=f3e25]:\n          - /placeholder: 2026-073/02:00:00\n        - button \"Go\" [ref=f3e26] [cursor=pointer]\n      - generic [ref=f3e27]:\n        - button \"Play\" [ref=f3e28] [cursor=pointer]\n        - radiogroup \"Playback rate\" [ref=f3e29]:\n          - generic [ref=f3e30] [cursor=pointer]:\n            - radio \"1×\" [checked] [ref=f3e31]\n            - text: 1×\n          - generic [ref=f3e32] [cursor=pointer]:\n            - radio \"10×\" [ref=f3e33]\n            - text: 10×\n          - generic [ref=f3e34] [cursor=pointer]:\n            - radio \"60×\" [ref=f3e35]\n            - text: 60×\n      - button \"Pin event\" [ref=f3e36] [cursor=pointer]\n    - region [ref=f3e37]:\n      - heading \"Transcript\" [level=2] [ref=f3e38]\n      - generic [ref=f3e39]: Search transcript\n      - searchbox \"Search transcript\" [ref=f3e40]\n      - list \"Search results\"\n      - status [ref=f3e41]\n      - heading \"Speakers\" [level=3] [ref=f3e42]\n      - list \"Speakers\" [ref=f3e43]:\n        - listitem [ref=f3e44]:\n          - generic [ref=f3e45]: KESTREL\n          - generic [ref=f3e46]: \"3\"\n        - listitem [ref=f3e47]:\n          - generic [ref=f3e48]: TESSERA\n          - generic [ref=f3e49]: \"3\"\n      - list \"Transcript lines\" [ref=f3e50]:\n        - listitem [ref=f3e51]:\n          - 'button \"+000:01:00:00 KESTREL: Tessera, Kestrel. Acquisition of signal, loud and clear.\" [ref=f3e52] [cursor=pointer]'\n        - listitem [ref=f3e53]:\n          - 'button \"+000:01:20:00 TESSERA: Kestrel, Tessera. Star tracker locked, attitude nominal.\" [ref=f3e54] [cursor=pointer]'\n        - listitem [ref=f3e55]:\n          - 'button \"+000:01:59:10 KESTREL: Coming up on perilune. Altimeter should read two zero kilometres.\" [ref=f3e56] [cursor=pointer]'\n        - listitem [ref=f3e57]:\n          - 'button \"+000:02:00:00 TESSERA: Perilune. Doppler steady, all channels green.\" [ref=f3e58] [cursor=pointer]'\n        - listitem [ref=f3e59]:\n          - 'button \"+000:02:40:00 KESTREL: Two minutes to loss of signal.\" [ref=f3e60] [cursor=pointer]'\n        - listitem [ref=f3e61]:\n          - 'button \"+000:02:59:50 TESSERA: Kestrel, Tessera. See you on the next pass.\" [ref=f3e62] [cursor=pointer]'\n    - region [ref=f3e63]:\n      - heading \"Events\" [level=2] [ref=f3e64]\n      - region \"Events\" [ref=f3e65]:\n        - table \"Events\" [ref=f3e66]:\n          - rowgroup [ref=f3e67]:\n            - row [ref=f3e68]:\n              - columnheader \"MET\" [ref=f3e69]\n              - columnheader \"Title\" [ref=f3e70]\n              - columnheader \"Altitude\" [ref=f3e71]\n              - columnheader \"Speed\" [ref=f3e72]\n              - columnheader \"Note\" [ref=f3e73]\n          - rowgroup [ref=f3e74]:\n            - row [ref=f3e75]:\n              - cell \"+000:02:00:00\" [ref=f3e76]\n              - cell \"Perilune pass\" [ref=f3e77]\n              - cell \"20.0 km\" [ref=f3e78]\n              - cell \"1700 m/s\" [ref=f3e79]\n              - cell \"Check against Kestrel log sheet 14 before publishing.\" [ref=f3e80]\n      - paragraph [ref=f3e81]:\n        - link \"Download dossier\" [ref=f3e82] [cursor=pointer]:\n          - /url: /api/missions/6c75ecf7-7a5e-4105-8638-238058819bbc/dossier.pdf\n      - status [ref=f3e83]\n    - region [ref=f3e84]:\n      - heading \"Landmarks\" [level=2] [ref=f3e85]\n      - generic [ref=f3e86]:\n        - generic [ref=f3e87]: Landmark name\n        - textbox \"Landmark name\" [ref=f3e88]:\n          - /placeholder: Tessera-3 landing site\n        - generic [ref=f3e89]: Latitude\n        - textbox \"Latitude\" [ref=f3e90]:\n          - /placeholder: 12.5° S\n        - generic [ref=f3e91]: Longitude\n        - textbox \"Longitude\" [ref=f3e92]:\n          - /placeholder: 45.25° W\n        - button \"Add landmark\" [ref=f3e93] [cursor=pointer]\n      - list \"Landmarks\" [ref=f3e94]:\n        - listitem [ref=f3e120]: No landmarks\n    - region [ref=f3e96]:\n      - heading \"Reference\" [level=2] [ref=f3e97]\n      - generic [ref=f3e98]: Reference target\n      - textbox \"Reference target\" [ref=f3e99]:\n        - /placeholder: TESSERA-3\n      - button \"Set reference\" [ref=f3e100] [cursor=pointer]\n      - button \"Refresh reference\" [ref=f3e101] [cursor=pointer]\n      - paragraph [ref=f3e121]: No reference target\n    - region [ref=f3e102]:\n      - heading \"Passes\" [level=2] [ref=f3e103]\n      - generic [ref=f3e104]: Capture file\n      - button \"Capture file\" [ref=f3e105]\n      - list \"Passes\" [ref=f3e122]:\n        - listitem [ref=f3e123]:\n          - generic [ref=f3e124]: tessera3-orbit1.cap\n          - generic [ref=f3e125]: \"Parsed: 720 samples\"\n          - generic [ref=f3e126]: 53144 bytes\n          - generic [ref=f3e127]:\n            - link \"Download tessera3-orbit1.cap\" [ref=f3e128] [cursor=pointer]:\n              - /url: /api/passes/5e63c77e-983b-42e5-b940-bbf6b4e011d4/capture\n              - text: Download\n            - button \"Delete tessera3-orbit1.cap\" [ref=f3e129] [cursor=pointer]: Delete\n      - status [ref=f3e106]\n    - region [ref=f3e107]:\n      - heading \"Share\" [level=2] [ref=f3e108]\n      - generic [ref=f3e109]:\n        - generic [ref=f3e110]: Link expiry (GMT)\n        - textbox \"Link expiry (GMT)\" [ref=f3e111]:\n          - /placeholder: 2026-103/00:00:00\n        - button \"Create share link\" [ref=f3e112] [cursor=pointer]\n      - paragraph [ref=f3e113]: \"Readers now: 0\"\n      - status [ref=f3e114]\n    - region [ref=f3e115]:\n      - heading \"Subscribers\" [level=2] [ref=f3e116]\n      - generic [ref=f3e117]: Subscriber URL\n      - textbox \"Subscriber URL\" [ref=f3e118]:\n        - /placeholder: https://club.example/hooks/perilune\n      - button \"Add subscriber\" [ref=f3e119] [cursor=pointer]\n      - list \"Subscribers\" [ref=f3e130]:\n        - listitem [ref=f3e131]: No subscribers"
}
```

### Tool call: browser_evaluate
- Args
```json
{
  "function": "() => {const d=document.querySelector('[role=\"dialog\"][aria-label=\"Channels\"]') ?? document.querySelector('dialog'); const r=d?.getBoundingClientRect(); return {viewport:[innerWidth,innerHeight],box:r?{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}:null,text:d?.textContent}}"
}
```
- Result
```json
{
  "result": "{\n  \"viewport\": [\n    768,\n    1024\n  ],\n  \"box\": {\n    \"x\": 0,\n    \"y\": 0,\n    \"right\": 320,\n    \"bottom\": 1024,\n    \"width\": 320,\n    \"height\": 1024\n  },\n  \"text\": \"\\n    Channels\\n    \\n      Distance\\n      \\n         km\\n         nmi\\n      \\n    \\n    \\n      Speed\\n      \\n         m/s\\n         ft/s\\n      \\n    \\n     Event pins\\n     Transcript ticks\\n  Close channels\"\n}"
}
```

### Tool call: browser_take_screenshot
- Args
```json
{
  "filename": "evidence/tablet-channels.png",
  "scale": "css"
}
```
- Result
```json
{
  "result": "- [Screenshot of viewport](evidence/tablet-channels.png)"
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
  "inlineSnapshot": "- generic [ref=f3e1]:\n  - generic [ref=f3e2]:\n    - paragraph [ref=f3e3]: +000:01:00:00\n    - button \"Channels\" [expanded] [ref=f3e4] [cursor=pointer]\n  - main [ref=f3e5]:\n    - generic [ref=f3e6]:\n      - heading \"Tessera-3\" [level=1] [ref=f3e7]\n      - paragraph [ref=f3e8]: Epoch 2026-073/00:00:00\n      - paragraph [ref=f3e9]: Perilune 20.0 km at +000:02:00:00\n    - paragraph [ref=f3e11]: +000:01:00:00\n    - dialog \"Channels\" [ref=f3e132]:\n      - heading \"Channels\" [level=2] [ref=f3e133]\n      - group \"Distance\" [ref=f3e134]\n      - group \"Speed\" [ref=f3e141]\n      - generic [ref=f3e148] [cursor=pointer]\n      - generic [ref=f3e150] [cursor=pointer]\n      - button \"Close channels\" [ref=f3e152] [cursor=pointer]\n    - generic [ref=f3e12]:\n      - slider \"Track loupe\" [ref=f3e13]\n      - group \"Readout\" [ref=f3e15]\n    - generic [ref=f3e22]:\n      - generic [ref=f3e23]\n      - generic [ref=f3e27]\n      - button \"Pin event\" [ref=f3e36] [cursor=pointer]\n    - region [ref=f3e37]:\n      - heading \"Transcript\" [level=2] [ref=f3e38]\n      - generic [ref=f3e39]: Search transcript\n      - searchbox \"Search transcript\" [ref=f3e40]\n      - list \"Search results\"\n      - status [ref=f3e41]\n      - heading \"Speakers\" [level=3] [ref=f3e42]\n      - list \"Speakers\" [ref=f3e43]\n      - list \"Transcript lines\" [ref=f3e50]\n    - region [ref=f3e63]:\n      - heading \"Events\" [level=2] [ref=f3e64]\n      - region \"Events\" [ref=f3e65]\n      - paragraph [ref=f3e81]\n      - status [ref=f3e83]\n    - region [ref=f3e84]:\n      - heading \"Landmarks\" [level=2] [ref=f3e85]\n      - generic [ref=f3e86]\n      - list \"Landmarks\" [ref=f3e94]\n    - region [ref=f3e96]:\n      - heading \"Reference\" [level=2] [ref=f3e97]\n      - generic [ref=f3e98]: Reference target\n      - textbox \"Reference target\" [ref=f3e99]:\n        - /placeholder: TESSERA-3\n      - button \"Set reference\" [ref=f3e100] [cursor=pointer]\n      - button \"Refresh reference\" [ref=f3e101] [cursor=pointer]\n      - paragraph [ref=f3e121]: No reference target\n    - region [ref=f3e102]:\n      - heading \"Passes\" [level=2] [ref=f3e103]\n      - generic [ref=f3e104]: Capture file\n      - button \"Capture file\" [ref=f3e105]\n      - list \"Passes\" [ref=f3e122]\n      - status [ref=f3e106]\n    - region [ref=f3e107]:\n      - heading \"Share\" [level=2] [ref=f3e108]\n      - generic [ref=f3e109]\n      - paragraph [ref=f3e113]: \"Readers now: 0\"\n      - status [ref=f3e114]\n    - region [ref=f3e115]:\n      - heading \"Subscribers\" [level=2] [ref=f3e116]\n      - generic [ref=f3e117]: Subscriber URL\n      - textbox \"Subscriber URL\" [ref=f3e118]:\n        - /placeholder: https://club.example/hooks/perilune\n      - button \"Add subscriber\" [ref=f3e119] [cursor=pointer]\n      - list \"Subscribers\" [ref=f3e130]"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Close channels",
  "target": "f3e152"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/missions/6c75ecf7-7a5e-4105-8638-238058819bbc\n- Page Title: Tessera-3",
  "snapshot": "- generic [ref=f3e1]:\n  - generic [ref=f3e2]:\n    - paragraph [ref=f3e3]: +000:01:00:00\n    - button \"Channels\" [active] [ref=f3e4] [cursor=pointer]\n  - main [ref=f3e5]:\n    - generic [ref=f3e6]:\n      - heading \"Tessera-3\" [level=1] [ref=f3e7]\n      - paragraph [ref=f3e8]: Epoch 2026-073/00:00:00\n      - paragraph [ref=f3e9]: Perilune 20.0 km at +000:02:00:00\n    - paragraph [ref=f3e11]: +000:01:00:00\n    - generic [ref=f3e12]:\n      - slider \"Track loupe\" [ref=f3e13]\n      - group \"Readout\" [ref=f3e15]:\n        - paragraph [ref=f3e16]: MET +000:01:00:00\n        - paragraph [ref=f3e17]: GMT 2026-073/01:00:00\n        - paragraph [ref=f3e18]: LAT 0.00° N\n        - paragraph [ref=f3e19]: LON 0.00° E\n        - paragraph [ref=f3e20]: ALT 100.0 km\n        - paragraph [ref=f3e21]: SPD 1600 m/s\n    - generic [ref=f3e22]:\n      - generic [ref=f3e23]:\n        - generic [ref=f3e24]: Go to GMT\n        - textbox \"Go to GMT\" [ref=f3e25]:\n          - /placeholder: 2026-073/02:00:00\n        - button \"Go\" [ref=f3e26] [cursor=pointer]\n      - generic [ref=f3e27]:\n        - button \"Play\" [ref=f3e28] [cursor=pointer]\n        - radiogroup \"Playback rate\" [ref=f3e29]:\n          - generic [ref=f3e30] [cursor=pointer]:\n            - radio \"1×\" [checked] [ref=f3e31]\n            - text: 1×\n          - generic [ref=f3e32] [cursor=pointer]:\n            - radio \"10×\" [ref=f3e33]\n            - text: 10×\n          - generic [ref=f3e34] [cursor=pointer]:\n            - radio \"60×\" [ref=f3e35]\n            - text: 60×\n      - button \"Pin event\" [ref=f3e36] [cursor=pointer]\n    - region [ref=f3e37]:\n      - heading \"Transcript\" [level=2] [ref=f3e38]\n      - generic [ref=f3e39]: Search transcript\n      - searchbox \"Search transcript\" [ref=f3e40]\n      - list \"Search results\"\n      - status [ref=f3e41]\n      - heading \"Speakers\" [level=3] [ref=f3e42]\n      - list \"Speakers\" [ref=f3e43]:\n        - listitem [ref=f3e44]:\n          - generic [ref=f3e45]: KESTREL\n          - generic [ref=f3e46]: \"3\"\n        - listitem [ref=f3e47]:\n          - generic [ref=f3e48]: TESSERA\n          - generic [ref=f3e49]: \"3\"\n      - list \"Transcript lines\" [ref=f3e50]:\n        - listitem [ref=f3e51]:\n          - 'button \"+000:01:00:00 KESTREL: Tessera, Kestrel. Acquisition of signal, loud and clear.\" [ref=f3e52] [cursor=pointer]'\n        - listitem [ref=f3e53]:\n          - 'button \"+000:01:20:00 TESSERA: Kestrel, Tessera. Star tracker locked, attitude nominal.\" [ref=f3e54] [cursor=pointer]'\n        - listitem [ref=f3e55]:\n          - 'button \"+000:01:59:10 KESTREL: Coming up on perilune. Altimeter should read two zero kilometres.\" [ref=f3e56] [cursor=pointer]'\n        - listitem [ref=f3e57]:\n          - 'button \"+000:02:00:00 TESSERA: Perilune. Doppler steady, all channels green.\" [ref=f3e58] [cursor=pointer]'\n        - listitem [ref=f3e59]:\n          - 'button \"+000:02:40:00 KESTREL: Two minutes to loss of signal.\" [ref=f3e60] [cursor=pointer]'\n        - listitem [ref=f3e61]:\n          - 'button \"+000:02:59:50 TESSERA: Kestrel, Tessera. See you on the next pass.\" [ref=f3e62] [cursor=pointer]'\n    - region [ref=f3e63]:\n      - heading \"Events\" [level=2] [ref=f3e64]\n      - region \"Events\" [ref=f3e65]:\n        - table \"Events\" [ref=f3e66]:\n          - rowgroup [ref=f3e67]:\n            - row [ref=f3e68]:\n              - columnheader \"MET\" [ref=f3e69]\n              - columnheader \"Title\" [ref=f3e70]\n              - columnheader \"Altitude\" [ref=f3e71]\n              - columnheader \"Speed\" [ref=f3e72]\n              - columnheader \"Note\" [ref=f3e73]\n          - rowgroup [ref=f3e74]:\n            - row [ref=f3e75]:\n              - cell \"+000:02:00:00\" [ref=f3e76]\n              - cell \"Perilune pass\" [ref=f3e77]\n              - cell \"20.0 km\" [ref=f3e78]\n              - cell \"1700 m/s\" [ref=f3e79]\n              - cell \"Check against Kestrel log sheet 14 before publishing.\" [ref=f3e80]\n      - paragraph [ref=f3e81]:\n        - link \"Download dossier\" [ref=f3e82] [cursor=pointer]:\n          - /url: /api/missions/6c75ecf7-7a5e-4105-8638-238058819bbc/dossier.pdf\n      - status [ref=f3e83]\n    - region [ref=f3e84]:\n      - heading \"Landmarks\" [level=2] [ref=f3e85]\n      - generic [ref=f3e86]:\n        - generic [ref=f3e87]: Landmark name\n        - textbox \"Landmark name\" [ref=f3e88]:\n          - /placeholder: Tessera-3 landing site\n        - generic [ref=f3e89]: Latitude\n        - textbox \"Latitude\" [ref=f3e90]:\n          - /placeholder: 12.5° S\n        - generic [ref=f3e91]: Longitude\n        - textbox \"Longitude\" [ref=f3e92]:\n          - /placeholder: 45.25° W\n        - button \"Add landmark\" [ref=f3e93] [cursor=pointer]\n      - list \"Landmarks\" [ref=f3e94]:\n        - listitem [ref=f3e120]: No landmarks\n    - region [ref=f3e96]:\n      - heading \"Reference\" [level=2] [ref=f3e97]\n      - generic [ref=f3e98]: Reference target\n      - textbox \"Reference target\" [ref=f3e99]:\n        - /placeholder: TESSERA-3\n      - button \"Set reference\" [ref=f3e100] [cursor=pointer]\n      - button \"Refresh reference\" [ref=f3e101] [cursor=pointer]\n      - paragraph [ref=f3e121]: No reference target\n    - region [ref=f3e102]:\n      - heading \"Passes\" [level=2] [ref=f3e103]\n      - generic [ref=f3e104]: Capture file\n      - button \"Capture file\" [ref=f3e105]\n      - list \"Passes\" [ref=f3e122]:\n        - listitem [ref=f3e123]:\n          - generic [ref=f3e124]: tessera3-orbit1.cap\n          - generic [ref=f3e125]: \"Parsed: 720 samples\"\n          - generic [ref=f3e126]: 53144 bytes\n          - generic [ref=f3e127]:\n            - link \"Download tessera3-orbit1.cap\" [ref=f3e128] [cursor=pointer]:\n              - /url: /api/passes/5e63c77e-983b-42e5-b940-bbf6b4e011d4/capture\n              - text: Download\n            - button \"Delete tessera3-orbit1.cap\" [ref=f3e129] [cursor=pointer]: Delete\n      - status [ref=f3e106]\n    - region [ref=f3e107]:\n      - heading \"Share\" [level=2] [ref=f3e108]\n      - generic [ref=f3e109]:\n        - generic [ref=f3e110]: Link expiry (GMT)\n        - textbox \"Link expiry (GMT)\" [ref=f3e111]:\n          - /placeholder: 2026-103/00:00:00\n        - button \"Create share link\" [ref=f3e112] [cursor=pointer]\n      - paragraph [ref=f3e113]: \"Readers now: 0\"\n      - status [ref=f3e114]\n    - region [ref=f3e115]:\n      - heading \"Subscribers\" [level=2] [ref=f3e116]\n      - generic [ref=f3e117]: Subscriber URL\n      - textbox \"Subscriber URL\" [ref=f3e118]:\n        - /placeholder: https://club.example/hooks/perilune\n      - button \"Add subscriber\" [ref=f3e119] [cursor=pointer]\n      - list \"Subscribers\" [ref=f3e130]:\n        - listitem [ref=f3e131]: No subscribers"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Pin event button",
  "target": "f3e36"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/missions/6c75ecf7-7a5e-4105-8638-238058819bbc\n- Page Title: Tessera-3",
  "snapshot": "- generic [ref=f3e1]:\n  - generic [ref=f3e2]:\n    - paragraph [ref=f3e3]: +000:01:00:00\n    - button \"Channels\" [ref=f3e4] [cursor=pointer]\n  - main [ref=f3e5]:\n    - generic [ref=f3e6]:\n      - heading \"Tessera-3\" [level=1] [ref=f3e7]\n      - paragraph [ref=f3e8]: Epoch 2026-073/00:00:00\n      - paragraph [ref=f3e9]: Perilune 20.0 km at +000:02:00:00\n    - paragraph [ref=f3e11]: +000:01:00:00\n    - generic [ref=f3e12]:\n      - slider \"Track loupe\" [ref=f3e13]\n      - group \"Readout\" [ref=f3e15]:\n        - paragraph [ref=f3e16]: MET +000:01:00:00\n        - paragraph [ref=f3e17]: GMT 2026-073/01:00:00\n        - paragraph [ref=f3e18]: LAT 0.00° N\n        - paragraph [ref=f3e19]: LON 0.00° E\n        - paragraph [ref=f3e20]: ALT 100.0 km\n        - paragraph [ref=f3e21]: SPD 1600 m/s\n    - generic [ref=f3e22]:\n      - generic [ref=f3e23]:\n        - generic [ref=f3e24]: Go to GMT\n        - textbox \"Go to GMT\" [ref=f3e25]:\n          - /placeholder: 2026-073/02:00:00\n        - button \"Go\" [ref=f3e26] [cursor=pointer]\n      - generic [ref=f3e27]:\n        - button \"Play\" [ref=f3e28] [cursor=pointer]\n        - radiogroup \"Playback rate\" [ref=f3e29]:\n          - generic [ref=f3e30] [cursor=pointer]:\n            - radio \"1×\" [checked] [ref=f3e31]\n            - text: 1×\n          - generic [ref=f3e32] [cursor=pointer]:\n            - radio \"10×\" [ref=f3e33]\n            - text: 10×\n          - generic [ref=f3e34] [cursor=pointer]:\n            - radio \"60×\" [ref=f3e35]\n            - text: 60×\n      - button \"Pin event\" [ref=f3e36] [cursor=pointer]\n    - region [ref=f3e37]:\n      - heading \"Transcript\" [level=2] [ref=f3e38]\n      - generic [ref=f3e39]: Search transcript\n      - searchbox \"Search transcript\" [ref=f3e40]\n      - list \"Search results\"\n      - status [ref=f3e41]\n      - heading \"Speakers\" [level=3] [ref=f3e42]\n      - list \"Speakers\" [ref=f3e43]:\n        - listitem [ref=f3e44]:\n          - generic [ref=f3e45]: KESTREL\n          - generic [ref=f3e46]: \"3\"\n        - listitem [ref=f3e47]:\n          - generic [ref=f3e48]: TESSERA\n          - generic [ref=f3e49]: \"3\"\n      - list \"Transcript lines\" [ref=f3e50]:\n        - listitem [ref=f3e51]:\n          - 'button \"+000:01:00:00 KESTREL: Tessera, Kestrel. Acquisition of signal, loud and clear.\" [ref=f3e52] [cursor=pointer]'\n        - listitem [ref=f3e53]:\n          - 'button \"+000:01:20:00 TESSERA: Kestrel, Tessera. Star tracker locked, attitude nominal.\" [ref=f3e54] [cursor=pointer]'\n        - listitem [ref=f3e55]:\n          - 'button \"+000:01:59:10 KESTREL: Coming up on perilune. Altimeter should read two zero kilometres.\" [ref=f3e56] [cursor=pointer]'\n        - listitem [ref=f3e57]:\n          - 'button \"+000:02:00:00 TESSERA: Perilune. Doppler steady, all channels green.\" [ref=f3e58] [cursor=pointer]'\n        - listitem [ref=f3e59]:\n          - 'button \"+000:02:40:00 KESTREL: Two minutes to loss of signal.\" [ref=f3e60] [cursor=pointer]'\n        - listitem [ref=f3e61]:\n          - 'button \"+000:02:59:50 TESSERA: Kestrel, Tessera. See you on the next pass.\" [ref=f3e62] [cursor=pointer]'\n    - region [ref=f3e63]:\n      - heading \"Events\" [level=2] [ref=f3e64]\n      - region \"Events\" [ref=f3e65]:\n        - table \"Events\" [ref=f3e66]:\n          - rowgroup [ref=f3e67]:\n            - row [ref=f3e68]:\n              - columnheader \"MET\" [ref=f3e69]\n              - columnheader \"Title\" [ref=f3e70]\n              - columnheader \"Altitude\" [ref=f3e71]\n              - columnheader \"Speed\" [ref=f3e72]\n              - columnheader \"Note\" [ref=f3e73]\n          - rowgroup [ref=f3e74]:\n            - row [ref=f3e75]:\n              - cell \"+000:02:00:00\" [ref=f3e76]\n              - cell \"Perilune pass\" [ref=f3e77]\n              - cell \"20.0 km\" [ref=f3e78]\n              - cell \"1700 m/s\" [ref=f3e79]\n              - cell \"Check against Kestrel log sheet 14 before publishing.\" [ref=f3e80]\n      - paragraph [ref=f3e81]:\n        - link \"Download dossier\" [ref=f3e82] [cursor=pointer]:\n          - /url: /api/missions/6c75ecf7-7a5e-4105-8638-238058819bbc/dossier.pdf\n      - status [ref=f3e83]\n    - region [ref=f3e84]:\n      - heading \"Landmarks\" [level=2] [ref=f3e85]\n      - generic [ref=f3e86]:\n        - generic [ref=f3e87]: Landmark name\n        - textbox \"Landmark name\" [ref=f3e88]:\n          - /placeholder: Tessera-3 landing site\n        - generic [ref=f3e89]: Latitude\n        - textbox \"Latitude\" [ref=f3e90]:\n          - /placeholder: 12.5° S\n        - generic [ref=f3e91]: Longitude\n        - textbox \"Longitude\" [ref=f3e92]:\n          - /placeholder: 45.25° W\n        - button \"Add landmark\" [ref=f3e93] [cursor=pointer]\n      - list \"Landmarks\" [ref=f3e94]:\n        - listitem [ref=f3e120]: No landmarks\n    - region [ref=f3e96]:\n      - heading \"Reference\" [level=2] [ref=f3e97]\n      - generic [ref=f3e98]: Reference target\n      - textbox \"Reference target\" [ref=f3e99]:\n        - /placeholder: TESSERA-3\n      - button \"Set reference\" [ref=f3e100] [cursor=pointer]\n      - button \"Refresh reference\" [ref=f3e101] [cursor=pointer]\n      - paragraph [ref=f3e121]: No reference target\n    - region [ref=f3e102]:\n      - heading \"Passes\" [level=2] [ref=f3e103]\n      - generic [ref=f3e104]: Capture file\n      - button \"Capture file\" [ref=f3e105]\n      - list \"Passes\" [ref=f3e122]:\n        - listitem [ref=f3e123]:\n          - generic [ref=f3e124]: tessera3-orbit1.cap\n          - generic [ref=f3e125]: \"Parsed: 720 samples\"\n          - generic [ref=f3e126]: 53144 bytes\n          - generic [ref=f3e127]:\n            - link \"Download tessera3-orbit1.cap\" [ref=f3e128] [cursor=pointer]:\n              - /url: /api/passes/5e63c77e-983b-42e5-b940-bbf6b4e011d4/capture\n              - text: Download\n            - button \"Delete tessera3-orbit1.cap\" [ref=f3e129] [cursor=pointer]: Delete\n      - status [ref=f3e106]\n    - region [ref=f3e107]:\n      - heading \"Share\" [level=2] [ref=f3e108]\n      - generic [ref=f3e109]:\n        - generic [ref=f3e110]: Link expiry (GMT)\n        - textbox \"Link expiry (GMT)\" [ref=f3e111]:\n          - /placeholder: 2026-103/00:00:00\n        - button \"Create share link\" [ref=f3e112] [cursor=pointer]\n      - paragraph [ref=f3e113]: \"Readers now: 0\"\n      - status [ref=f3e114]\n    - region [ref=f3e115]:\n      - heading \"Subscribers\" [level=2] [ref=f3e116]\n      - generic [ref=f3e117]: Subscriber URL\n      - textbox \"Subscriber URL\" [ref=f3e118]:\n        - /placeholder: https://club.example/hooks/perilune\n      - button \"Add subscriber\" [ref=f3e119] [cursor=pointer]\n      - list \"Subscribers\" [ref=f3e130]:\n        - listitem [ref=f3e131]: No subscribers\n  - dialog [ref=f3e154]:\n    - heading \"Pin at +000:01:00:00\" [level=2] [ref=f3e155]\n    - generic [ref=f3e156]:\n      - generic [ref=f3e157]: MET\n      - textbox \"MET\" [ref=f3e158]: +000:01:00:00\n    - generic [ref=f3e159]:\n      - generic [ref=f3e160]: Title\n      - textbox \"Title\" [active] [ref=f3e161]\n    - generic [ref=f3e162]:\n      - generic [ref=f3e163]: Private note\n      - textbox \"Private note\" [ref=f3e164]\n    - button \"Save event\" [ref=f3e165] [cursor=pointer]\n    - button \"Cancel\" [ref=f3e166] [cursor=pointer]"
}
```

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
{}
```

### Tool call: browser_evaluate
- Args
```json
{
  "function": "() => { const d=document.querySelector('dialog[open]') ?? document.querySelector('[role=\"dialog\"]'); const c=d?getComputedStyle(d):null; return {text:d?.textContent,bg:c?.backgroundColor,shadow:c?.boxShadow,bgImage:c?.backgroundImage,radius:c?.borderRadius,viewport:[innerWidth,innerHeight]} }"
}
```
- Result
```json
{
  "result": "{\n  \"text\": \"\\n  Pin at +000:01:00:00\\n  \\n    MET\\n    \\n    \\n  \\n  \\n    Title\\n    \\n    \\n  \\n  \\n    Private note\\n    \\n    \\n  \\n  Save event\\n  Cancel\\n\",\n  \"bg\": \"rgba(0, 0, 0, 0)\",\n  \"shadow\": \"none\",\n  \"bgImage\": \"none\",\n  \"radius\": \"0px\",\n  \"viewport\": [\n    1280,\n    800\n  ]\n}"
}
```

### Tool call: browser_take_screenshot
- Args
```json
{
  "filename": "evidence/pin-dialog.png",
  "scale": "css"
}
```
- Result
```json
{
  "result": "- [Screenshot of viewport](evidence/pin-dialog.png)"
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
  "inlineSnapshot": "- generic [ref=f3e1]:\n  - main [ref=f3e5]:\n    - generic [ref=f3e6]:\n      - heading \"Tessera-3\" [level=1] [ref=f3e7]\n      - paragraph [ref=f3e8]: Epoch 2026-073/00:00:00\n      - paragraph [ref=f3e9]: Perilune 20.0 km at +000:02:00:00\n    - paragraph [ref=f3e11]: +000:01:00:00\n    - complementary \"Channels\" [ref=f3e167]:\n      - heading \"Channels\" [level=2] [ref=f3e133]\n      - group \"Distance\" [ref=f3e134]\n      - group \"Speed\" [ref=f3e141]\n      - generic [ref=f3e148] [cursor=pointer]\n      - generic [ref=f3e150] [cursor=pointer]\n      - button \"Close channels\" [ref=f3e152] [cursor=pointer]\n    - generic [ref=f3e12]:\n      - slider \"Track loupe\" [ref=f3e13]\n      - group \"Readout\" [ref=f3e15]\n    - generic [ref=f3e22]:\n      - generic [ref=f3e23]\n      - generic [ref=f3e27]\n      - button \"Pin event\" [ref=f3e36] [cursor=pointer]\n    - region [ref=f3e37]:\n      - heading \"Transcript\" [level=2] [ref=f3e38]\n      - generic [ref=f3e39]: Search transcript\n      - searchbox \"Search transcript\" [ref=f3e40]\n      - list \"Search results\"\n      - status [ref=f3e41]\n      - heading \"Speakers\" [level=3] [ref=f3e42]\n      - list \"Speakers\" [ref=f3e43]\n      - list \"Transcript lines\" [ref=f3e50]\n    - region [ref=f3e63]:\n      - heading \"Events\" [level=2] [ref=f3e64]\n      - region \"Events\" [ref=f3e65]\n      - paragraph [ref=f3e81]\n      - status [ref=f3e83]\n    - region [ref=f3e84]:\n      - heading \"Landmarks\" [level=2] [ref=f3e85]\n      - generic [ref=f3e86]\n      - list \"Landmarks\" [ref=f3e94]\n    - region [ref=f3e96]:\n      - heading \"Reference\" [level=2] [ref=f3e97]\n      - generic [ref=f3e98]: Reference target\n      - textbox \"Reference target\" [ref=f3e99]:\n        - /placeholder: TESSERA-3\n      - button \"Set reference\" [ref=f3e100] [cursor=pointer]\n      - button \"Refresh reference\" [ref=f3e101] [cursor=pointer]\n      - paragraph [ref=f3e121]: No reference target\n    - region [ref=f3e102]:\n      - heading \"Passes\" [level=2] [ref=f3e103]\n      - generic [ref=f3e104]: Capture file\n      - button \"Capture file\" [ref=f3e105]\n      - list \"Passes\" [ref=f3e122]\n      - status [ref=f3e106]\n    - region [ref=f3e107]:\n      - heading \"Share\" [level=2] [ref=f3e108]\n      - generic [ref=f3e109]\n      - paragraph [ref=f3e113]: \"Readers now: 0\"\n      - status [ref=f3e114]\n    - region [ref=f3e115]:\n      - heading \"Subscribers\" [level=2] [ref=f3e116]\n      - generic [ref=f3e117]: Subscriber URL\n      - textbox \"Subscriber URL\" [ref=f3e118]:\n        - /placeholder: https://club.example/hooks/perilune\n      - button \"Add subscriber\" [ref=f3e119] [cursor=pointer]\n      - list \"Subscribers\" [ref=f3e130]\n  - dialog [ref=f3e154]:\n    - heading \"Pin at +000:01:00:00\" [level=2] [ref=f3e155]\n    - generic [ref=f3e156]:\n      - generic [ref=f3e157]: MET\n      - textbox \"MET\" [ref=f3e158]: +000:01:00:00\n    - generic [ref=f3e159]:\n      - generic [ref=f3e160]: Title\n      - textbox \"Title\" [active] [ref=f3e161]\n    - generic [ref=f3e162]:\n      - generic [ref=f3e163]: Private note\n      - textbox \"Private note\" [ref=f3e164]\n    - button \"Save event\" [ref=f3e165] [cursor=pointer]\n    - button \"Cancel\" [ref=f3e166] [cursor=pointer]"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Cancel",
  "target": "f3e166"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/missions/6c75ecf7-7a5e-4105-8638-238058819bbc\n- Page Title: Tessera-3",
  "snapshot": "- main [ref=f3e5]:\n  - generic [ref=f3e6]:\n    - heading \"Tessera-3\" [level=1] [ref=f3e7]\n    - paragraph [ref=f3e8]: Epoch 2026-073/00:00:00\n    - paragraph [ref=f3e9]: Perilune 20.0 km at +000:02:00:00\n  - paragraph [ref=f3e11]: +000:01:00:00\n  - complementary \"Channels\" [ref=f3e167]:\n    - heading \"Channels\" [level=2] [ref=f3e133]\n    - group \"Distance\" [ref=f3e134]:\n      - radiogroup \"Distance\" [ref=f3e136]:\n        - generic [ref=f3e137] [cursor=pointer]:\n          - radio \"km\" [checked] [ref=f3e138]\n          - text: km\n        - generic [ref=f3e139] [cursor=pointer]:\n          - radio \"nmi\" [ref=f3e140]\n          - text: nmi\n    - group \"Speed\" [ref=f3e141]:\n      - radiogroup \"Speed\" [ref=f3e143]:\n        - generic [ref=f3e144] [cursor=pointer]:\n          - radio \"m/s\" [checked] [ref=f3e145]\n          - text: m/s\n        - generic [ref=f3e146] [cursor=pointer]:\n          - radio \"ft/s\" [ref=f3e147]\n          - text: ft/s\n    - generic [ref=f3e148] [cursor=pointer]:\n      - checkbox \"Event pins\" [checked] [ref=f3e149]\n      - text: Event pins\n    - generic [ref=f3e150] [cursor=pointer]:\n      - checkbox \"Transcript ticks\" [checked] [ref=f3e151]\n      - text: Transcript ticks\n    - button \"Close channels\" [ref=f3e152] [cursor=pointer]\n  - generic [ref=f3e12]:\n    - slider \"Track loupe\" [ref=f3e13]\n    - group \"Readout\" [ref=f3e15]:\n      - paragraph [ref=f3e16]: MET +000:01:00:00\n      - paragraph [ref=f3e17]: GMT 2026-073/01:00:00\n      - paragraph [ref=f3e18]: LAT 0.00° N\n      - paragraph [ref=f3e19]: LON 0.00° E\n      - paragraph [ref=f3e20]: ALT 100.0 km\n      - paragraph [ref=f3e21]: SPD 1600 m/s\n  - generic [ref=f3e22]:\n    - generic [ref=f3e23]:\n      - generic [ref=f3e24]: Go to GMT\n      - textbox \"Go to GMT\" [ref=f3e25]:\n        - /placeholder: 2026-073/02:00:00\n      - button \"Go\" [ref=f3e26] [cursor=pointer]\n    - generic [ref=f3e27]:\n      - button \"Play\" [ref=f3e28] [cursor=pointer]\n      - radiogroup \"Playback rate\" [ref=f3e29]:\n        - generic [ref=f3e30] [cursor=pointer]:\n          - radio \"1×\" [checked] [ref=f3e31]\n          - text: 1×\n        - generic [ref=f3e32] [cursor=pointer]:\n          - radio \"10×\" [ref=f3e33]\n          - text: 10×\n        - generic [ref=f3e34] [cursor=pointer]:\n          - radio \"60×\" [ref=f3e35]\n          - text: 60×\n    - button \"Pin event\" [active] [ref=f3e36] [cursor=pointer]\n  - region [ref=f3e37]:\n    - heading \"Transcript\" [level=2] [ref=f3e38]\n    - generic [ref=f3e39]: Search transcript\n    - searchbox \"Search transcript\" [ref=f3e40]\n    - list \"Search results\"\n    - status [ref=f3e41]\n    - heading \"Speakers\" [level=3] [ref=f3e42]\n    - list \"Speakers\" [ref=f3e43]:\n      - listitem [ref=f3e44]:\n        - generic [ref=f3e45]: KESTREL\n        - generic [ref=f3e46]: \"3\"\n      - listitem [ref=f3e47]:\n        - generic [ref=f3e48]: TESSERA\n        - generic [ref=f3e49]: \"3\"\n    - list \"Transcript lines\" [ref=f3e50]:\n      - listitem [ref=f3e51]:\n        - 'button \"+000:01:00:00 KESTREL: Tessera, Kestrel. Acquisition of signal, loud and clear.\" [ref=f3e52] [cursor=pointer]'\n      - listitem [ref=f3e53]:\n        - 'button \"+000:01:20:00 TESSERA: Kestrel, Tessera. Star tracker locked, attitude nominal.\" [ref=f3e54] [cursor=pointer]'\n      - listitem [ref=f3e55]:\n        - 'button \"+000:01:59:10 KESTREL: Coming up on perilune. Altimeter should read two zero kilometres.\" [ref=f3e56] [cursor=pointer]'\n      - listitem [ref=f3e57]:\n        - 'button \"+000:02:00:00 TESSERA: Perilune. Doppler steady, all channels green.\" [ref=f3e58] [cursor=pointer]'\n      - listitem [ref=f3e59]:\n        - 'button \"+000:02:40:00 KESTREL: Two minutes to loss of signal.\" [ref=f3e60] [cursor=pointer]'\n      - listitem [ref=f3e61]:\n        - 'button \"+000:02:59:50 TESSERA: Kestrel, Tessera. See you on the next pass.\" [ref=f3e62] [cursor=pointer]'\n  - region [ref=f3e63]:\n    - heading \"Events\" [level=2] [ref=f3e64]\n    - region \"Events\" [ref=f3e65]:\n      - table \"Events\" [ref=f3e66]:\n        - rowgroup [ref=f3e67]:\n          - row [ref=f3e68]:\n            - columnheader \"MET\" [ref=f3e69]\n            - columnheader \"Title\" [ref=f3e70]\n            - columnheader \"Altitude\" [ref=f3e71]\n            - columnheader \"Speed\" [ref=f3e72]\n            - columnheader \"Note\" [ref=f3e73]\n        - rowgroup [ref=f3e74]:\n          - row [ref=f3e75]:\n            - cell \"+000:02:00:00\" [ref=f3e76]\n            - cell \"Perilune pass\" [ref=f3e77]\n            - cell \"20.0 km\" [ref=f3e78]\n            - cell \"1700 m/s\" [ref=f3e79]\n            - cell \"Check against Kestrel log sheet 14 before publishing.\" [ref=f3e80]\n    - paragraph [ref=f3e81]:\n      - link \"Download dossier\" [ref=f3e82] [cursor=pointer]:\n        - /url: /api/missions/6c75ecf7-7a5e-4105-8638-238058819bbc/dossier.pdf\n    - status [ref=f3e83]\n  - region [ref=f3e84]:\n    - heading \"Landmarks\" [level=2] [ref=f3e85]\n    - generic [ref=f3e86]:\n      - generic [ref=f3e87]: Landmark name\n      - textbox \"Landmark name\" [ref=f3e88]:\n        - /placeholder: Tessera-3 landing site\n      - generic [ref=f3e89]: Latitude\n      - textbox \"Latitude\" [ref=f3e90]:\n        - /placeholder: 12.5° S\n      - generic [ref=f3e91]: Longitude\n      - textbox \"Longitude\" [ref=f3e92]:\n        - /placeholder: 45.25° W\n      - button \"Add landmark\" [ref=f3e93] [cursor=pointer]\n    - list \"Landmarks\" [ref=f3e94]:\n      - listitem [ref=f3e120]: No landmarks\n  - region [ref=f3e96]:\n    - heading \"Reference\" [level=2] [ref=f3e97]\n    - generic [ref=f3e98]: Reference target\n    - textbox \"Reference target\" [ref=f3e99]:\n      - /placeholder: TESSERA-3\n    - button \"Set reference\" [ref=f3e100] [cursor=pointer]\n    - button \"Refresh reference\" [ref=f3e101] [cursor=pointer]\n    - paragraph [ref=f3e121]: No reference target\n  - region [ref=f3e102]:\n    - heading \"Passes\" [level=2] [ref=f3e103]\n    - generic [ref=f3e104]: Capture file\n    - button \"Capture file\" [ref=f3e105]\n    - list \"Passes\" [ref=f3e122]:\n      - listitem [ref=f3e123]:\n        - generic [ref=f3e124]: tessera3-orbit1.cap\n        - generic [ref=f3e125]: \"Parsed: 720 samples\"\n        - generic [ref=f3e126]: 53144 bytes\n        - generic [ref=f3e127]:\n          - link \"Download tessera3-orbit1.cap\" [ref=f3e128] [cursor=pointer]:\n            - /url: /api/passes/5e63c77e-983b-42e5-b940-bbf6b4e011d4/capture\n            - text: Download\n          - button \"Delete tessera3-orbit1.cap\" [ref=f3e129] [cursor=pointer]: Delete\n    - status [ref=f3e106]\n  - region [ref=f3e107]:\n    - heading \"Share\" [level=2] [ref=f3e108]\n    - generic [ref=f3e109]:\n      - generic [ref=f3e110]: Link expiry (GMT)\n      - textbox \"Link expiry (GMT)\" [ref=f3e111]:\n        - /placeholder: 2026-103/00:00:00\n      - button \"Create share link\" [ref=f3e112] [cursor=pointer]\n    - paragraph [ref=f3e113]: \"Readers now: 0\"\n    - status [ref=f3e114]\n  - region [ref=f3e115]:\n    - heading \"Subscribers\" [level=2] [ref=f3e116]\n    - generic [ref=f3e117]: Subscriber URL\n    - textbox \"Subscriber URL\" [ref=f3e118]:\n      - /placeholder: https://club.example/hooks/perilune\n    - button \"Add subscriber\" [ref=f3e119] [cursor=pointer]\n    - list \"Subscribers\" [ref=f3e130]:\n      - listitem [ref=f3e131]: No subscribers"
}
```
