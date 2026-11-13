
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
  "snapshot": "- main [ref=e2]:\n  - heading \"Missions\" [level=1] [ref=e3]\n  - region \"Missions\" [ref=e4]:\n    - list \"Missions\" [ref=e5]:\n      - listitem [ref=e6]:\n        - link \"Tessera-3\" [ref=e7] [cursor=pointer]:\n          - /url: /missions/6c75ecf7-7a5e-4105-8638-238058819bbc\n  - generic [ref=e8]:\n    - heading \"New mission\" [level=2] [ref=e9]\n    - generic [ref=e10]:\n      - generic [ref=e11]: Mission name\n      - textbox \"Mission name\" [ref=e12]\n    - generic [ref=e13]:\n      - generic [ref=e14]: Epoch (GMT)\n      - textbox \"Epoch (GMT)\" [ref=e15]:\n        - /placeholder: 2026-073/00:00:00\n    - button \"Create mission\" [ref=e16] [cursor=pointer]\n  - region [ref=e17]:\n    - heading \"Archive plan\" [level=2] [ref=e18]\n    - group \"Plan\" [ref=e19]:\n      - radiogroup \"Plan\" [ref=e21]:\n        - generic [ref=e22] [cursor=pointer]:\n          - radio \"Free, 256.0 MiB\" [ref=e23]\n          - text: Free, 256.0 MiB\n        - generic [ref=e24] [cursor=pointer]:\n          - radio \"Archive 1 GiB, 4.00 USD/month\" [ref=e25]\n          - text: Archive 1 GiB, 4.00 USD/month\n        - generic [ref=e26] [cursor=pointer]:\n          - radio \"Archive 10 GiB, 24.00 USD/month, billed 288.00 USD yearly\" [ref=e27]\n          - text: Archive 10 GiB, 24.00 USD/month, billed 288.00 USD yearly\n      - button \"Change plan\" [ref=e28] [cursor=pointer]\n    - status [ref=e29]"
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
  "inlineSnapshot": "- main [ref=e2]:\n  - heading \"Missions\" [level=1] [ref=e3]\n  - region \"Missions\" [ref=e4]:\n    - list \"Missions\" [ref=e5]:\n      - listitem [ref=e6]:\n        - link \"Tessera-3\" [ref=e7] [cursor=pointer]:\n          - /url: /missions/6c75ecf7-7a5e-4105-8638-238058819bbc\n  - generic [ref=e8]:\n    - heading \"New mission\" [level=2] [ref=e9]\n    - generic [ref=e10]:\n      - generic [ref=e11]: Mission name\n      - textbox \"Mission name\" [ref=e12]\n    - generic [ref=e13]:\n      - generic [ref=e14]: Epoch (GMT)\n      - textbox \"Epoch (GMT)\" [ref=e15]:\n        - /placeholder: 2026-073/00:00:00\n    - button \"Create mission\" [ref=e16] [cursor=pointer]\n  - region [ref=e17]:\n    - heading \"Archive plan\" [level=2] [ref=e18]\n    - generic [ref=e30]:\n      - paragraph [ref=e31]: \"Plan Free: Free\"\n      - paragraph [ref=e32]: Used 51.9 KiB of 256.0 MiB\n      - paragraph [ref=e33]: Next invoice 2026-12-08\n      - paragraph [ref=e34]: Balance 0.00 USD\n    - group \"Plan\" [ref=e19]:\n      - radiogroup \"Plan\" [ref=e21]:\n        - generic [ref=e22] [cursor=pointer]:\n          - radio \"Free, 256.0 MiB\" [checked] [ref=e23]\n          - text: Free, 256.0 MiB\n        - generic [ref=e24] [cursor=pointer]:\n          - radio \"Archive 1 GiB, 4.00 USD/month\" [ref=e25]\n          - text: Archive 1 GiB, 4.00 USD/month\n        - generic [ref=e26] [cursor=pointer]:\n          - radio \"Archive 10 GiB, 24.00 USD/month, billed 288.00 USD yearly\" [ref=e27]\n          - text: Archive 10 GiB, 24.00 USD/month, billed 288.00 USD yearly\n      - button \"Change plan\" [ref=e28] [cursor=pointer]\n    - status [ref=e29]"
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
  "type": "png",
  "filename": "evidence/desktop-initial.png",
  "fullPage": false,
  "scale": "css"
}
```
- Result
```json
{
  "result": "- [Screenshot of viewport](evidence/desktop-initial.png)"
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
  "type": "png",
  "filename": "evidence/desktop-blocked-rail.png",
  "fullPage": false,
  "scale": "css"
}
```
- Result
```json
{
  "result": "- [Screenshot of viewport](evidence/desktop-blocked-rail.png)"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Close channels",
  "target": "f1e29"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/missions/6c75ecf7-7a5e-4105-8638-238058819bbc?t=6900\n- Page Title: Tessera-3",
  "snapshot": "- main [ref=f1e2]:\n  - generic [ref=f1e3]:\n    - heading \"Tessera-3\" [level=1] [ref=f1e4]\n    - paragraph [ref=f1e5]: Epoch 2026-073/00:00:00\n    - paragraph [ref=f1e6]: Perilune 20.0 km at +000:02:00:00\n  - paragraph [ref=f1e8]: +000:01:55:00\n  - complementary \"Channels\" [ref=f1e9]:\n    - heading \"Channels\" [level=2] [ref=f1e10]\n    - group \"Distance\" [ref=f1e11]:\n      - radiogroup \"Distance\" [ref=f1e13]:\n        - generic [ref=f1e14] [cursor=pointer]:\n          - radio \"km\" [checked] [ref=f1e15]\n          - text: km\n        - generic [ref=f1e16] [cursor=pointer]:\n          - radio \"nmi\" [ref=f1e17]\n          - text: nmi\n    - group \"Speed\" [ref=f1e18]:\n      - radiogroup \"Speed\" [ref=f1e20]:\n        - generic [ref=f1e21] [cursor=pointer]:\n          - radio \"m/s\" [checked] [ref=f1e22]\n          - text: m/s\n        - generic [ref=f1e23] [cursor=pointer]:\n          - radio \"ft/s\" [ref=f1e24]\n          - text: ft/s\n    - generic [ref=f1e25] [cursor=pointer]:\n      - checkbox \"Event pins\" [checked] [ref=f1e26]\n      - text: Event pins\n    - generic [ref=f1e27] [cursor=pointer]:\n      - checkbox \"Transcript ticks\" [checked] [ref=f1e28]\n      - text: Transcript ticks\n    - button \"Close channels\" [active] [ref=f1e29] [cursor=pointer]\n  - generic [ref=f1e30]:\n    - slider \"Track loupe\" [ref=f1e31]\n    - group \"Readout\" [ref=f1e33]:\n      - paragraph [ref=f1e34]: MET +000:01:55:00\n      - paragraph [ref=f1e35]: GMT 2026-073/01:55:00\n      - paragraph [ref=f1e36]: LAT 7.44° N\n      - paragraph [ref=f1e37]: LON 166.94° E\n      - paragraph [ref=f1e38]: ALT 21.4 km\n      - paragraph [ref=f1e39]: SPD 1698 m/s\n  - generic [ref=f1e40]:\n    - generic [ref=f1e41]:\n      - generic [ref=f1e42]: Go to GMT\n      - textbox \"Go to GMT\" [ref=f1e43]:\n        - /placeholder: 2026-073/02:00:00\n        - text: 2026-073/01:55:00\n      - button \"Go\" [ref=f1e44] [cursor=pointer]\n    - generic [ref=f1e45]:\n      - button \"Play\" [ref=f1e46] [cursor=pointer]\n      - radiogroup \"Playback rate\" [ref=f1e47]:\n        - generic [ref=f1e48] [cursor=pointer]:\n          - radio \"1×\" [checked] [ref=f1e49]\n          - text: 1×\n        - generic [ref=f1e50] [cursor=pointer]:\n          - radio \"10×\" [ref=f1e51]\n          - text: 10×\n        - generic [ref=f1e52] [cursor=pointer]:\n          - radio \"60×\" [ref=f1e53]\n          - text: 60×\n    - button \"Pin event\" [ref=f1e54] [cursor=pointer]\n  - region [ref=f1e55]:\n    - heading \"Transcript\" [level=2] [ref=f1e56]\n    - generic [ref=f1e57]: Search transcript\n    - searchbox \"Search transcript\" [ref=f1e58]\n    - list \"Search results\"\n    - status [ref=f1e59]\n    - heading \"Speakers\" [level=3] [ref=f1e60]\n    - list \"Speakers\" [ref=f1e61]:\n      - listitem [ref=f1e62]:\n        - generic [ref=f1e63]: KESTREL\n        - generic [ref=f1e64]: \"3\"\n      - listitem [ref=f1e65]:\n        - generic [ref=f1e66]: TESSERA\n        - generic [ref=f1e67]: \"3\"\n    - list \"Transcript lines\" [ref=f1e68]:\n      - listitem [ref=f1e69]:\n        - 'button \"+000:01:00:00 KESTREL: Tessera, Kestrel. Acquisition of signal, loud and clear.\" [ref=f1e70] [cursor=pointer]'\n      - listitem [ref=f1e71]:\n        - 'button \"+000:01:20:00 TESSERA: Kestrel, Tessera. Star tracker locked, attitude nominal.\" [ref=f1e72] [cursor=pointer]'\n      - listitem [ref=f1e73]:\n        - 'button \"+000:01:59:10 KESTREL: Coming up on perilune. Altimeter should read two zero kilometres.\" [ref=f1e74] [cursor=pointer]'\n      - listitem [ref=f1e75]:\n        - 'button \"+000:02:00:00 TESSERA: Perilune. Doppler steady, all channels green.\" [ref=f1e76] [cursor=pointer]'\n      - listitem [ref=f1e77]:\n        - 'button \"+000:02:40:00 KESTREL: Two minutes to loss of signal.\" [ref=f1e78] [cursor=pointer]'\n      - listitem [ref=f1e79]:\n        - 'button \"+000:02:59:50 TESSERA: Kestrel, Tessera. See you on the next pass.\" [ref=f1e80] [cursor=pointer]'\n  - region [ref=f1e81]:\n    - heading \"Events\" [level=2] [ref=f1e82]\n    - region \"Events\" [ref=f1e83]:\n      - table \"Events\" [ref=f1e84]:\n        - rowgroup [ref=f1e85]:\n          - row [ref=f1e86]:\n            - columnheader \"MET\" [ref=f1e87]\n            - columnheader \"Title\" [ref=f1e88]\n            - columnheader \"Altitude\" [ref=f1e89]\n            - columnheader \"Speed\" [ref=f1e90]\n            - columnheader \"Note\" [ref=f1e91]\n        - rowgroup [ref=f1e92]:\n          - row [ref=f1e93]:\n            - cell \"+000:02:00:00\" [ref=f1e94]\n            - cell \"Perilune pass\" [ref=f1e95]\n            - cell \"20.0 km\" [ref=f1e96]\n            - cell \"1700 m/s\" [ref=f1e97]\n            - cell \"Check against Kestrel log sheet 14 before publishing.\" [ref=f1e98]\n    - paragraph [ref=f1e99]:\n      - link \"Download dossier\" [ref=f1e100] [cursor=pointer]:\n        - /url: /api/missions/6c75ecf7-7a5e-4105-8638-238058819bbc/dossier.pdf\n    - status [ref=f1e101]\n  - region [ref=f1e102]:\n    - heading \"Landmarks\" [level=2] [ref=f1e103]\n    - generic [ref=f1e104]:\n      - generic [ref=f1e105]: Landmark name\n      - textbox \"Landmark name\" [ref=f1e106]:\n        - /placeholder: Tessera-3 landing site\n      - generic [ref=f1e107]: Latitude\n      - textbox \"Latitude\" [ref=f1e108]:\n        - /placeholder: 12.5° S\n      - generic [ref=f1e109]: Longitude\n      - textbox \"Longitude\" [ref=f1e110]:\n        - /placeholder: 45.25° W\n      - button \"Add landmark\" [ref=f1e111] [cursor=pointer]\n    - list \"Landmarks\" [ref=f1e112]:\n      - listitem [ref=f1e138]: No landmarks\n  - region [ref=f1e114]:\n    - heading \"Reference\" [level=2] [ref=f1e115]\n    - generic [ref=f1e116]: Reference target\n    - textbox \"Reference target\" [ref=f1e117]:\n      - /placeholder: TESSERA-3\n    - button \"Set reference\" [ref=f1e118] [cursor=pointer]\n    - button \"Refresh reference\" [ref=f1e119] [cursor=pointer]\n    - paragraph [ref=f1e139]: No reference target\n  - region [ref=f1e120]:\n    - heading \"Passes\" [level=2] [ref=f1e121]\n    - generic [ref=f1e122]: Capture file\n    - button \"Capture file\" [ref=f1e123]\n    - list \"Passes\" [ref=f1e140]:\n      - listitem [ref=f1e141]:\n        - generic [ref=f1e142]: tessera3-orbit1.cap\n        - generic [ref=f1e143]: \"Parsed: 720 samples\"\n        - generic [ref=f1e144]: 53144 bytes\n        - generic [ref=f1e145]:\n          - link \"Download tessera3-orbit1.cap\" [ref=f1e146] [cursor=pointer]:\n            - /url: /api/passes/5e63c77e-983b-42e5-b940-bbf6b4e011d4/capture\n            - text: Download\n          - button \"Delete tessera3-orbit1.cap\" [ref=f1e147] [cursor=pointer]: Delete\n    - status [ref=f1e124]\n  - region [ref=f1e125]:\n    - heading \"Share\" [level=2] [ref=f1e126]\n    - generic [ref=f1e127]:\n      - generic [ref=f1e128]: Link expiry (GMT)\n      - textbox \"Link expiry (GMT)\" [ref=f1e129]:\n        - /placeholder: 2026-103/00:00:00\n      - button \"Create share link\" [ref=f1e130] [cursor=pointer]\n    - paragraph [ref=f1e131]: \"Readers now: 0\"\n    - status [ref=f1e132]\n  - region [ref=f1e133]:\n    - heading \"Subscribers\" [level=2] [ref=f1e134]\n    - generic [ref=f1e135]: Subscriber URL\n    - textbox \"Subscriber URL\" [ref=f1e136]:\n      - /placeholder: https://club.example/hooks/perilune\n    - button \"Add subscriber\" [ref=f1e137] [cursor=pointer]\n    - list \"Subscribers\" [ref=f1e148]:\n      - listitem [ref=f1e149]: No subscribers"
}
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
  "result": "{\n  \"tag\": \"BUTTON\",\n  \"id\": \"close-channels\",\n  \"text\": \"Close channels\"\n}"
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

