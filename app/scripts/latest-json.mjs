#!/usr/bin/env node
// Arma latest.json, el archivo que el actualizador de Vydex consulta en la última versión
// publicada. Cada plataforma apunta a su instalador y lleva su firma (.sig).
//
// Uso: node app/scripts/latest-json.mjs <carpeta con los instaladores> <versión>

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [carpeta, version] = process.argv.slice(2);
if (!carpeta || !version) {
  console.error("Uso: node latest-json.mjs <carpeta> <versión>");
  process.exit(1);
}

const base = `https://github.com/macross95/vydex/releases/download/v${version}`;
const archivos = {
  "windows-x86_64": `Vydex_${version}_x64-setup.exe`,
  "darwin-aarch64": "Vydex_aarch64.app.tar.gz",
  "darwin-x86_64": "Vydex_x64.app.tar.gz",
  "linux-x86_64": `Vydex_${version}_amd64.AppImage`,
  "linux-x86_64-appimage": `Vydex_${version}_amd64.AppImage`,
  "linux-x86_64-deb": `Vydex_${version}_amd64.deb`,
  "linux-x86_64-rpm": `Vydex-${version}-1.x86_64.rpm`,
};

const platforms = {};
for (const [plataforma, archivo] of Object.entries(archivos)) {
  const firma = join(carpeta, `${archivo}.sig`);
  if (!existsSync(join(carpeta, archivo)) || !existsSync(firma)) {
    console.error(`Falta ${archivo} o su firma .sig`);
    process.exit(1);
  }
  platforms[plataforma] = { signature: readFileSync(firma, "utf8").trim(), url: `${base}/${archivo}` };
}

writeFileSync(
  join(carpeta, "latest.json"),
  JSON.stringify({ version, notes: `Vydex ${version}`, pub_date: new Date().toISOString(), platforms }, null, 2) + "\n",
);
console.log(`latest.json: ${Object.keys(platforms).length} plataformas para la versión ${version}`);
