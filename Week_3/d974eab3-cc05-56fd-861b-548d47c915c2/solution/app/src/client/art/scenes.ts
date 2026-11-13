import type { ScenarioId } from "../../shared/scenarios.js";
import { drawing } from "../dom.js";

/** Eight scenes, one per scenario id, drawn on a 640 x 400 board. ON scenes sit on paper, OFF scenes on the night ground. */
const SCENES: Record<ScenarioId, string> = {
  "on-work": `
    <rect class="fill-paper-deep" width="640" height="400"/>
    <circle class="stroke-ink" cx="96" cy="92" r="36" fill="none" stroke-width="3"/>
    <path class="stroke-ink" d="M96 92 V66 M96 92 H120" stroke-width="3" stroke-linecap="round"/>
    <rect class="fill-oxygen" opacity=".4" x="380" y="40" width="210" height="170" rx="4"/>
    <rect class="stroke-ink" x="380" y="40" width="210" height="170" rx="4" fill="none" stroke-width="3"/>
    <path class="stroke-ink" d="M485 40 V210 M380 125 H590" stroke-width="3"/>
    <path class="fill-oxygen" opacity=".28" d="M380 210 L590 210 L470 340 L220 340 Z"/>
    <rect class="fill-ink" x="40" y="318" width="560" height="16" rx="3"/>
    <rect class="fill-ink" x="70" y="334" width="14" height="50"/><rect class="fill-ink" x="556" y="334" width="14" height="50"/>
    <rect class="fill-ink" x="120" y="196" width="190" height="118" rx="8"/>
    <rect class="fill-paper" x="132" y="208" width="166" height="94" rx="3"/>
    <path class="stroke-ink" d="M146 226 H250 M146 244 H280 M146 262 H232 M146 280 H270" stroke-width="3" stroke-linecap="round" opacity=".55"/>
    <path class="fill-ink" d="M96 314 H334 L322 326 H108 Z"/>
    <rect class="fill-oxygen" opacity=".7" x="384" y="268" width="46" height="50" rx="5"/>
    <rect class="stroke-ink" x="384" y="268" width="46" height="50" rx="5" fill="none" stroke-width="3"/>
    <rect class="fill-beet" x="404" y="250" width="8" height="56" rx="2" transform="rotate(14 408 278)"/>
    <rect class="fill-paper" x="470" y="276" width="40" height="42" rx="6"/><rect class="stroke-ink" x="470" y="276" width="40" height="42" rx="6" fill="none" stroke-width="3"/>
    <path class="stroke-ink" d="M510 288 q16 6 0 22" fill="none" stroke-width="3"/>`,
  "on-sports": `
    <rect class="fill-paper-deep" width="640" height="400"/>
    <circle class="fill-beet" cx="150" cy="190" r="46" opacity=".85"/>
    <path class="fill-ink" opacity=".14" d="M0 250 L120 170 L230 240 L360 130 L500 230 L640 150 V400 H0 Z"/>
    <path class="fill-ink" opacity=".3" d="M0 300 L150 220 L290 290 L430 200 L640 290 V400 H0 Z"/>
    <path class="fill-ink" d="M0 360 C140 330 260 380 400 340 C500 312 580 330 640 316 V400 H0 Z"/>
    <path class="stroke-paper" d="M40 372 C170 340 250 372 360 334 C470 298 560 330 620 322" fill="none" stroke-width="5" stroke-dasharray="14 14" stroke-linecap="round"/>
    <path class="fill-ink" opacity=".75" d="M70 262 l14 -42 l14 42 Z M98 262 l12 -34 l12 34 Z M540 238 l12 -36 l12 36 Z"/>
    <path class="fill-ink" d="M300 330 C300 300 330 290 352 292 C372 294 392 306 424 312 C444 316 452 326 448 338 L300 338 Z"/>
    <path class="fill-paper" d="M300 338 H448 V346 H300 Z"/>
    <path class="stroke-paper" d="M330 300 L336 318 M346 298 L352 316 M362 300 L368 316" stroke-width="3" stroke-linecap="round"/>
    <rect class="fill-oxygen" x="512" y="270" width="40" height="84" rx="9"/>
    <rect class="fill-ink" x="522" y="254" width="20" height="18" rx="3"/>
    <rect class="fill-beet" x="512" y="296" width="40" height="22"/>`,
  "on-hobby": `
    <rect class="fill-paper-deep" width="640" height="400"/>
    <rect class="fill-ink" x="360" y="64" width="240" height="10" rx="2"/>
    <rect class="fill-paper" x="392" y="26" width="44" height="38" rx="6"/><rect class="stroke-ink" x="392" y="26" width="44" height="38" rx="6" fill="none" stroke-width="3"/>
    <rect class="fill-ink" x="60" y="70" width="190" height="104" rx="10"/>
    <circle class="fill-paper" cx="118" cy="122" r="30"/><circle class="stroke-ink" cx="118" cy="122" r="12" fill="none" stroke-width="3"/>
    <path class="stroke-paper" d="M170 96 H232 M170 114 H232 M170 132 H232 M170 150 H210" stroke-width="3" stroke-linecap="round"/>
    <path class="stroke-ink" d="M230 70 L270 22" stroke-width="3" stroke-linecap="round"/>
    <rect class="fill-ink" x="30" y="268" width="580" height="22" rx="3"/>
    <rect class="fill-ink" x="60" y="290" width="18" height="96"/><rect class="fill-ink" x="562" y="290" width="18" height="96"/>
    <rect class="fill-paper" x="100" y="244" width="360" height="26" rx="3"/>
    <rect class="stroke-ink" x="100" y="244" width="360" height="26" rx="3" fill="none" stroke-width="3"/>
    <path class="stroke-ink" d="M118 252 C170 248 220 258 280 252 S400 248 446 254 M118 262 C190 260 250 266 320 262 S420 262 446 264" fill="none" stroke-width="2" opacity=".4"/>
    <path class="fill-ink" d="M300 244 V222 H388 C404 222 410 232 412 244 Z"/>
    <path class="stroke-ink" d="M318 222 C318 204 346 200 350 222" fill="none" stroke-width="6" stroke-linecap="round"/>
    <path class="stroke-ink" d="M420 244 C430 228 452 230 444 214 C436 200 414 208 422 222" fill="none" stroke-width="3"/>
    <path class="stroke-ink" d="M500 244 C510 224 534 226 526 208 C518 192 494 200 504 218" fill="none" stroke-width="3"/>
    <rect class="fill-beet" x="520" y="214" width="28" height="56" rx="6"/><rect class="fill-ink" x="528" y="200" width="12" height="16" rx="2"/>`,
  "on-housework": `
    <rect class="fill-paper-deep" width="640" height="400"/>
    <path class="stroke-ink" d="M30 70 C200 120 440 120 610 66" fill="none" stroke-width="3"/>
    <path class="fill-oxygen" d="M96 92 L134 96 L140 112 L162 114 L166 138 L150 144 L152 220 L90 218 L92 146 L72 140 L78 116 L96 112 Z" opacity=".8"/>
    <path class="stroke-ink" d="M96 92 L134 96 L140 112 L162 114 L166 138 L150 144 L152 220 L90 218 L92 146 L72 140 L78 116 L96 112 Z" fill="none" stroke-width="3" stroke-linejoin="round"/>
    <rect class="fill-paper" x="226" y="112" width="92" height="132" rx="3"/>
    <path class="stroke-ink" d="M226 140 H318 M226 160 H318" stroke-width="5" opacity=".5"/>
    <rect class="stroke-ink" x="226" y="112" width="92" height="132" rx="3" fill="none" stroke-width="3"/>
    <rect class="fill-beet" x="372" y="116" width="86" height="104" rx="3" opacity=".9"/>
    <path class="fill-ink" d="M500 116 h26 v54 h-26 Z M534 114 h26 v54 h-26 Z"/>
    <path class="stroke-ink" d="M130 306 H196 L212 360 H114 Z" fill="none" stroke-width="3"/>
    <path class="fill-paper" d="M130 306 H196 L212 360 H114 Z"/>
    <path class="stroke-ink" d="M122 330 H204 M128 306 L138 360 M163 306 V360 M198 306 L188 360" stroke-width="2" opacity=".5"/>
    <path class="fill-beet" d="M138 306 C138 288 170 284 188 306 Z"/>
    <rect class="fill-ink" x="330" y="330" width="280" height="14" rx="3"/>
    <rect class="fill-oxygen" opacity=".7" x="532" y="286" width="40" height="44" rx="5"/>
    <rect class="stroke-ink" x="532" y="286" width="40" height="44" rx="5" fill="none" stroke-width="3"/>`,
  "off-break": `
    <rect class="fill-ground" width="640" height="400"/>
    <rect class="fill-raised" x="360" y="44" width="230" height="190" rx="6"/>
    <rect class="stroke-mist" x="360" y="44" width="230" height="190" rx="6" fill="none" stroke-width="3"/>
    <path class="fill-oxygen" opacity=".35" d="M370 224 V170 H400 V140 H428 V190 H456 V120 H494 V180 H530 V150 H580 V224 Z"/>
    <path class="fill-oxygen" d="M410 156h4v4h-4z M470 142h4v4h-4z M510 164h4v4h-4z M550 170h4v4h-4z"/>
    <path class="stroke-mist" d="M475 44 V234" stroke-width="3"/>
    <rect class="fill-mist" opacity=".2" x="30" y="300" width="580" height="16" rx="3"/>
    <rect class="fill-raised" x="150" y="268" width="150" height="26" rx="6"/>
    <rect class="stroke-mist" x="150" y="268" width="150" height="26" rx="6" fill="none" stroke-width="3"/>
    <circle class="fill-oxygen" opacity=".6" cx="280" cy="281" r="6"/>
    <rect class="fill-raised" x="360" y="248" width="50" height="52" rx="6"/>
    <rect class="stroke-oxygen" x="360" y="248" width="50" height="52" rx="6" fill="none" stroke-width="3"/>
    <rect class="fill-oxygen" opacity=".45" x="364" y="268" width="42" height="28" rx="3"/>
    <circle class="stroke-mist" cx="120" cy="128" r="54" fill="none" stroke-width="3"/>
    <path class="stroke-mist" d="M120 128 V92 M120 128 L148 142" stroke-width="3" stroke-linecap="round"/>
    <path class="stroke-mist" d="M120 76 v6 M120 174 v6 M64 128 h6 M170 128 h6" stroke-width="3" stroke-linecap="round" opacity=".6"/>`,
  "off-holiday": `
    <rect class="fill-ground" width="640" height="400"/>
    <circle class="fill-oxygen" opacity=".18" cx="470" cy="150" r="130"/>
    <rect class="fill-raised" x="360" y="40" width="230" height="200" rx="6"/>
    <circle class="fill-mist" opacity=".85" cx="500" cy="110" r="30"/>
    <rect class="stroke-mist" x="360" y="40" width="230" height="200" rx="6" fill="none" stroke-width="3"/>
    <path class="stroke-mist" d="M475 40 V240 M360 140 H590" stroke-width="3"/>
    <path class="fill-oxygen" opacity=".16" d="M360 240 L590 240 L500 372 L250 372 Z"/>
    <rect class="fill-raised" x="30" y="292" width="580" height="22" rx="8"/>
    <rect class="stroke-mist" x="30" y="292" width="580" height="22" rx="8" fill="none" stroke-width="3"/>
    <rect class="fill-mist" opacity=".9" x="60" y="256" width="130" height="40" rx="20"/>
    <rect class="fill-raised" x="230" y="226" width="110" height="70" rx="12"/>
    <rect class="stroke-oxygen" x="230" y="226" width="110" height="70" rx="12" fill="none" stroke-width="3"/>
    <path class="stroke-oxygen" d="M254 226 C254 202 316 202 316 226 M240 264 H330" fill="none" stroke-width="3"/>
    <rect class="fill-raised" x="400" y="262" width="110" height="30" rx="3" transform="rotate(-4 455 277)"/>
    <rect class="stroke-mist" x="400" y="262" width="110" height="30" rx="3" fill="none" stroke-width="3" transform="rotate(-4 455 277)"/>
    <circle class="stroke-oxygen" cx="440" cy="274" r="9" fill="none" stroke-width="2" transform="rotate(-4 455 277)"/>
    <path class="stroke-mist" d="M40 370 H600" opacity=".25" stroke-width="3"/>`,
  "off-relax": `
    <rect class="fill-ground" width="640" height="400"/>
    <rect class="fill-mist" opacity=".1" x="60" y="40" width="190" height="230" rx="95"/>
    <rect class="stroke-mist" x="60" y="40" width="190" height="230" rx="95" fill="none" stroke-width="3" opacity=".7"/>
    <path class="stroke-mist" d="M120 150 q20 24 40 0" fill="none" stroke-width="4" stroke-linecap="round" opacity=".55"/>
    <path class="fill-raised" d="M300 250 H590 C590 306 556 336 520 336 H370 C334 336 300 306 300 250 Z"/>
    <path class="stroke-mist" d="M290 250 H600 M300 250 C300 306 334 336 370 336 H520 C556 336 590 306 590 250" fill="none" stroke-width="3" stroke-linecap="round"/>
    <path class="fill-oxygen" opacity=".35" d="M310 262 H580 C576 292 552 314 520 314 H370 C338 314 314 292 310 262 Z"/>
    <path class="stroke-mist" d="M380 336 V360 M510 336 V360" stroke-width="5" stroke-linecap="round"/>
    <path class="stroke-oxygen" d="M360 224 C340 196 384 178 362 148 C346 124 380 108 366 84 M440 224 C420 190 466 176 444 142 M520 224 C500 198 540 182 522 150 C508 126 540 112 530 88" fill="none" stroke-width="3" stroke-linecap="round" opacity=".7"/>
    <rect class="fill-raised" x="110" y="324" width="64" height="40" rx="10"/><rect class="stroke-mist" x="110" y="324" width="64" height="40" rx="10" fill="none" stroke-width="3"/>
    <path class="stroke-mist" d="M174 336 q18 4 0 20" fill="none" stroke-width="3"/>
    <ellipse class="stroke-mist" cx="142" cy="372" rx="52" ry="8" fill="none" stroke-width="3" opacity=".6"/>`,
  "off-rest": `
    <rect class="fill-ground" width="640" height="400"/>
    <rect class="fill-raised" x="400" y="40" width="190" height="170" rx="6"/>
    <rect class="stroke-mist" x="400" y="40" width="190" height="170" rx="6" fill="none" stroke-width="3"/>
    <circle class="fill-mist" cx="500" cy="112" r="34"/><circle class="fill-raised" cx="516" cy="102" r="30"/>
    <path class="fill-oxygen" d="M430 72h4v4h-4z M552 70h4v4h-4z M458 164h4v4h-4z M560 150h4v4h-4z M424 130h4v4h-4z"/>
    <rect class="fill-raised" x="40" y="250" width="420" height="70" rx="10"/>
    <rect class="stroke-mist" x="40" y="250" width="420" height="70" rx="10" fill="none" stroke-width="3"/>
    <rect class="fill-mist" opacity=".85" x="62" y="222" width="110" height="46" rx="22"/>
    <path class="fill-oxygen" opacity=".4" d="M150 262 C200 236 300 240 350 256 C400 270 440 262 452 262 V318 H150 Z"/>
    <rect class="fill-raised" x="40" y="320" width="14" height="50"/><rect class="fill-raised" x="446" y="320" width="14" height="50"/>
    <rect class="fill-raised" x="500" y="270" width="70" height="50" rx="6"/>
    <path class="stroke-mist" d="M520 270 V240 H550 V270" fill="none" stroke-width="3"/>
    <path class="stroke-oxygen" d="M222 194 h20 l-20 22 h20 M262 160 h16 l-16 18 h16" fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`,
};

export function scene(id: ScenarioId): SVGSVGElement {
  return drawing(`<svg class="scene" viewBox="0 0 640 400" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">${SCENES[id]}</svg>`);
}
