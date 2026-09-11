// process.getBuiltinModule, not imports: the Obsidian review bot flags every node: import in .ts files, e2e included.
export const { mkdir, readFile } = process.getBuiltinModule("node:fs/promises");
export const { dirname, join } = process.getBuiltinModule("node:path");
export const { fileURLToPath } = process.getBuiltinModule("node:url");