### Tool call: browser_evaluate
- Args
```json
{
  "function": "() => ({tag:document.activeElement?.tagName,id:document.activeElement?.id,aria:document.activeElement?.getAttribute('aria-label'),text:document.activeElement?.textContent})"
}
```
- Result
```json
{
  "result": "{\n  \"tag\": \"INPUT\",\n  \"id\": \"\",\n  \"aria\": null,\n  \"text\": \"\"\n}"
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
  "function": "() => ({tag:document.activeElement?.tagName,id:document.activeElement?.id,text:document.activeElement?.textContent,aria:document.activeElement?.getAttribute('aria-label')})"
}
```
- Result
```json
{
  "result": "{\n  \"tag\": \"INPUT\",\n  \"id\": \"\",\n  \"text\": \"\",\n  \"aria\": null\n}"
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

### Tool call: browser_evaluate
- Args
```json
{
  "function": "() => ({tag:document.activeElement?.tagName,id:document.activeElement?.id,text:document.activeElement?.textContent,type:(document.activeElement instanceof HTMLInputElement)?document.activeElement.type:null})"
}
```
- Result
```json
{
  "result": "{\n  \"tag\": \"INPUT\",\n  \"id\": \"event-pins\",\n  \"text\": \"\",\n  \"type\": \"checkbox\"\n}"
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

### Tool call: browser_evaluate
- Args
```json
{
  "function": "() => ({tag:document.activeElement?.tagName,id:document.activeElement?.id,text:document.activeElement?.textContent,type:(document.activeElement instanceof HTMLInputElement)?document.activeElement.type:null})"
}
```
- Result
```json
{
  "result": "{\n  \"tag\": \"INPUT\",\n  \"id\": \"\",\n  \"text\": \"\",\n  \"type\": \"radio\"\n}"
}
```

### Tool call: browser_evaluate
- Args
```json
{
  "function": "() => { const h=document.querySelector('h1'); const p=[...document.querySelectorAll('p')].find(e=>e.textContent?.startsWith('+000:')); const line=document.querySelector('[aria-label=\"Transcript lines\"] button'); const name=document.querySelector('input[aria-label=\"Landmark name\"],#landmark-name'); const ids=['events-region','landmarks-region','reference-region','passes-region','share-region','pin-event-button']; const sty=(e)=>e?{tag:e.tagName,cls:e.className,font:getComputedStyle(e).fontFamily,weight:getComputedStyle(e).fontWeight,style:getComputedStyle(e).fontStyle,size:getComputedStyle(e).fontSize,bg:getComputedStyle(e).backgroundColor,shadow:getComputedStyle(e).boxShadow,bgi:getComputedStyle(e).backgroundImage,radius:getComputedStyle(e).borderRadius}:null; return {body:sty(document.body),h1:sty(h),met:sty(p),line:sty(line),name:sty(name),regions:ids.map(id=>[id,sty(document.getElementById(id))]),fonts:{h:document.fonts.check(`${getComputedStyle(h).fontStyle} ${getComputedStyle(h).fontWeight} ${getComputedStyle(h).fontSize} ${getComputedStyle(h).fontFamily}`),m:p&&document.fonts.check(`${getComputedStyle(p).fontStyle} ${getComputedStyle(p).fontWeight} ${getComputedStyle(p).fontSize} ${getComputedStyle(p).fontFamily}`),l:line&&document.fonts.check(`${getComputedStyle(line).fontStyle} ${getComputedStyle(line).fontWeight} ${getComputedStyle(line).fontSize} ${getComputedStyle(line).fontFamily}`)}} }"
}
```
- Result
```json
{
  "result": "{\n  \"body\": {\n    \"tag\": \"BODY\",\n    \"cls\": \"console-page author\",\n    \"font\": \"\\\"IBM Plex Sans\\\", system-ui, sans-serif\",\n    \"weight\": \"400\",\n    \"style\": \"normal\",\n    \"size\": \"16px\",\n    \"bg\": \"rgb(216, 210, 200)\",\n    \"shadow\": \"none\",\n    \"bgi\": \"none\",\n    \"radius\": \"0px\"\n  },\n  \"h1\": {\n    \"tag\": \"H1\",\n    \"cls\": \"\",\n    \"font\": \"Archivo, system-ui, sans-serif\",\n    \"weight\": \"700\",\n    \"style\": \"normal\",\n    \"size\": \"32px\",\n    \"bg\": \"rgba(0, 0, 0, 0)\",\n    \"shadow\": \"none\",\n    \"bgi\": \"none\",\n    \"radius\": \"0px\"\n  },\n  \"met\": {\n    \"tag\": \"P\",\n    \"cls\": \"band-met\",\n    \"font\": \"\\\"IBM Plex Mono\\\", monospace\",\n    \"weight\": \"600\",\n    \"style\": \"normal\",\n    \"size\": \"24px\",\n    \"bg\": \"rgba(0, 0, 0, 0)\",\n    \"shadow\": \"none\",\n    \"bgi\": \"none\",\n    \"radius\": \"0px\"\n  },\n  \"line\": {\n    \"tag\": \"BUTTON\",\n    \"cls\": \"\",\n    \"font\": \"\\\"IBM Plex Mono\\\", monospace\",\n    \"weight\": \"400\",\n    \"style\": \"normal\",\n    \"size\": \"14.4px\",\n    \"bg\": \"rgba(0, 0, 0, 0)\",\n    \"shadow\": \"none\",\n    \"bgi\": \"none\",\n    \"radius\": \"0px\"\n  },\n  \"name\": {\n    \"tag\": \"INPUT\",\n    \"cls\": \"\",\n    \"font\": \"\\\"IBM Plex Sans\\\", system-ui, sans-serif\",\n    \"weight\": \"400\",\n    \"style\": \"normal\",\n    \"size\": \"16px\",\n    \"bg\": \"rgb(226, 220, 210)\",\n    \"shadow\": \"none\",\n    \"bgi\": \"none\",\n    \"radius\": \"0px\"\n  },\n  \"regions\": [\n    [\n      \"events-region\",\n      {\n        \"tag\": \"SECTION\",\n        \"cls\": \"events-region\",\n        \"font\": \"\\\"IBM Plex Sans\\\", system-ui, sans-serif\",\n        \"weight\": \"400\",\n        \"style\": \"normal\",\n        \"size\": \"16px\",\n        \"bg\": \"rgba(0, 0, 0, 0)\",\n        \"shadow\": \"none\",\n        \"bgi\": \"none\",\n        \"radius\": \"0px\"\n      }\n    ],\n    [\n      \"landmarks-region\",\n      {\n        \"tag\": \"SECTION\",\n        \"cls\": \"landmarks-region\",\n        \"font\": \"\\\"IBM Plex Sans\\\", system-ui, sans-serif\",\n        \"weight\": \"400\",\n        \"style\": \"normal\",\n        \"size\": \"16px\",\n        \"bg\": \"rgba(0, 0, 0, 0)\",\n        \"shadow\": \"none\",\n        \"bgi\": \"none\",\n        \"radius\": \"0px\"\n      }\n    ],\n    [\n      \"reference-region\",\n      {\n        \"tag\": \"SECTION\",\n        \"cls\": \"reference-region\",\n        \"font\": \"\\\"IBM Plex Sans\\\", system-ui, sans-serif\",\n        \"weight\": \"400\",\n        \"style\": \"normal\",\n        \"size\": \"16px\",\n        \"bg\": \"rgba(0, 0, 0, 0)\",\n        \"shadow\": \"none\",\n        \"bgi\": \"none\",\n        \"radius\": \"0px\"\n      }\n    ],\n    [\n      \"passes-region\",\n      {\n        \"tag\": \"SECTION\",\n        \"cls\": \"passes-region\",\n        \"font\": \"\\\"IBM Plex Sans\\\", system-ui, sans-serif\",\n        \"weight\": \"400\",\n        \"style\": \"normal\",\n        \"size\": \"16px\",\n        \"bg\": \"rgba(0, 0, 0, 0)\",\n        \"shadow\": \"none\",\n        \"bgi\": \"none\",\n        \"radius\": \"0px\"\n      }\n    ],\n    [\n      \"share-region\",\n      {\n        \"tag\": \"SECTION\",\n        \"cls\": \"share-region\",\n        \"font\": \"\\\"IBM Plex Sans\\\", system-ui, sans-serif\",\n        \"weight\": \"400\",\n        \"style\": \"normal\",\n        \"size\": \"16px\",\n        \"bg\": \"rgba(0, 0, 0, 0)\",\n        \"shadow\": \"none\",\n        \"bgi\": \"none\",\n        \"radius\": \"0px\"\n      }\n    ],\n    [\n      \"pin-event-button\",\n      {\n        \"tag\": \"BUTTON\",\n        \"cls\": \"\",\n        \"font\": \"\\\"IBM Plex Sans\\\", system-ui, sans-serif\",\n        \"weight\": \"400\",\n        \"style\": \"normal\",\n        \"size\": \"16px\",\n        \"bg\": \"rgb(38, 34, 28)\",\n        \"shadow\": \"none\",\n        \"bgi\": \"none\",\n        \"radius\": \"0px\"\n      }\n    ]\n  ],\n  \"fonts\": {\n    \"h\": true,\n    \"m\": true,\n    \"l\": true\n  }\n}"
}
```

### Tool call: browser_evaluate
- Args
```json
{
  "function": "() => [...document.querySelectorAll('p')].filter(e=>e.textContent?.startsWith('+000:')).map(e=>({text:e.textContent,cls:e.className,size:getComputedStyle(e).fontSize,display:getComputedStyle(e).display,rect:e.getBoundingClientRect().toJSON()}))"
}
```
- Result
```json
{
  "result": "[\n  {\n    \"text\": \"+000:01:55:00\",\n    \"cls\": \"band-met\",\n    \"size\": \"24px\",\n    \"display\": \"block\",\n    \"rect\": {\n      \"x\": 0,\n      \"y\": 0,\n      \"width\": 0,\n      \"height\": 0,\n      \"top\": 0,\n      \"right\": 0,\n      \"bottom\": 0,\n      \"left\": 0\n    }\n  },\n  {\n    \"text\": \"+000:01:55:00\",\n    \"cls\": \"met-readout\",\n    \"size\": \"73.6px\",\n    \"display\": \"block\",\n    \"rect\": {\n      \"x\": 148.484375,\n      \"y\": -569.046875,\n      \"width\": 916.78125,\n      \"height\": 73.59375,\n      \"top\": -569.046875,\n      \"right\": 1065.265625,\n      \"bottom\": -495.453125,\n      \"left\": 148.484375\n    }\n  }\n]"
}
```

### Tool call: browser_evaluate
- Args
```json
{
  "function": "() => {const e=document.querySelector('.met-readout');const s=getComputedStyle(e);return {font:s.fontFamily,weight:s.fontWeight,style:s.fontStyle,size:s.fontSize,loaded:document.fonts.check(`${s.fontStyle} ${s.fontWeight} ${s.fontSize} ${s.fontFamily}`)}}"
}
```
- Result
```json
{
  "result": "{\n  \"font\": \"\\\"IBM Plex Mono\\\", monospace\",\n  \"weight\": \"600\",\n  \"style\": \"normal\",\n  \"size\": \"73.6px\",\n  \"loaded\": true\n}"
}
```

### Tool call: browser_press_key
- Args
```json
{
  "key": "Escape"
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
  "function": "() => ({open:document.getElementById('channels-rail')?.getAttribute('data-open'),rect:document.getElementById('channels-rail')?.getBoundingClientRect().toJSON()})"
}
```
- Result
```json
{
  "result": "{\n  \"open\": \"true\",\n  \"rect\": {\n    \"x\": 0,\n    \"y\": 0,\n    \"width\": 320,\n    \"height\": 800,\n    \"top\": 0,\n    \"right\": 320,\n    \"bottom\": 800,\n    \"left\": 0\n  }\n}"
}
```

### Tool call: browser_fill_form
- Args
```json
{
  "fields": [
    {
      "target": "f1e58",
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
  "depth": 5
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/missions/6c75ecf7-7a5e-4105-8638-238058819bbc?t=6900&q=perilune\n- Page Title: Tessera-3",
  "inlineSnapshot": "- main [ref=f1e2]:\n  - generic [ref=f1e3]:\n    - heading \"Tessera-3\" [level=1] [ref=f1e4]\n    - paragraph [ref=f1e5]: Epoch 2026-073/00:00:00\n    - paragraph [ref=f1e6]: Perilune 20.0 km at +000:02:00:00\n  - paragraph [ref=f1e8]: +000:01:55:00\n  - complementary \"Channels\" [ref=f1e9]:\n    - heading \"Channels\" [level=2] [ref=f1e10]\n    - group \"Distance\" [ref=f1e11]:\n      - radiogroup \"Distance\" [ref=f1e13]:\n        - generic [ref=f1e14] [cursor=pointer]:\n          - radio \"km\" [checked] [ref=f1e15]\n          - text: km\n        - generic [ref=f1e16] [cursor=pointer]:\n          - radio \"nmi\" [ref=f1e17]\n          - text: nmi\n    - group \"Speed\" [ref=f1e18]:\n      - radiogroup \"Speed\" [ref=f1e20]:\n        - generic [ref=f1e21] [cursor=pointer]:\n          - radio \"m/s\" [checked] [ref=f1e22]\n          - text: m/s\n        - generic [ref=f1e23] [cursor=pointer]:\n          - radio \"ft/s\" [ref=f1e24]\n          - text: ft/s\n    - generic [ref=f1e25] [cursor=pointer]:\n      - checkbox \"Event pins\" [checked] [ref=f1e26]\n      - text: Event pins\n    - generic [ref=f1e27] [cursor=pointer]:\n      - checkbox \"Transcript ticks\" [checked] [ref=f1e28]\n      - text: Transcript ticks\n    - button \"Close channels\" [ref=f1e29] [cursor=pointer]\n  - generic [ref=f1e30]:\n    - slider \"Track loupe\" [ref=f1e31]\n    - group \"Readout\" [ref=f1e33]:\n      - paragraph [ref=f1e34]: MET +000:01:55:00\n      - paragraph [ref=f1e35]: GMT 2026-073/01:55:00\n      - paragraph [ref=f1e36]: LAT 7.44° N\n      - paragraph [ref=f1e37]: LON 166.94° E\n      - paragraph [ref=f1e38]: ALT 21.4 km\n      - paragraph [ref=f1e39]: SPD 1698 m/s\n  - generic [ref=f1e40]:\n    - generic [ref=f1e41]:\n      - generic [ref=f1e42]: Go to GMT\n      - textbox \"Go to GMT\" [ref=f1e43]:\n        - /placeholder: 2026-073/02:00:00\n        - text: 2026-073/01:55:00\n      - button \"Go\" [ref=f1e44] [cursor=pointer]\n    - generic [ref=f1e45]:\n      - button \"Play\" [ref=f1e46] [cursor=pointer]\n      - radiogroup \"Playback rate\" [ref=f1e47]:\n        - generic [ref=f1e48] [cursor=pointer]:\n          - radio \"1×\" [checked] [ref=f1e49]\n          - text: 1×\n        - generic [ref=f1e50] [cursor=pointer]:\n          - radio \"10×\" [ref=f1e51]\n          - text: 10×\n        - generic [ref=f1e52] [cursor=pointer]:\n          - radio \"60×\" [ref=f1e53]\n          - text: 60×\n    - button \"Pin event\" [ref=f1e54] [cursor=pointer]\n  - region [ref=f1e55]:\n    - heading \"Transcript\" [level=2] [ref=f1e56]\n    - generic [ref=f1e57]: Search transcript\n    - searchbox \"Search transcript\" [active] [ref=f1e58]: perilune\n    - list \"Search results\" [ref=f1e151]:\n      - listitem [ref=f1e152]:\n        - 'button \"+000:01:59:10 KESTREL: Coming up on perilune. Altimeter should read two zero kilometres.\" [ref=f1e153] [cursor=pointer]'\n      - listitem [ref=f1e154]:\n        - 'button \"+000:02:00:00 TESSERA: Perilune. Doppler steady, all channels green.\" [ref=f1e155] [cursor=pointer]'\n      - listitem [ref=f1e156]:\n        - button \"+000:02:00:00 Perilune pass\" [ref=f1e157] [cursor=pointer]\n    - status [ref=f1e59]: 3 results for \"perilune\"\n    - heading \"Speakers\" [level=3] [ref=f1e60]\n    - list \"Speakers\" [ref=f1e61]:\n      - listitem [ref=f1e62]:\n        - generic [ref=f1e63]: KESTREL\n        - generic [ref=f1e64]: \"3\"\n      - listitem [ref=f1e65]:\n        - generic [ref=f1e66]: TESSERA\n        - generic [ref=f1e67]: \"3\"\n    - list \"Transcript lines\" [ref=f1e68]:\n      - listitem [ref=f1e69]:\n        - 'button \"+000:01:00:00 KESTREL: Tessera, Kestrel. Acquisition of signal, loud and clear.\" [ref=f1e70] [cursor=pointer]'\n      - listitem [ref=f1e71]:\n        - 'button \"+000:01:20:00 TESSERA: Kestrel, Tessera. Star tracker locked, attitude nominal.\" [ref=f1e72] [cursor=pointer]'\n      - listitem [ref=f1e73]:\n        - 'button \"+000:01:59:10 KESTREL: Coming up on perilune. Altimeter should read two zero kilometres.\" [ref=f1e74] [cursor=pointer]'\n      - listitem [ref=f1e75]:\n        - 'button \"+000:02:00:00 TESSERA: Perilune. Doppler steady, all channels green.\" [ref=f1e76] [cursor=pointer]'\n      - listitem [ref=f1e77]:\n        - 'button \"+000:02:40:00 KESTREL: Two minutes to loss of signal.\" [ref=f1e78] [cursor=pointer]'\n      - listitem [ref=f1e79]:\n        - 'button \"+000:02:59:50 TESSERA: Kestrel, Tessera. See you on the next pass.\" [ref=f1e80] [cursor=pointer]'\n  - region [ref=f1e81]:\n    - heading \"Events\" [level=2] [ref=f1e82]\n    - region \"Events\" [ref=f1e83]:\n      - table \"Events\" [ref=f1e84]:\n        - rowgroup [ref=f1e85]:\n          - row \"MET Title Altitude Speed Note\" [ref=f1e86]\n        - rowgroup [ref=f1e92]:\n          - row \"+000:02:00:00 Perilune pass 20.0 km 1700 m/s Check against Kestrel log sheet 14 before publishing.\" [ref=f1e93]\n    - paragraph [ref=f1e99]:\n      - link \"Download dossier\" [ref=f1e100] [cursor=pointer]:\n        - /url: /api/missions/6c75ecf7-7a5e-4105-8638-238058819bbc/dossier.pdf\n    - status [ref=f1e101]\n  - region [ref=f1e102]:\n    - heading \"Landmarks\" [level=2] [ref=f1e103]\n    - generic [ref=f1e104]:\n      - generic [ref=f1e105]: Landmark name\n      - textbox \"Landmark name\" [ref=f1e106]:\n        - /placeholder: Tessera-3 landing site\n      - generic [ref=f1e107]: Latitude\n      - textbox \"Latitude\" [ref=f1e108]:\n        - /placeholder: 12.5° S\n      - generic [ref=f1e109]: Longitude\n      - textbox \"Longitude\" [ref=f1e110]:\n        - /placeholder: 45.25° W\n      - button \"Add landmark\" [ref=f1e111] [cursor=pointer]\n    - list \"Landmarks\" [ref=f1e112]:\n      - listitem [ref=f1e138]: No landmarks\n  - region [ref=f1e114]:\n    - heading \"Reference\" [level=2] [ref=f1e115]\n    - generic [ref=f1e116]: Reference target\n    - textbox \"Reference target\" [ref=f1e117]:\n      - /placeholder: TESSERA-3\n    - button \"Set reference\" [ref=f1e118] [cursor=pointer]\n    - button \"Refresh reference\" [ref=f1e119] [cursor=pointer]\n    - paragraph [ref=f1e139]: No reference target\n  - region [ref=f1e120]:\n    - heading \"Passes\" [level=2] [ref=f1e121]\n    - generic [ref=f1e122]: Capture file\n    - button \"Capture file\" [ref=f1e123]\n    - list \"Passes\" [ref=f1e140]:\n      - listitem [ref=f1e141]:\n        - generic [ref=f1e142]: tessera3-orbit1.cap\n        - generic [ref=f1e143]: \"Parsed: 720 samples\"\n        - generic [ref=f1e144]: 53144 bytes\n        - generic [ref=f1e145]:\n          - link \"Download tessera3-orbit1.cap\" [ref=f1e146] [cursor=pointer]:\n            - /url: /api/passes/5e63c77e-983b-42e5-b940-bbf6b4e011d4/capture\n            - text: Download\n          - button \"Delete tessera3-orbit1.cap\" [ref=f1e147] [cursor=pointer]: Delete\n    - status [ref=f1e124]\n  - region [ref=f1e125]:\n    - heading \"Share\" [level=2] [ref=f1e126]\n    - generic [ref=f1e127]:\n      - generic [ref=f1e128]: Link expiry (GMT)\n      - textbox \"Link expiry (GMT)\" [ref=f1e129]:\n        - /placeholder: 2026-103/00:00:00\n      - button \"Create share link\" [ref=f1e130] [cursor=pointer]\n    - paragraph [ref=f1e131]: \"Readers now: 0\"\n    - status [ref=f1e132]\n  - region [ref=f1e133]:\n    - heading \"Subscribers\" [level=2] [ref=f1e134]\n    - generic [ref=f1e135]: Subscriber URL\n    - textbox \"Subscriber URL\" [ref=f1e136]:\n      - /placeholder: https://club.example/hooks/perilune\n    - button \"Add subscriber\" [ref=f1e137] [cursor=pointer]\n    - list \"Subscribers\" [ref=f1e148]:\n      - listitem [ref=f1e149]: No subscribers"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Perilune search result",
  "target": "f1e155"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/missions/6c75ecf7-7a5e-4105-8638-238058819bbc?t=7200&q=perilune\n- Page Title: Tessera-3",
  "snapshot": "- main [ref=f1e2]:\n  - generic [ref=f1e3]:\n    - heading \"Tessera-3\" [level=1] [ref=f1e4]\n    - paragraph [ref=f1e5]: Epoch 2026-073/00:00:00\n    - paragraph [ref=f1e6]: Perilune 20.0 km at +000:02:00:00\n  - paragraph [ref=f1e8]: +000:02:00:00\n  - complementary \"Channels\" [ref=f1e9]:\n    - heading \"Channels\" [level=2] [ref=f1e10]\n    - group \"Distance\" [ref=f1e11]:\n      - radiogroup \"Distance\" [ref=f1e13]:\n        - generic [ref=f1e14] [cursor=pointer]:\n          - radio \"km\" [checked] [ref=f1e15]\n          - text: km\n        - generic [ref=f1e16] [cursor=pointer]:\n          - radio \"nmi\" [ref=f1e17]\n          - text: nmi\n    - group \"Speed\" [ref=f1e18]:\n      - radiogroup \"Speed\" [ref=f1e20]:\n        - generic [ref=f1e21] [cursor=pointer]:\n          - radio \"m/s\" [checked] [ref=f1e22]\n          - text: m/s\n        - generic [ref=f1e23] [cursor=pointer]:\n          - radio \"ft/s\" [ref=f1e24]\n          - text: ft/s\n    - generic [ref=f1e25] [cursor=pointer]:\n      - checkbox \"Event pins\" [checked] [ref=f1e26]\n      - text: Event pins\n    - generic [ref=f1e27] [cursor=pointer]:\n      - checkbox \"Transcript ticks\" [checked] [ref=f1e28]\n      - text: Transcript ticks\n    - button \"Close channels\" [ref=f1e29] [cursor=pointer]\n  - generic [ref=f1e30]:\n    - slider \"Track loupe\" [ref=f1e31]\n    - group \"Readout\" [ref=f1e33]:\n      - paragraph [ref=f1e34]: MET +000:02:00:00\n      - paragraph [ref=f1e35]: GMT 2026-073/02:00:00\n      - paragraph [ref=f1e36]: LAT 0.00° N\n      - paragraph [ref=f1e37]: LON 180.00° E\n      - paragraph [ref=f1e38]: ALT 20.0 km\n      - paragraph [ref=f1e39]: SPD 1700 m/s\n  - generic [ref=f1e40]:\n    - generic [ref=f1e41]:\n      - generic [ref=f1e42]: Go to GMT\n      - textbox \"Go to GMT\" [ref=f1e43]:\n        - /placeholder: 2026-073/02:00:00\n        - text: 2026-073/01:55:00\n      - button \"Go\" [ref=f1e44] [cursor=pointer]\n    - generic [ref=f1e45]:\n      - button \"Play\" [ref=f1e46] [cursor=pointer]\n      - radiogroup \"Playback rate\" [ref=f1e47]:\n        - generic [ref=f1e48] [cursor=pointer]:\n          - radio \"1×\" [checked] [ref=f1e49]\n          - text: 1×\n        - generic [ref=f1e50] [cursor=pointer]:\n          - radio \"10×\" [ref=f1e51]\n          - text: 10×\n        - generic [ref=f1e52] [cursor=pointer]:\n          - radio \"60×\" [ref=f1e53]\n          - text: 60×\n    - button \"Pin event\" [ref=f1e54] [cursor=pointer]\n  - region [ref=f1e55]:\n    - heading \"Transcript\" [level=2] [ref=f1e56]\n    - generic [ref=f1e57]: Search transcript\n    - searchbox \"Search transcript\" [ref=f1e58]: perilune\n    - list \"Search results\" [ref=f1e151]:\n      - listitem [ref=f1e152]:\n        - 'button \"+000:01:59:10 KESTREL: Coming up on perilune. Altimeter should read two zero kilometres.\" [ref=f1e153] [cursor=pointer]'\n      - listitem [ref=f1e154]:\n        - 'button \"+000:02:00:00 TESSERA: Perilune. Doppler steady, all channels green.\" [active] [ref=f1e155] [cursor=pointer]'\n      - listitem [ref=f1e156]:\n        - button \"+000:02:00:00 Perilune pass\" [ref=f1e157] [cursor=pointer]\n    - status [ref=f1e59]: 3 results for \"perilune\"\n    - heading \"Speakers\" [level=3] [ref=f1e60]\n    - list \"Speakers\" [ref=f1e61]:\n      - listitem [ref=f1e62]:\n        - generic [ref=f1e63]: KESTREL\n        - generic [ref=f1e64]: \"3\"\n      - listitem [ref=f1e65]:\n        - generic [ref=f1e66]: TESSERA\n        - generic [ref=f1e67]: \"3\"\n    - list \"Transcript lines\" [ref=f1e68]:\n      - listitem [ref=f1e69]:\n        - 'button \"+000:01:00:00 KESTREL: Tessera, Kestrel. Acquisition of signal, loud and clear.\" [ref=f1e70] [cursor=pointer]'\n      - listitem [ref=f1e71]:\n        - 'button \"+000:01:20:00 TESSERA: Kestrel, Tessera. Star tracker locked, attitude nominal.\" [ref=f1e72] [cursor=pointer]'\n      - listitem [ref=f1e73]:\n        - 'button \"+000:01:59:10 KESTREL: Coming up on perilune. Altimeter should read two zero kilometres.\" [ref=f1e74] [cursor=pointer]'\n      - listitem [ref=f1e75]:\n        - 'button \"+000:02:00:00 TESSERA: Perilune. Doppler steady, all channels green.\" [ref=f1e76] [cursor=pointer]'\n      - listitem [ref=f1e77]:\n        - 'button \"+000:02:40:00 KESTREL: Two minutes to loss of signal.\" [ref=f1e78] [cursor=pointer]'\n      - listitem [ref=f1e79]:\n        - 'button \"+000:02:59:50 TESSERA: Kestrel, Tessera. See you on the next pass.\" [ref=f1e80] [cursor=pointer]'\n  - region [ref=f1e81]:\n    - heading \"Events\" [level=2] [ref=f1e82]\n    - region \"Events\" [ref=f1e83]:\n      - table \"Events\" [ref=f1e84]:\n        - rowgroup [ref=f1e85]:\n          - row [ref=f1e86]:\n            - columnheader \"MET\" [ref=f1e87]\n            - columnheader \"Title\" [ref=f1e88]\n            - columnheader \"Altitude\" [ref=f1e89]\n            - columnheader \"Speed\" [ref=f1e90]\n            - columnheader \"Note\" [ref=f1e91]\n        - rowgroup [ref=f1e92]:\n          - row [ref=f1e93]:\n            - cell \"+000:02:00:00\" [ref=f1e94]\n            - cell \"Perilune pass\" [ref=f1e95]\n            - cell \"20.0 km\" [ref=f1e96]\n            - cell \"1700 m/s\" [ref=f1e97]\n            - cell \"Check against Kestrel log sheet 14 before publishing.\" [ref=f1e98]\n    - paragraph [ref=f1e99]:\n      - link \"Download dossier\" [ref=f1e100] [cursor=pointer]:\n        - /url: /api/missions/6c75ecf7-7a5e-4105-8638-238058819bbc/dossier.pdf\n    - status [ref=f1e101]\n  - region [ref=f1e102]:\n    - heading \"Landmarks\" [level=2] [ref=f1e103]\n    - generic [ref=f1e104]:\n      - generic [ref=f1e105]: Landmark name\n      - textbox \"Landmark name\" [ref=f1e106]:\n        - /placeholder: Tessera-3 landing site\n      - generic [ref=f1e107]: Latitude\n      - textbox \"Latitude\" [ref=f1e108]:\n        - /placeholder: 12.5° S\n      - generic [ref=f1e109]: Longitude\n      - textbox \"Longitude\" [ref=f1e110]:\n        - /placeholder: 45.25° W\n      - button \"Add landmark\" [ref=f1e111] [cursor=pointer]\n    - list \"Landmarks\" [ref=f1e112]:\n      - listitem [ref=f1e138]: No landmarks\n  - region [ref=f1e114]:\n    - heading \"Reference\" [level=2] [ref=f1e115]\n    - generic [ref=f1e116]: Reference target\n    - textbox \"Reference target\" [ref=f1e117]:\n      - /placeholder: TESSERA-3\n    - button \"Set reference\" [ref=f1e118] [cursor=pointer]\n    - button \"Refresh reference\" [ref=f1e119] [cursor=pointer]\n    - paragraph [ref=f1e139]: No reference target\n  - region [ref=f1e120]:\n    - heading \"Passes\" [level=2] [ref=f1e121]\n    - generic [ref=f1e122]: Capture file\n    - button \"Capture file\" [ref=f1e123]\n    - list \"Passes\" [ref=f1e140]:\n      - listitem [ref=f1e141]:\n        - generic [ref=f1e142]: tessera3-orbit1.cap\n        - generic [ref=f1e143]: \"Parsed: 720 samples\"\n        - generic [ref=f1e144]: 53144 bytes\n        - generic [ref=f1e145]:\n          - link \"Download tessera3-orbit1.cap\" [ref=f1e146] [cursor=pointer]:\n            - /url: /api/passes/5e63c77e-983b-42e5-b940-bbf6b4e011d4/capture\n            - text: Download\n          - button \"Delete tessera3-orbit1.cap\" [ref=f1e147] [cursor=pointer]: Delete\n    - status [ref=f1e124]\n  - region [ref=f1e125]:\n    - heading \"Share\" [level=2] [ref=f1e126]\n    - generic [ref=f1e127]:\n      - generic [ref=f1e128]: Link expiry (GMT)\n      - textbox \"Link expiry (GMT)\" [ref=f1e129]:\n        - /placeholder: 2026-103/00:00:00\n      - button \"Create share link\" [ref=f1e130] [cursor=pointer]\n    - paragraph [ref=f1e131]: \"Readers now: 0\"\n    - status [ref=f1e132]\n  - region [ref=f1e133]:\n    - heading \"Subscribers\" [level=2] [ref=f1e134]\n    - generic [ref=f1e135]: Subscriber URL\n    - textbox \"Subscriber URL\" [ref=f1e136]:\n      - /placeholder: https://club.example/hooks/perilune\n    - button \"Add subscriber\" [ref=f1e137] [cursor=pointer]\n    - list \"Subscribers\" [ref=f1e148]:\n      - listitem [ref=f1e149]: No subscribers"
}
```

### Tool call: browser_take_screenshot
- Args
```json
{
  "type": "png",
  "filename": "evidence/desktop-search-selected.png",
  "fullPage": false,
  "scale": "css"
}
```
- Result
```json
{
  "result": "- [Screenshot of viewport](evidence/desktop-search-selected.png)"
}
```

### Tool call: browser_evaluate
- Args
```json
{
  "function": "() => {const plate=document.querySelector('[aria-label=\"Readout\"]'); const line=[...document.querySelectorAll('[aria-label=\"Transcript lines\"] button')].find(e=>e.textContent?.includes('+000:02:00:00')); return {plate:plate?.textContent,line:line?.textContent,border:getComputedStyle(line).borderLeftColor,width:getComputedStyle(line).borderLeftWidth,rect:line?.getBoundingClientRect().toJSON()}}"
}
```
- Result
```json
{
  "result": "{\n  \"plate\": \"\\n        MET +000:02:00:00\\n        GMT 2026-073/02:00:00\\n        LAT 0.00° N\\n        LON 180.00° E\\n        ALT 20.0 km\\n        SPD 1700 m/s\\n        \\n        \\n      \",\n  \"line\": \"+000:02:00:00 TESSERA: Perilune. Doppler steady, all channels green.\",\n  \"border\": \"rgb(47, 77, 107)\",\n  \"width\": \"4px\",\n  \"rect\": {\n    \"x\": 1098.265625,\n    \"y\": 656.234375,\n    \"width\": 165.734375,\n    \"height\": 143.84375,\n    \"top\": 656.234375,\n    \"right\": 1264,\n    \"bottom\": 800.078125,\n    \"left\": 1098.265625\n  }\n}"
}
```

### Tool call: browser_evaluate
- Args
```json
{
  "function": "() => { const b=[...document.querySelectorAll('[aria-label=\"Transcript lines\"] button')].find(e=>e.textContent?.includes('+000:02:00:00')); if(b instanceof HTMLElement){b.click(); return true} return false }"
}
```
- Result
```json
{
  "result": "true"
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
  "page": "- Page URL: http://127.0.0.1:4173/missions/6c75ecf7-7a5e-4105-8638-238058819bbc?t=7200&q=perilune\n- Page Title: Tessera-3",
  "snapshot": "- main [ref=f1e2]:\n  - generic [ref=f1e3]:\n    - heading \"Tessera-3\" [level=1] [ref=f1e4]\n    - paragraph [ref=f1e5]: Epoch 2026-073/00:00:00\n    - paragraph [ref=f1e6]: Perilune 20.0 km at +000:02:00:00\n  - paragraph [ref=f1e8]: +000:02:00:00\n  - complementary \"Channels\" [ref=f1e9]:\n    - heading \"Channels\" [level=2] [ref=f1e10]\n    - group \"Distance\" [ref=f1e11]:\n      - radiogroup \"Distance\" [ref=f1e13]:\n        - generic [ref=f1e14] [cursor=pointer]:\n          - radio \"km\" [checked] [ref=f1e15]\n          - text: km\n        - generic [ref=f1e16] [cursor=pointer]:\n          - radio \"nmi\" [ref=f1e17]\n          - text: nmi\n    - group \"Speed\" [ref=f1e18]:\n      - radiogroup \"Speed\" [ref=f1e20]:\n        - generic [ref=f1e21] [cursor=pointer]:\n          - radio \"m/s\" [checked] [ref=f1e22]\n          - text: m/s\n        - generic [ref=f1e23] [cursor=pointer]:\n          - radio \"ft/s\" [ref=f1e24]\n          - text: ft/s\n    - generic [ref=f1e25] [cursor=pointer]:\n      - checkbox \"Event pins\" [checked] [ref=f1e26]\n      - text: Event pins\n    - generic [ref=f1e27] [cursor=pointer]:\n      - checkbox \"Transcript ticks\" [checked] [ref=f1e28]\n      - text: Transcript ticks\n    - button \"Close channels\" [ref=f1e29] [cursor=pointer]\n  - generic [ref=f1e30]:\n    - slider \"Track loupe\" [ref=f1e31]\n    - group \"Readout\" [ref=f1e33]:\n      - paragraph [ref=f1e34]: MET +000:02:00:00\n      - paragraph [ref=f1e35]: GMT 2026-073/02:00:00\n      - paragraph [ref=f1e36]: LAT 0.00° N\n      - paragraph [ref=f1e37]: LON 180.00° E\n      - paragraph [ref=f1e38]: ALT 20.0 km\n      - paragraph [ref=f1e39]: SPD 1700 m/s\n  - generic [ref=f1e40]:\n    - generic [ref=f1e41]:\n      - generic [ref=f1e42]: Go to GMT\n      - textbox \"Go to GMT\" [ref=f1e43]:\n        - /placeholder: 2026-073/02:00:00\n        - text: 2026-073/01:55:00\n      - button \"Go\" [ref=f1e44] [cursor=pointer]\n    - generic [ref=f1e45]:\n      - button \"Play\" [ref=f1e46] [cursor=pointer]\n      - radiogroup \"Playback rate\" [ref=f1e47]:\n        - generic [ref=f1e48] [cursor=pointer]:\n          - radio \"1×\" [checked] [ref=f1e49]\n          - text: 1×\n        - generic [ref=f1e50] [cursor=pointer]:\n          - radio \"10×\" [ref=f1e51]\n          - text: 10×\n        - generic [ref=f1e52] [cursor=pointer]:\n          - radio \"60×\" [ref=f1e53]\n          - text: 60×\n    - button \"Pin event\" [ref=f1e54] [cursor=pointer]\n  - region [ref=f1e55]:\n    - heading \"Transcript\" [level=2] [ref=f1e56]\n    - generic [ref=f1e57]: Search transcript\n    - searchbox \"Search transcript\" [ref=f1e58]: perilune\n    - list \"Search results\" [ref=f1e151]:\n      - listitem [ref=f1e152]:\n        - 'button \"+000:01:59:10 KESTREL: Coming up on perilune. Altimeter should read two zero kilometres.\" [ref=f1e153] [cursor=pointer]'\n      - listitem [ref=f1e154]:\n        - 'button \"+000:02:00:00 TESSERA: Perilune. Doppler steady, all channels green.\" [active] [ref=f1e155] [cursor=pointer]'\n      - listitem [ref=f1e156]:\n        - button \"+000:02:00:00 Perilune pass\" [ref=f1e157] [cursor=pointer]\n    - status [ref=f1e59]: 3 results for \"perilune\"\n    - heading \"Speakers\" [level=3] [ref=f1e60]\n    - list \"Speakers\" [ref=f1e61]:\n      - listitem [ref=f1e62]:\n        - generic [ref=f1e63]: KESTREL\n        - generic [ref=f1e64]: \"3\"\n      - listitem [ref=f1e65]:\n        - generic [ref=f1e66]: TESSERA\n        - generic [ref=f1e67]: \"3\"\n    - list \"Transcript lines\" [ref=f1e68]:\n      - listitem [ref=f1e69]:\n        - 'button \"+000:01:00:00 KESTREL: Tessera, Kestrel. Acquisition of signal, loud and clear.\" [ref=f1e70] [cursor=pointer]'\n      - listitem [ref=f1e71]:\n        - 'button \"+000:01:20:00 TESSERA: Kestrel, Tessera. Star tracker locked, attitude nominal.\" [ref=f1e72] [cursor=pointer]'\n      - listitem [ref=f1e73]:\n        - 'button \"+000:01:59:10 KESTREL: Coming up on perilune. Altimeter should read two zero kilometres.\" [ref=f1e74] [cursor=pointer]'\n      - listitem [ref=f1e75]:\n        - 'button \"+000:02:00:00 TESSERA: Perilune. Doppler steady, all channels green.\" [ref=f1e76] [cursor=pointer]'\n      - listitem [ref=f1e77]:\n        - 'button \"+000:02:40:00 KESTREL: Two minutes to loss of signal.\" [ref=f1e78] [cursor=pointer]'\n      - listitem [ref=f1e79]:\n        - 'button \"+000:02:59:50 TESSERA: Kestrel, Tessera. See you on the next pass.\" [ref=f1e80] [cursor=pointer]'\n  - region [ref=f1e81]:\n    - heading \"Events\" [level=2] [ref=f1e82]\n    - region \"Events\" [ref=f1e83]:\n      - table \"Events\" [ref=f1e84]:\n        - rowgroup [ref=f1e85]:\n          - row [ref=f1e86]:\n            - columnheader \"MET\" [ref=f1e87]\n            - columnheader \"Title\" [ref=f1e88]\n            - columnheader \"Altitude\" [ref=f1e89]\n            - columnheader \"Speed\" [ref=f1e90]\n            - columnheader \"Note\" [ref=f1e91]\n        - rowgroup [ref=f1e92]:\n          - row [ref=f1e93]:\n            - cell \"+000:02:00:00\" [ref=f1e94]\n            - cell \"Perilune pass\" [ref=f1e95]\n            - cell \"20.0 km\" [ref=f1e96]\n            - cell \"1700 m/s\" [ref=f1e97]\n            - cell \"Check against Kestrel log sheet 14 before publishing.\" [ref=f1e98]\n    - paragraph [ref=f1e99]:\n      - link \"Download dossier\" [ref=f1e100] [cursor=pointer]:\n        - /url: /api/missions/6c75ecf7-7a5e-4105-8638-238058819bbc/dossier.pdf\n    - status [ref=f1e101]\n  - region [ref=f1e102]:\n    - heading \"Landmarks\" [level=2] [ref=f1e103]\n    - generic [ref=f1e104]:\n      - generic [ref=f1e105]: Landmark name\n      - textbox \"Landmark name\" [ref=f1e106]:\n        - /placeholder: Tessera-3 landing site\n      - generic [ref=f1e107]: Latitude\n      - textbox \"Latitude\" [ref=f1e108]:\n        - /placeholder: 12.5° S\n      - generic [ref=f1e109]: Longitude\n      - textbox \"Longitude\" [ref=f1e110]:\n        - /placeholder: 45.25° W\n      - button \"Add landmark\" [ref=f1e111] [cursor=pointer]\n    - list \"Landmarks\" [ref=f1e112]:\n      - listitem [ref=f1e138]: No landmarks\n  - region [ref=f1e114]:\n    - heading \"Reference\" [level=2] [ref=f1e115]\n    - generic [ref=f1e116]: Reference target\n    - textbox \"Reference target\" [ref=f1e117]:\n      - /placeholder: TESSERA-3\n    - button \"Set reference\" [ref=f1e118] [cursor=pointer]\n    - button \"Refresh reference\" [ref=f1e119] [cursor=pointer]\n    - paragraph [ref=f1e139]: No reference target\n  - region [ref=f1e120]:\n    - heading \"Passes\" [level=2] [ref=f1e121]\n    - generic [ref=f1e122]: Capture file\n    - button \"Capture file\" [ref=f1e123]\n    - list \"Passes\" [ref=f1e140]:\n      - listitem [ref=f1e141]:\n        - generic [ref=f1e142]: tessera3-orbit1.cap\n        - generic [ref=f1e143]: \"Parsed: 720 samples\"\n        - generic [ref=f1e144]: 53144 bytes\n        - generic [ref=f1e145]:\n          - link \"Download tessera3-orbit1.cap\" [ref=f1e146] [cursor=pointer]:\n            - /url: /api/passes/5e63c77e-983b-42e5-b940-bbf6b4e011d4/capture\n            - text: Download\n          - button \"Delete tessera3-orbit1.cap\" [ref=f1e147] [cursor=pointer]: Delete\n    - status [ref=f1e124]\n  - region [ref=f1e125]:\n    - heading \"Share\" [level=2] [ref=f1e126]\n    - generic [ref=f1e127]:\n      - generic [ref=f1e128]: Link expiry (GMT)\n      - textbox \"Link expiry (GMT)\" [ref=f1e129]:\n        - /placeholder: 2026-103/00:00:00\n      - button \"Create share link\" [ref=f1e130] [cursor=pointer]\n    - paragraph [ref=f1e131]: \"Readers now: 0\"\n    - status [ref=f1e132]\n  - region [ref=f1e133]:\n    - heading \"Subscribers\" [level=2] [ref=f1e134]\n    - generic [ref=f1e135]: Subscriber URL\n    - textbox \"Subscriber URL\" [ref=f1e136]:\n      - /placeholder: https://club.example/hooks/perilune\n    - button \"Add subscriber\" [ref=f1e137] [cursor=pointer]\n    - list \"Subscribers\" [ref=f1e148]:\n      - listitem [ref=f1e149]: No subscribers"
}
```

### Tool call: browser_take_screenshot
- Args
```json
{
  "type": "png",
  "filename": "evidence/desktop-transcript-click.png",
  "fullPage": false,
  "scale": "css"
}
```
- Result
```json
{
  "result": "- [Screenshot of viewport](evidence/desktop-transcript-click.png)"
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
  "snapshot": "- generic [active] [ref=f2e1]:\n  - generic [ref=f2e2]:\n    - paragraph [ref=f2e3]: +000:01:00:00\n    - button \"Channels\" [ref=f2e4] [cursor=pointer]\n  - main [ref=f2e5]:\n    - generic [ref=f2e6]:\n      - heading \"Tessera-3\" [level=1] [ref=f2e7]\n      - paragraph [ref=f2e8]: Epoch 2026-073/00:00:00\n      - paragraph [ref=f2e9]: Perilune 20.0 km at +000:02:00:00\n    - paragraph [ref=f2e11]: +000:01:00:00\n    - generic [ref=f2e12]:\n      - slider \"Track loupe\" [ref=f2e13]\n      - group \"Readout\" [ref=f2e15]:\n        - paragraph [ref=f2e16]: MET +000:01:00:00\n        - paragraph [ref=f2e17]: GMT 2026-073/01:00:00\n        - paragraph [ref=f2e18]: LAT 0.00° N\n        - paragraph [ref=f2e19]: LON 0.00° E\n        - paragraph [ref=f2e20]: ALT 100.0 km\n        - paragraph [ref=f2e21]: SPD 1600 m/s\n    - generic [ref=f2e22]:\n      - generic [ref=f2e23]:\n        - generic [ref=f2e24]: Go to GMT\n        - textbox \"Go to GMT\" [ref=f2e25]:\n          - /placeholder: 2026-073/02:00:00\n        - button \"Go\" [ref=f2e26] [cursor=pointer]\n      - generic [ref=f2e27]:\n        - button \"Play\" [ref=f2e28] [cursor=pointer]\n        - radiogroup \"Playback rate\" [ref=f2e29]:\n          - generic [ref=f2e30] [cursor=pointer]:\n            - radio \"1×\" [checked] [ref=f2e31]\n            - text: 1×\n          - generic [ref=f2e32] [cursor=pointer]:\n            - radio \"10×\" [ref=f2e33]\n            - text: 10×\n          - generic [ref=f2e34] [cursor=pointer]:\n            - radio \"60×\" [ref=f2e35]\n            - text: 60×\n      - button \"Pin event\" [ref=f2e36] [cursor=pointer]\n    - region [ref=f2e37]:\n      - heading \"Transcript\" [level=2] [ref=f2e38]\n      - generic [ref=f2e39]: Search transcript\n      - searchbox \"Search transcript\" [ref=f2e40]\n      - list \"Search results\"\n      - status [ref=f2e41]\n      - heading \"Speakers\" [level=3] [ref=f2e42]\n      - list \"Speakers\" [ref=f2e43]:\n        - listitem [ref=f2e44]:\n          - generic [ref=f2e45]: KESTREL\n          - generic [ref=f2e46]: \"3\"\n        - listitem [ref=f2e47]:\n          - generic [ref=f2e48]: TESSERA\n          - generic [ref=f2e49]: \"3\"\n      - list \"Transcript lines\" [ref=f2e50]:\n        - listitem [ref=f2e51]:\n          - 'button \"+000:01:00:00 KESTREL: Tessera, Kestrel. Acquisition of signal, loud and clear.\" [ref=f2e52] [cursor=pointer]'\n        - listitem [ref=f2e53]:\n          - 'button \"+000:01:20:00 TESSERA: Kestrel, Tessera. Star tracker locked, attitude nominal.\" [ref=f2e54] [cursor=pointer]'\n        - listitem [ref=f2e55]:\n          - 'button \"+000:01:59:10 KESTREL: Coming up on perilune. Altimeter should read two zero kilometres.\" [ref=f2e56] [cursor=pointer]'\n        - listitem [ref=f2e57]:\n          - 'button \"+000:02:00:00 TESSERA: Perilune. Doppler steady, all channels green.\" [ref=f2e58] [cursor=pointer]'\n        - listitem [ref=f2e59]:\n          - 'button \"+000:02:40:00 KESTREL: Two minutes to loss of signal.\" [ref=f2e60] [cursor=pointer]'\n        - listitem [ref=f2e61]:\n          - 'button \"+000:02:59:50 TESSERA: Kestrel, Tessera. See you on the next pass.\" [ref=f2e62] [cursor=pointer]'\n    - region [ref=f2e63]:\n      - heading \"Events\" [level=2] [ref=f2e64]\n      - region \"Events\" [ref=f2e65]:\n        - table \"Events\" [ref=f2e66]:\n          - rowgroup [ref=f2e67]:\n            - row [ref=f2e68]:\n              - columnheader \"MET\" [ref=f2e69]\n              - columnheader \"Title\" [ref=f2e70]\n              - columnheader \"Altitude\" [ref=f2e71]\n              - columnheader \"Speed\" [ref=f2e72]\n              - columnheader \"Note\" [ref=f2e73]\n          - rowgroup [ref=f2e74]:\n            - row [ref=f2e75]:\n              - cell \"+000:02:00:00\" [ref=f2e76]\n              - cell \"Perilune pass\" [ref=f2e77]\n              - cell \"20.0 km\" [ref=f2e78]\n              - cell \"1700 m/s\" [ref=f2e79]\n              - cell \"Check against Kestrel log sheet 14 before publishing.\" [ref=f2e80]\n      - paragraph [ref=f2e81]:\n        - link \"Download dossier\" [ref=f2e82] [cursor=pointer]:\n          - /url: /api/missions/6c75ecf7-7a5e-4105-8638-238058819bbc/dossier.pdf\n      - status [ref=f2e83]\n    - region [ref=f2e84]:\n      - heading \"Landmarks\" [level=2] [ref=f2e85]\n      - generic [ref=f2e86]:\n        - generic [ref=f2e87]: Landmark name\n        - textbox \"Landmark name\" [ref=f2e88]:\n          - /placeholder: Tessera-3 landing site\n        - generic [ref=f2e89]: Latitude\n        - textbox \"Latitude\" [ref=f2e90]:\n          - /placeholder: 12.5° S\n        - generic [ref=f2e91]: Longitude\n        - textbox \"Longitude\" [ref=f2e92]:\n          - /placeholder: 45.25° W\n        - button \"Add landmark\" [ref=f2e93] [cursor=pointer]\n      - list \"Landmarks\" [ref=f2e94]:\n        - listitem [ref=f2e95]: No landmarks\n    - region [ref=f2e96]:\n      - heading \"Reference\" [level=2] [ref=f2e97]\n      - generic [ref=f2e98]: Reference target\n      - textbox \"Reference target\" [ref=f2e99]:\n        - /placeholder: TESSERA-3\n      - button \"Set reference\" [ref=f2e100] [cursor=pointer]\n      - button \"Refresh reference\" [ref=f2e101] [cursor=pointer]\n      - paragraph\n    - region [ref=f2e102]:\n      - heading \"Passes\" [level=2] [ref=f2e103]\n      - generic [ref=f2e104]: Capture file\n      - button \"Capture file\" [ref=f2e105]\n      - list \"Passes\"\n      - status [ref=f2e106]\n    - region [ref=f2e107]:\n      - heading \"Share\" [level=2] [ref=f2e108]\n      - generic [ref=f2e109]:\n        - generic [ref=f2e110]: Link expiry (GMT)\n        - textbox \"Link expiry (GMT)\" [ref=f2e111]:\n          - /placeholder: 2026-103/00:00:00\n        - button \"Create share link\" [ref=f2e112] [cursor=pointer]\n      - paragraph [ref=f2e113]: \"Readers now: unknown\"\n      - status [ref=f2e114]\n    - region [ref=f2e115]:\n      - heading \"Subscribers\" [level=2] [ref=f2e116]\n      - generic [ref=f2e117]: Subscriber URL\n      - textbox \"Subscriber URL\" [ref=f2e118]:\n        - /placeholder: https://club.example/hooks/perilune\n      - button \"Add subscriber\" [ref=f2e119] [cursor=pointer]\n      - list \"Subscribers\""
}
```

### Tool call: browser_take_screenshot
- Args
```json
{
  "type": "png",
  "filename": "evidence/tablet-console.png",
  "fullPage": false,
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
  "depth": 3
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/missions/6c75ecf7-7a5e-4105-8638-238058819bbc\n- Page Title: Tessera-3",
  "inlineSnapshot": "- generic [active] [ref=f2e1]:\n  - generic [ref=f2e2]:\n    - paragraph [ref=f2e3]: +000:01:00:00\n    - button \"Channels\" [ref=f2e4] [cursor=pointer]\n  - main [ref=f2e5]:\n    - generic [ref=f2e6]:\n      - heading \"Tessera-3\" [level=1] [ref=f2e7]\n      - paragraph [ref=f2e8]: Epoch 2026-073/00:00:00\n      - paragraph [ref=f2e9]: Perilune 20.0 km at +000:02:00:00\n    - paragraph [ref=f2e11]: +000:01:00:00\n    - generic [ref=f2e12]:\n      - slider \"Track loupe\" [ref=f2e13]\n      - group \"Readout\" [ref=f2e15]\n    - generic [ref=f2e22]:\n      - generic [ref=f2e23]\n      - generic [ref=f2e27]\n      - button \"Pin event\" [ref=f2e36] [cursor=pointer]\n    - region [ref=f2e37]:\n      - heading \"Transcript\" [level=2] [ref=f2e38]\n      - generic [ref=f2e39]: Search transcript\n      - searchbox \"Search transcript\" [ref=f2e40]\n      - list \"Search results\"\n      - status [ref=f2e41]\n      - heading \"Speakers\" [level=3] [ref=f2e42]\n      - list \"Speakers\" [ref=f2e43]\n      - list \"Transcript lines\" [ref=f2e50]\n    - region [ref=f2e63]:\n      - heading \"Events\" [level=2] [ref=f2e64]\n      - region \"Events\" [ref=f2e65]\n      - paragraph [ref=f2e81]\n      - status [ref=f2e83]\n    - region [ref=f2e84]:\n      - heading \"Landmarks\" [level=2] [ref=f2e85]\n      - generic [ref=f2e86]\n      - list \"Landmarks\" [ref=f2e94]\n    - region [ref=f2e96]:\n      - heading \"Reference\" [level=2] [ref=f2e97]\n      - generic [ref=f2e98]: Reference target\n      - textbox \"Reference target\" [ref=f2e99]:\n        - /placeholder: TESSERA-3\n      - button \"Set reference\" [ref=f2e100] [cursor=pointer]\n      - button \"Refresh reference\" [ref=f2e101] [cursor=pointer]\n      - paragraph [ref=f2e121]: No reference target\n    - region [ref=f2e102]:\n      - heading \"Passes\" [level=2] [ref=f2e103]\n      - generic [ref=f2e104]: Capture file\n      - button \"Capture file\" [ref=f2e105]\n      - list \"Passes\" [ref=f2e122]\n      - status [ref=f2e106]\n    - region [ref=f2e107]:\n      - heading \"Share\" [level=2] [ref=f2e108]\n      - generic [ref=f2e109]\n      - paragraph [ref=f2e113]: \"Readers now: 0\"\n      - status [ref=f2e114]\n    - region [ref=f2e115]:\n      - heading \"Subscribers\" [level=2] [ref=f2e116]\n      - generic [ref=f2e117]: Subscriber URL\n      - textbox \"Subscriber URL\" [ref=f2e118]:\n        - /placeholder: https://club.example/hooks/perilune\n      - button \"Add subscriber\" [ref=f2e119] [cursor=pointer]\n      - list \"Subscribers\" [ref=f2e130]"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Channels",
  "target": "f2e4"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/missions/6c75ecf7-7a5e-4105-8638-238058819bbc\n- Page Title: Tessera-3",
  "snapshot": "- generic [ref=f2e1]:\n  - generic [ref=f2e2]:\n    - paragraph [ref=f2e3]: +000:01:00:00\n    - button \"Channels\" [expanded] [ref=f2e4] [cursor=pointer]\n  - main [ref=f2e5]:\n    - generic [ref=f2e6]:\n      - heading \"Tessera-3\" [level=1] [ref=f2e7]\n      - paragraph [ref=f2e8]: Epoch 2026-073/00:00:00\n      - paragraph [ref=f2e9]: Perilune 20.0 km at +000:02:00:00\n    - paragraph [ref=f2e11]: +000:01:00:00\n    - dialog \"Channels\" [ref=f2e132]:\n      - heading \"Channels\" [level=2] [ref=f2e133]\n      - group \"Distance\" [ref=f2e134]:\n        - radiogroup \"Distance\" [ref=f2e136]:\n          - generic [ref=f2e137] [cursor=pointer]:\n            - radio \"km\" [checked] [active] [ref=f2e138]\n            - text: km\n          - generic [ref=f2e139] [cursor=pointer]:\n            - radio \"nmi\" [ref=f2e140]\n            - text: nmi\n      - group \"Speed\" [ref=f2e141]:\n        - radiogroup \"Speed\" [ref=f2e143]:\n          - generic [ref=f2e144] [cursor=pointer]:\n            - radio \"m/s\" [checked] [ref=f2e145]\n            - text: m/s\n          - generic [ref=f2e146] [cursor=pointer]:\n            - radio \"ft/s\" [ref=f2e147]\n            - text: ft/s\n      - generic [ref=f2e148] [cursor=pointer]:\n        - checkbox \"Event pins\" [checked] [ref=f2e149]\n        - text: Event pins\n      - generic [ref=f2e150] [cursor=pointer]:\n        - checkbox \"Transcript ticks\" [checked] [ref=f2e151]\n        - text: Transcript ticks\n      - button \"Close channels\" [ref=f2e152] [cursor=pointer]\n    - generic [ref=f2e12]:\n      - slider \"Track loupe\" [ref=f2e13]\n      - group \"Readout\" [ref=f2e15]:\n        - paragraph [ref=f2e16]: MET +000:01:00:00\n        - paragraph [ref=f2e17]: GMT 2026-073/01:00:00\n        - paragraph [ref=f2e18]: LAT 0.00° N\n        - paragraph [ref=f2e19]: LON 0.00° E\n        - paragraph [ref=f2e20]: ALT 100.0 km\n        - paragraph [ref=f2e21]: SPD 1600 m/s\n    - generic [ref=f2e22]:\n      - generic [ref=f2e23]:\n        - generic [ref=f2e24]: Go to GMT\n        - textbox \"Go to GMT\" [ref=f2e25]:\n          - /placeholder: 2026-073/02:00:00\n        - button \"Go\" [ref=f2e26] [cursor=pointer]\n      - generic [ref=f2e27]:\n        - button \"Play\" [ref=f2e28] [cursor=pointer]\n        - radiogroup \"Playback rate\" [ref=f2e29]:\n          - generic [ref=f2e30] [cursor=pointer]:\n            - radio \"1×\" [checked] [ref=f2e31]\n            - text: 1×\n          - generic [ref=f2e32] [cursor=pointer]:\n            - radio \"10×\" [ref=f2e33]\n            - text: 10×\n          - generic [ref=f2e34] [cursor=pointer]:\n            - radio \"60×\" [ref=f2e35]\n            - text: 60×\n      - button \"Pin event\" [ref=f2e36] [cursor=pointer]\n    - region [ref=f2e37]:\n      - heading \"Transcript\" [level=2] [ref=f2e38]\n      - generic [ref=f2e39]: Search transcript\n      - searchbox \"Search transcript\" [ref=f2e40]\n      - list \"Search results\"\n      - status [ref=f2e41]\n      - heading \"Speakers\" [level=3] [ref=f2e42]\n      - list \"Speakers\" [ref=f2e43]:\n        - listitem [ref=f2e44]:\n          - generic [ref=f2e45]: KESTREL\n          - generic [ref=f2e46]: \"3\"\n        - listitem [ref=f2e47]:\n          - generic [ref=f2e48]: TESSERA\n          - generic [ref=f2e49]: \"3\"\n      - list \"Transcript lines\" [ref=f2e50]:\n        - listitem [ref=f2e51]:\n          - 'button \"+000:01:00:00 KESTREL: Tessera, Kestrel. Acquisition of signal, loud and clear.\" [ref=f2e52] [cursor=pointer]'\n        - listitem [ref=f2e53]:\n          - 'button \"+000:01:20:00 TESSERA: Kestrel, Tessera. Star tracker locked, attitude nominal.\" [ref=f2e54] [cursor=pointer]'\n        - listitem [ref=f2e55]:\n          - 'button \"+000:01:59:10 KESTREL: Coming up on perilune. Altimeter should read two zero kilometres.\" [ref=f2e56] [cursor=pointer]'\n        - listitem [ref=f2e57]:\n          - 'button \"+000:02:00:00 TESSERA: Perilune. Doppler steady, all channels green.\" [ref=f2e58] [cursor=pointer]'\n        - listitem [ref=f2e59]:\n          - 'button \"+000:02:40:00 KESTREL: Two minutes to loss of signal.\" [ref=f2e60] [cursor=pointer]'\n        - listitem [ref=f2e61]:\n          - 'button \"+000:02:59:50 TESSERA: Kestrel, Tessera. See you on the next pass.\" [ref=f2e62] [cursor=pointer]'\n    - region [ref=f2e63]:\n      - heading \"Events\" [level=2] [ref=f2e64]\n      - region \"Events\" [ref=f2e65]:\n        - table \"Events\" [ref=f2e66]:\n          - rowgroup [ref=f2e67]:\n            - row [ref=f2e68]:\n              - columnheader \"MET\" [ref=f2e69]\n              - columnheader \"Title\" [ref=f2e70]\n              - columnheader \"Altitude\" [ref=f2e71]\n              - columnheader \"Speed\" [ref=f2e72]\n              - columnheader \"Note\" [ref=f2e73]\n          - rowgroup [ref=f2e74]:\n            - row [ref=f2e75]:\n              - cell \"+000:02:00:00\" [ref=f2e76]\n              - cell \"Perilune pass\" [ref=f2e77]\n              - cell \"20.0 km\" [ref=f2e78]\n              - cell \"1700 m/s\" [ref=f2e79]\n              - cell \"Check against Kestrel log sheet 14 before publishing.\" [ref=f2e80]\n      - paragraph [ref=f2e81]:\n        - link \"Download dossier\" [ref=f2e82] [cursor=pointer]:\n          - /url: /api/missions/6c75ecf7-7a5e-4105-8638-238058819bbc/dossier.pdf\n      - status [ref=f2e83]\n    - region [ref=f2e84]:\n      - heading \"Landmarks\" [level=2] [ref=f2e85]\n      - generic [ref=f2e86]:\n        - generic [ref=f2e87]: Landmark name\n        - textbox \"Landmark name\" [ref=f2e88]:\n          - /placeholder: Tessera-3 landing site\n        - generic [ref=f2e89]: Latitude\n        - textbox \"Latitude\" [ref=f2e90]:\n          - /placeholder: 12.5° S\n        - generic [ref=f2e91]: Longitude\n        - textbox \"Longitude\" [ref=f2e92]:\n          - /placeholder: 45.25° W\n        - button \"Add landmark\" [ref=f2e93] [cursor=pointer]\n      - list \"Landmarks\" [ref=f2e94]:\n        - listitem [ref=f2e120]: No landmarks\n    - region [ref=f2e96]:\n      - heading \"Reference\" [level=2] [ref=f2e97]\n      - generic [ref=f2e98]: Reference target\n      - textbox \"Reference target\" [ref=f2e99]:\n        - /placeholder: TESSERA-3\n      - button \"Set reference\" [ref=f2e100] [cursor=pointer]\n      - button \"Refresh reference\" [ref=f2e101] [cursor=pointer]\n      - paragraph [ref=f2e121]: No reference target\n    - region [ref=f2e102]:\n      - heading \"Passes\" [level=2] [ref=f2e103]\n      - generic [ref=f2e104]: Capture file\n      - button \"Capture file\" [ref=f2e105]\n      - list \"Passes\" [ref=f2e122]:\n        - listitem [ref=f2e123]:\n          - generic [ref=f2e124]: tessera3-orbit1.cap\n          - generic [ref=f2e125]: \"Parsed: 720 samples\"\n          - generic [ref=f2e126]: 53144 bytes\n          - generic [ref=f2e127]:\n            - link \"Download tessera3-orbit1.cap\" [ref=f2e128] [cursor=pointer]:\n              - /url: /api/passes/5e63c77e-983b-42e5-b940-bbf6b4e011d4/capture\n              - text: Download\n            - button \"Delete tessera3-orbit1.cap\" [ref=f2e129] [cursor=pointer]: Delete\n      - status [ref=f2e106]\n    - region [ref=f2e107]:\n      - heading \"Share\" [level=2] [ref=f2e108]\n      - generic [ref=f2e109]:\n        - generic [ref=f2e110]: Link expiry (GMT)\n        - textbox \"Link expiry (GMT)\" [ref=f2e111]:\n          - /placeholder: 2026-103/00:00:00\n        - button \"Create share link\" [ref=f2e112] [cursor=pointer]\n      - paragraph [ref=f2e113]: \"Readers now: 0\"\n      - status [ref=f2e114]\n    - region [ref=f2e115]:\n      - heading \"Subscribers\" [level=2] [ref=f2e116]\n      - generic [ref=f2e117]: Subscriber URL\n      - textbox \"Subscriber URL\" [ref=f2e118]:\n        - /placeholder: https://club.example/hooks/perilune\n      - button \"Add subscriber\" [ref=f2e119] [cursor=pointer]\n      - list \"Subscribers\" [ref=f2e130]:\n        - listitem [ref=f2e131]: No subscribers"
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
  "page": "- Page URL: http://127.0.0.1:4173/missions/6c75ecf7-7a5e-4105-8638-238058819bbc\n- Page Title: Tessera-3",
  "inlineSnapshot": "- generic [ref=f2e1]:\n  - generic [ref=f2e2]:\n    - paragraph [ref=f2e3]: +000:01:00:00\n    - button \"Channels\" [expanded] [ref=f2e4] [cursor=pointer]\n  - main [ref=f2e5]:\n    - generic [ref=f2e6]:\n      - heading \"Tessera-3\" [level=1] [ref=f2e7]\n      - paragraph [ref=f2e8]: Epoch 2026-073/00:00:00\n      - paragraph [ref=f2e9]: Perilune 20.0 km at +000:02:00:00\n    - paragraph [ref=f2e11]: +000:01:00:00\n    - dialog \"Channels\" [ref=f2e132]:\n      - heading \"Channels\" [level=2] [ref=f2e133]\n      - group \"Distance\" [ref=f2e134]:\n        - radiogroup \"Distance\" [ref=f2e136]\n      - group \"Speed\" [ref=f2e141]:\n        - radiogroup \"Speed\" [ref=f2e143]\n      - generic [ref=f2e148] [cursor=pointer]:\n        - checkbox \"Event pins\" [checked] [ref=f2e149]\n        - text: Event pins\n      - generic [ref=f2e150] [cursor=pointer]:\n        - checkbox \"Transcript ticks\" [checked] [ref=f2e151]\n        - text: Transcript ticks\n      - button \"Close channels\" [ref=f2e152] [cursor=pointer]\n    - generic [ref=f2e12]:\n      - slider \"Track loupe\" [ref=f2e13]\n      - group \"Readout\" [ref=f2e15]:\n        - paragraph [ref=f2e16]: MET +000:01:00:00\n        - paragraph [ref=f2e17]: GMT 2026-073/01:00:00\n        - paragraph [ref=f2e18]: LAT 0.00° N\n        - paragraph [ref=f2e19]: LON 0.00° E\n        - paragraph [ref=f2e20]: ALT 100.0 km\n        - paragraph [ref=f2e21]: SPD 1600 m/s\n    - generic [ref=f2e22]:\n      - generic [ref=f2e23]:\n        - generic [ref=f2e24]: Go to GMT\n        - textbox \"Go to GMT\" [ref=f2e25]:\n          - /placeholder: 2026-073/02:00:00\n        - button \"Go\" [ref=f2e26] [cursor=pointer]\n      - generic [ref=f2e27]:\n        - button \"Play\" [ref=f2e28] [cursor=pointer]\n        - radiogroup \"Playback rate\" [ref=f2e29]\n      - button \"Pin event\" [ref=f2e36] [cursor=pointer]\n    - region [ref=f2e37]:\n      - heading \"Transcript\" [level=2] [ref=f2e38]\n      - generic [ref=f2e39]: Search transcript\n      - searchbox \"Search transcript\" [ref=f2e40]\n      - list \"Search results\"\n      - status [ref=f2e41]\n      - heading \"Speakers\" [level=3] [ref=f2e42]\n      - list \"Speakers\" [ref=f2e43]:\n        - listitem [ref=f2e44]\n        - listitem [ref=f2e47]\n      - list \"Transcript lines\" [ref=f2e50]:\n        - listitem [ref=f2e51]\n        - listitem [ref=f2e53]\n        - listitem [ref=f2e55]\n        - listitem [ref=f2e57]\n        - listitem [ref=f2e59]\n        - listitem [ref=f2e61]\n    - region [ref=f2e63]:\n      - heading \"Events\" [level=2] [ref=f2e64]\n      - region \"Events\" [ref=f2e65]:\n        - table \"Events\" [ref=f2e66]\n      - paragraph [ref=f2e81]:\n        - link \"Download dossier\" [ref=f2e82] [cursor=pointer]:\n          - /url: /api/missions/6c75ecf7-7a5e-4105-8638-238058819bbc/dossier.pdf\n      - status [ref=f2e83]\n    - region [ref=f2e84]:\n      - heading \"Landmarks\" [level=2] [ref=f2e85]\n      - generic [ref=f2e86]:\n        - generic [ref=f2e87]: Landmark name\n        - textbox \"Landmark name\" [ref=f2e88]:\n          - /placeholder: Tessera-3 landing site\n        - generic [ref=f2e89]: Latitude\n        - textbox \"Latitude\" [ref=f2e90]:\n          - /placeholder: 12.5° S\n        - generic [ref=f2e91]: Longitude\n        - textbox \"Longitude\" [ref=f2e92]:\n          - /placeholder: 45.25° W\n        - button \"Add landmark\" [ref=f2e93] [cursor=pointer]\n      - list \"Landmarks\" [ref=f2e94]:\n        - listitem [ref=f2e120]: No landmarks\n    - region [ref=f2e96]:\n      - heading \"Reference\" [level=2] [ref=f2e97]\n      - generic [ref=f2e98]: Reference target\n      - textbox \"Reference target\" [ref=f2e99]:\n        - /placeholder: TESSERA-3\n      - button \"Set reference\" [ref=f2e100] [cursor=pointer]\n      - button \"Refresh reference\" [ref=f2e101] [cursor=pointer]\n      - paragraph [ref=f2e121]: No reference target\n    - region [ref=f2e102]:\n      - heading \"Passes\" [level=2] [ref=f2e103]\n      - generic [ref=f2e104]: Capture file\n      - button \"Capture file\" [ref=f2e105]\n      - list \"Passes\" [ref=f2e122]:\n        - listitem [ref=f2e123]\n      - status [ref=f2e106]\n    - region [ref=f2e107]:\n      - heading \"Share\" [level=2] [ref=f2e108]\n      - generic [ref=f2e109]:\n        - generic [ref=f2e110]: Link expiry (GMT)\n        - textbox \"Link expiry (GMT)\" [ref=f2e111]:\n          - /placeholder: 2026-103/00:00:00\n        - button \"Create share link\" [ref=f2e112] [cursor=pointer]\n      - paragraph [ref=f2e113]: \"Readers now: 0\"\n      - status [ref=f2e114]\n    - region [ref=f2e115]:\n      - heading \"Subscribers\" [level=2] [ref=f2e116]\n      - generic [ref=f2e117]: Subscriber URL\n      - textbox \"Subscriber URL\" [ref=f2e118]:\n        - /placeholder: https://club.example/hooks/perilune\n      - button \"Add subscriber\" [ref=f2e119] [cursor=pointer]\n      - list \"Subscribers\" [ref=f2e130]:\n        - listitem [ref=f2e131]: No subscribers"
}
```

### Tool call: browser_evaluate
- Args
```json
{
  "function": "() => {const e=document.querySelector('[role=\"dialog\"][aria-label=\"Channels\"]');return {rect:e?.getBoundingClientRect().toJSON(),viewport:{w:innerWidth,h:innerHeight}}}"
}
```
- Result
```json
{
  "result": "{\n  \"rect\": {\n    \"x\": 0,\n    \"y\": 0,\n    \"width\": 320,\n    \"height\": 1024,\n    \"top\": 0,\n    \"right\": 320,\n    \"bottom\": 1024,\n    \"left\": 0\n  },\n  \"viewport\": {\n    \"w\": 768,\n    \"h\": 1024\n  }\n}"
}
```

### Tool call: browser_take_screenshot
- Args
```json
{
  "type": "png",
  "filename": "evidence/tablet-channels.png",
  "fullPage": false,
  "scale": "css"
}
```
- Result
```json
{
  "result": "- [Screenshot of viewport](evidence/tablet-channels.png)"
}
```

### Tool call: browser_click
- Args
```json
{
  "element": "Close channels",
  "target": "f2e152"
}
```
- Result
```json
{
  "page": "- Page URL: http://127.0.0.1:4173/missions/6c75ecf7-7a5e-4105-8638-238058819bbc\n- Page Title: Tessera-3",
  "snapshot": "- generic [ref=f2e1]:\n  - generic [ref=f2e2]:\n    - paragraph [ref=f2e3]: +000:01:00:00\n    - button \"Channels\" [active] [ref=f2e4] [cursor=pointer]\n  - main [ref=f2e5]:\n    - generic [ref=f2e6]:\n      - heading \"Tessera-3\" [level=1] [ref=f2e7]\n      - paragraph [ref=f2e8]: Epoch 2026-073/00:00:00\n      - paragraph [ref=f2e9]: Perilune 20.0 km at +000:02:00:00\n    - paragraph [ref=f2e11]: +000:01:00:00\n    - generic [ref=f2e12]:\n      - slider \"Track loupe\" [ref=f2e13]\n      - group \"Readout\" [ref=f2e15]:\n        - paragraph [ref=f2e16]: MET +000:01:00:00\n        - paragraph [ref=f2e17]: GMT 2026-073/01:00:00\n        - paragraph [ref=f2e18]: LAT 0.00° N\n        - paragraph [ref=f2e19]: LON 0.00° E\n        - paragraph [ref=f2e20]: ALT 100.0 km\n        - paragraph [ref=f2e21]: SPD 1600 m/s\n    - generic [ref=f2e22]:\n      - generic [ref=f2e23]:\n        - generic [ref=f2e24]: Go to GMT\n        - textbox \"Go to GMT\" [ref=f2e25]:\n          - /placeholder: 2026-073/02:00:00\n        - button \"Go\" [ref=f2e26] [cursor=pointer]\n      - generic [ref=f2e27]:\n        - button \"Play\" [ref=f2e28] [cursor=pointer]\n        - radiogroup \"Playback rate\" [ref=f2e29]:\n          - generic [ref=f2e30] [cursor=pointer]:\n            - radio \"1×\" [checked] [ref=f2e31]\n            - text: 1×\n          - generic [ref=f2e32] [cursor=pointer]:\n            - radio \"10×\" [ref=f2e33]\n            - text: 10×\n          - generic [ref=f2e34] [cursor=pointer]:\n            - radio \"60×\" [ref=f2e35]\n            - text: 60×\n      - button \"Pin event\" [ref=f2e36] [cursor=pointer]\n    - region [ref=f2e37]:\n      - heading \"Transcript\" [level=2] [ref=f2e38]\n      - generic [ref=f2e39]: Search transcript\n      - searchbox \"Search transcript\" [ref=f2e40]\n      - list \"Search results\"\n      - status [ref=f2e41]\n      - heading \"Speakers\" [level=3] [ref=f2e42]\n      - list \"Speakers\" [ref=f2e43]:\n        - listitem [ref=f2e44]:\n          - generic [ref=f2e45]: KESTREL\n          - generic [ref=f2e46]: \"3\"\n        - listitem [ref=f2e47]:\n          - generic [ref=f2e48]: TESSERA\n          - generic [ref=f2e49]: \"3\"\n      - list \"Transcript lines\" [ref=f2e50]:\n        - listitem [ref=f2e51]:\n          - 'button \"+000:01:00:00 KESTREL: Tessera, Kestrel. Acquisition of signal, loud and clear.\" [ref=f2e52] [cursor=pointer]'\n        - listitem [ref=f2e53]:\n          - 'button \"+000:01:20:00 TESSERA: Kestrel, Tessera. Star tracker locked, attitude nominal.\" [ref=f2e54] [cursor=pointer]'\n        - listitem [ref=f2e55]:\n          - 'button \"+000:01:59:10 KESTREL: Coming up on perilune. Altimeter should read two zero kilometres.\" [ref=f2e56] [cursor=pointer]'\n        - listitem [ref=f2e57]:\n          - 'button \"+000:02:00:00 TESSERA: Perilune. Doppler steady, all channels green.\" [ref=f2e58] [cursor=pointer]'\n        - listitem [ref=f2e59]:\n          - 'button \"+000:02:40:00 KESTREL: Two minutes to loss of signal.\" [ref=f2e60] [cursor=pointer]'\n        - listitem [ref=f2e61]:\n          - 'button \"+000:02:59:50 TESSERA: Kestrel, Tessera. See you on the next pass.\" [ref=f2e62] [cursor=pointer]'\n    - region [ref=f2e63]:\n      - heading \"Events\" [level=2] [ref=f2e64]\n      - region \"Events\" [ref=f2e65]:\n        - table \"Events\" [ref=f2e66]:\n          - rowgroup [ref=f2e67]:\n            - row [ref=f2e68]:\n              - columnheader \"MET\" [ref=f2e69]\n              - columnheader \"Title\" [ref=f2e70]\n              - columnheader \"Altitude\" [ref=f2e71]\n              - columnheader \"Speed\" [ref=f2e72]\n              - columnheader \"Note\" [ref=f2e73]\n          - rowgroup [ref=f2e74]:\n            - row [ref=f2e75]:\n              - cell \"+000:02:00:00\" [ref=f2e76]\n              - cell \"Perilune pass\" [ref=f2e77]\n              - cell \"20.0 km\" [ref=f2e78]\n              - cell \"1700 m/s\" [ref=f2e79]\n              - cell \"Check against Kestrel log sheet 14 before publishing.\" [ref=f2e80]\n      - paragraph [ref=f2e81]:\n        - link \"Download dossier\" [ref=f2e82] [cursor=pointer]:\n          - /url: /api/missions/6c75ecf7-7a5e-4105-8638-238058819bbc/dossier.pdf\n      - status [ref=f2e83]\n    - region [ref=f2e84]:\n      - heading \"Landmarks\" [level=2] [ref=f2e85]\n      - generic [ref=f2e86]:\n        - generic [ref=f2e87]: Landmark name\n        - textbox \"Landmark name\" [ref=f2e88]:\n          - /placeholder: Tessera-3 landing site\n        - generic [ref=f2e89]: Latitude\n        - textbox \"Latitude\" [ref=f2e90]:\n          - /placeholder: 12.5° S\n        - generic [ref=f2e91]: Longitude\n        - textbox \"Longitude\" [ref=f2e92]:\n          - /placeholder: 45.25° W\n        - button \"Add landmark\" [ref=f2e93] [cursor=pointer]\n      - list \"Landmarks\" [ref=f2e94]:\n        - listitem [ref=f2e120]: No landmarks\n    - region [ref=f2e96]:\n      - heading \"Reference\" [level=2] [ref=f2e97]\n      - generic [ref=f2e98]: Reference target\n      - textbox \"Reference target\" [ref=f2e99]:\n        - /placeholder: TESSERA-3\n      - button \"Set reference\" [ref=f2e100] [cursor=pointer]\n      - button \"Refresh reference\" [ref=f2e101] [cursor=pointer]\n      - paragraph [ref=f2e121]: No reference target\n    - region [ref=f2e102]:\n      - heading \"Passes\" [level=2] [ref=f2e103]\n      - generic [ref=f2e104]: Capture file\n      - button \"Capture file\" [ref=f2e105]\n      - list \"Passes\" [ref=f2e122]:\n        - listitem [ref=f2e123]:\n          - generic [ref=f2e124]: tessera3-orbit1.cap\n          - generic [ref=f2e125]: \"Parsed: 720 samples\"\n          - generic [ref=f2e126]: 53144 bytes\n          - generic [ref=f2e127]:\n            - link \"Download tessera3-orbit1.cap\" [ref=f2e128] [cursor=pointer]:\n              - /url: /api/passes/5e63c77e-983b-42e5-b940-bbf6b4e011d4/capture\n              - text: Download\n            - button \"Delete tessera3-orbit1.cap\" [ref=f2e129] [cursor=pointer]: Delete\n      - status [ref=f2e106]\n    - region [ref=f2e107]:\n      - heading \"Share\" [level=2] [ref=f2e108]\n      - generic [ref=f2e109]:\n        - generic [ref=f2e110]: Link expiry (GMT)\n        - textbox \"Link expiry (GMT)\" [ref=f2e111]:\n          - /placeholder: 2026-103/00:00:00\n        - button \"Create share link\" [ref=f2e112] [cursor=pointer]\n      - paragraph [ref=f2e113]: \"Readers now: 0\"\n      - status [ref=f2e114]\n    - region [ref=f2e115]:\n      - heading \"Subscribers\" [level=2] [ref=f2e116]\n      - generic [ref=f2e117]: Subscriber URL\n      - textbox \"Subscriber URL\" [ref=f2e118]:\n        - /placeholder: https://club.example/hooks/perilune\n      - button \"Add subscriber\" [ref=f2e119] [cursor=pointer]\n      - list \"Subscribers\" [ref=f2e130]:\n        - listitem [ref=f2e131]: No subscribers"
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
  "function": "() => ({open:document.getElementById('channels-rail')?.getAttribute('data-open'),rect:document.getElementById('channels-rail')?.getBoundingClientRect().toJSON()})"
}
```
- Result
```json
{
  "result": "{\n  \"open\": \"true\",\n  \"rect\": {\n    \"x\": 0,\n    \"y\": 0,\n    \"width\": 320,\n    \"height\": 800,\n    \"top\": 0,\n    \"right\": 320,\n    \"bottom\": 800,\n    \"left\": 0\n  }\n}"
}
```
