// The bundled font files, where they come from and the name of each family.
export const FONTS = [
  {
    family: "Darker Grotesque",
    pkg: "@fontsource/darker-grotesque",
    files: ["darker-grotesque-latin-800-normal"],
  },
  {
    family: "Lexend",
    pkg: "@fontsource/lexend",
    files: ["lexend-latin-400-normal", "lexend-latin-600-normal"],
  },
  {
    family: "Chivo Mono",
    pkg: "@fontsource/chivo-mono",
    files: ["chivo-mono-latin-400-normal"],
  },
];

export const VENDOR_MODULES = [
  ["preact/dist/preact.module.js", "preact.mjs"],
  ["preact/hooks/dist/hooks.module.js", "hooks.mjs"],
  ["htm/dist/htm.module.js", "htm.mjs"],
];
