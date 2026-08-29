// Copy the built plugin files into an Obsidian vault for local development.
// Usage: pnpm dev:link /path/to/vault   (or set OBSIDIAN_VAULT)
// Real copies, not symlinks: Obsidian does not reliably list symlinked plugin
// files. For continuous updates run `OBSIDIAN_VAULT=/path/to/vault pnpm dev`.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const vault = process.argv[2] ?? process.env.OBSIDIAN_VAULT;
if (!vault) {
	console.error("Usage: pnpm dev:link <vault-path>   (or set OBSIDIAN_VAULT)");
	process.exit(1);
}
if (!existsSync(resolve(vault, ".obsidian"))) {
	console.error(`Not an Obsidian vault (no .obsidian directory): ${vault}`);
	process.exit(1);
}

const repo = resolve(import.meta.dirname, "..");
const target = resolve(vault, ".obsidian", "plugins", "obtask");
mkdirSync(target, { recursive: true });

for (const file of ["main.js", "styles.css", "manifest.json"]) {
	copyFileSync(resolve(repo, file), resolve(target, file));
	console.log(`copied ${file} -> ${target}`);
}
console.log(`\nDone. Enable Obtask in Settings → Community plugins. For live rebuilds:\n  OBSIDIAN_VAULT="${vault}" pnpm dev`);
