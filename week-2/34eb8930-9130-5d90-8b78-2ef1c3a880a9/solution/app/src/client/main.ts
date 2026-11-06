import "./styles.css";
import { mountEditor } from "./editor/editor.js";
import { mountHome } from "./home.js";
import { start } from "./router.js";
import { mountSignIn } from "./signin.js";
import { mountAnnouncements } from "./ui.js";

/** The first render waits (at most 1.5 s) for the four faces, so the swap from fallback type moves nothing. */
const FACES = ['600 1em "Newsreader"', 'italic 600 1em "Newsreader"', '400 1em "Source Serif 4"', 'italic 400 1em "Source Serif 4"'];
await Promise.race([Promise.all(FACES.map((f) => document.fonts.load(f))).catch(() => undefined), new Promise((done) => setTimeout(done, 1500))]);

mountAnnouncements();
start({ signIn: mountSignIn, home: (root, me) => mountHome(root, me as NonNullable<typeof me>), editor: mountEditor });
