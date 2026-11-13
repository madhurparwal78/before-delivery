# Image manifest

Every image file the app serves, with its origin and licence. All are served from this origin
under `/static/img/`. Checksums are in `assets.json`.

| File | Shown on | Origin | Licence |
|---|---|---|---|
| story-harbour-640.jpg, story-harbour-1280.jpg | `/story`, chapter 2014–2016 | Photograph "Container cranes in Tokyo Bay" by Syced, Wikimedia Commons, https://commons.wikimedia.org/wiki/File:Container_cranes_in_Tokyo_Bay.jpg (cropped and resized) | CC0-1.0 (public domain dedication) |
| story-dairy-640.jpg, story-dairy-1280.jpg | `/story`, chapter 2017–2019 | Photograph "Modern beverage bottling factory interior" by ravencrow BI, Pexels, https://www.pexels.com/photo/modern-beverage-bottling-factory-interior-38336747/ (cropped and resized) | Pexels License (free to use, no attribution required) |
| story-papermill-640.jpg, story-papermill-1280.jpg | `/story`, chapter 2020–2022 | Photograph "Kaipola paper machines 1956", author unknown, Wikimedia Commons, https://commons.wikimedia.org/wiki/File:Kaipola_paper_machines_1956.jpg (cropped and resized) | Public domain (PD-Finland50) |
| story-raildepot-640.jpg, story-raildepot-1280.jpg | `/story`, chapter 2023–2026 | Photograph "Losta classification yard 1" by Sergeev Pavel, Wikimedia Commons, https://commons.wikimedia.org/wiki/File:Losta_classification_yard_1.jpg (cropped and resized) | CC0-1.0 (public domain dedication) |
| portrait-aino.svg, portrait-mikael.svg, portrait-leena.svg, portrait-tomas.svg, portrait-iiris.svg, portrait-joonas.svg | `/contact`, directory cards | Drawn for this app as SVG (the managers are invented people, so no photograph of a real person is used) | original |
| social-preview.png | `og:image` of every reference detail page | Laid out for this app with the two shipped fonts and rendered to PNG | original |
| monogram.svg | favicon | Drawn for this app as SVG geometry | original |

Each `/story` plate also carries a 32 by 20 pixel copy of its own photograph inlined as a `data:` URI in the page (no separate file), shown softly until the lazy-loaded file arrives; it shares the origin and licence of that photograph above.
