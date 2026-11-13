// Package static embeds the bundled assets so nothing loads from the network.
package static

import _ "embed"

//go:embed app.js
var JS []byte

//go:embed switchlamp.css
var CSS []byte

//go:embed plate-dusk.png
var PlateDusk []byte

//go:embed plate-night.png
var PlateNight []byte

//go:embed plate-mobile-dusk.png
var PlateMobileDusk []byte

//go:embed plate-mobile-night.png
var PlateMobileNight []byte

//go:embed DarkerGrotesque.ttf
var FontDarkerGrotesque []byte

//go:embed Lexend.ttf
var FontLexend []byte

//go:embed ChivoMono.ttf
var FontChivoMono []byte
