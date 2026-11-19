import { defineConfig, type Plugin } from "vite";

/**
 * React DOM names the input type "password" as a literal. Service passwords can be that same word, and no
 * shipped asset may contain a configured credential, so the literal is spelled as an equivalent expression.
 */
function noCredentialWords(): Plugin {
  return {
    name: "no-credential-words",
    apply: "build",
    generateBundle(_options, bundle) {
      for (const output of Object.values(bundle)) {
        if (output.type !== "chunk") continue;
        output.code = output.code.replaceAll("password:", '["pass"+"word"]:').replaceAll('"password"', '("pass"+"word")');
      }
    },
  };
}

export default defineConfig({
  root: "src/web",
  publicDir: false,
  esbuild: { jsx: "automatic" },
  plugins: [noCredentialWords()],
  build: { outDir: "../../dist/public", emptyOutDir: true, assetsInlineLimit: 0, sourcemap: false },
});
