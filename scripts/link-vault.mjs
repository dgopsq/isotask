// Symlink the built plugin files into an Obsidian vault for local development.
// Usage: pnpm dev:link /path/to/vault   (or set OBSIDIAN_VAULT)
// Then run `pnpm dev` and reload the plugin in Obsidian after each build.
import { existsSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
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
	const link = resolve(target, file);
	rmSync(link, { force: true });
	symlinkSync(resolve(repo, file), link);
	console.log(`${link} -> ${resolve(repo, file)}`);
}
console.log("\nLinked. Run `pnpm dev`, enable Obtask in Settings → Community plugins, and reload after builds.");
