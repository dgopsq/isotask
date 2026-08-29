import fs from "node:fs";

const targetVersion = process.env.npm_package_version;

let manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
const { minAppVersion } = manifest;
manifest.version = targetVersion;
fs.writeFileSync("manifest.json", JSON.stringify(manifest, null, "\t") + "\n");

let versions = JSON.parse(fs.readFileSync("versions.json", "utf8"));
versions[targetVersion] = minAppVersion;
fs.writeFileSync("versions.json", JSON.stringify(versions, null, "\t") + "\n");
