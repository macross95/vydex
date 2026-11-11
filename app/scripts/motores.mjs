#!/usr/bin/env node
// Descarga los motores de Vydex (yt-dlp, Deno y FFmpeg) para un sistema operativo y los deja en
// src-tauri/resources/bin-<sistema>, que es lo que empaqueta el instalador.
//
// Uso:  node scripts/motores.mjs [windows | linux | macos-arm64 | macos-x64]   (sin argumento: el actual)
//       node scripts/motores.mjs --fijar     (actualiza scripts/motores.lock.json; ver abajo)
//
// Cada archivo descargado se compara con la huella SHA-256 fijada en scripts/motores.lock.json.
// Si falta la huella o no coincide, el script falla y no escribe nada: lo que se empaqueta es
// exactamente lo que se revisó y se guardó en el repositorio.
//
// --fijar elige las versiones nuevas (yt-dlp y Deno según las constantes de abajo, FFmpeg de
// BtbN la compilación con fecha más reciente) y guarda sus huellas. Cada huella se cruza entre la
// suma que publica el proveedor y la que calcula GitHub para el archivo; deben coincidir. Revisa
// el cambio en motores.lock.json antes de subirlo.

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const YTDLP = "2026.10.26";
const DENO = "v2.9.8";
const RIEDL = { "macos-arm64": "macos/arm64/1789931890_9.0.2", "macos-x64": "macos/amd64/1789931006_9.0.2" };

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const RECURSOS = join(RAIZ, "src-tauri", "resources");
const LOCK = join(RAIZ, "scripts", "motores.lock.json");
const HOSTS = new Set(["github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com", "api.github.com", "ffmpeg.martin-riedl.de"]);

const PLANES = {
  windows: { carpeta: "bin-windows", ytdlp: "yt-dlp.exe", deno: "deno-x86_64-pc-windows-msvc.zip", btbn: /^ffmpeg-n8\.1[\w.-]*-win64-lgpl-shared-8\.1\.zip$/, ext: ".exe" },
  linux: { carpeta: "bin-linux", ytdlp: "yt-dlp_linux", deno: "deno-x86_64-unknown-linux-gnu.zip", btbn: /^ffmpeg-n8\.1[\w.-]*-linux64-lgpl-8\.1\.tar\.xz$/, ext: "" },
  "macos-arm64": { carpeta: "bin-macos", ytdlp: "yt-dlp_macos", deno: "deno-aarch64-apple-darwin.zip", riedl: RIEDL["macos-arm64"], ext: "" },
  "macos-x64": { carpeta: "bin-macos", ytdlp: "yt-dlp_macos", deno: "deno-x86_64-apple-darwin.zip", riedl: RIEDL["macos-x64"], ext: "" },
};

const sha256 = (datos) => createHash("sha256").update(datos).digest("hex");

async function bajar(url, comoTexto = false) {
  const r = await fetch(url, { headers: { "User-Agent": "vydex-build" } });
  // Las redirecciones solo pueden terminar en hosts conocidos y por https.
  const final = new URL(r.url);
  if (final.protocol !== "https:" || !HOSTS.has(final.hostname)) throw new Error(`Redirección inesperada a ${final.origin}`);
  if (!r.ok) throw new Error(`HTTP ${r.status} al bajar ${url}`);
  return comoTexto ? r.text() : Buffer.from(await r.arrayBuffer());
}

/** Hash de la línea "<hash>  <nombre>" (o el único hash del texto si es un .sha256 de un archivo). */
function hashDe(texto, nombre) {
  const HASH = /\b[a-f0-9]{64}\b/i;
  const linea = texto.split(/\r?\n/).map((l) => l.trim()).find((l) => HASH.test(l) && [" ", "*", "/"].some((p) => l.endsWith(`${p}${nombre}`)));
  if (linea) return linea.match(HASH)[0].toLowerCase();
  const todos = texto.match(/\b[a-f0-9]{64}\b/gi) ?? [];
  return !nombre && todos.length === 1 ? todos[0].toLowerCase() : null;
}

// ---------- --fijar: elegir versiones y guardar huellas ----------

async function release(repo, etiqueta) {
  return JSON.parse(await bajar(`https://api.github.com/repos/${repo}/releases${etiqueta ? `/tags/${etiqueta}` : "?per_page=10"}`, true));
}

/** Huella cruzada: suma del proveedor y la de GitHub deben coincidir (si GitHub la publica). */
function cruzar(nombre, delProveedor, activo) {
  if (!delProveedor) throw new Error(`${nombre}: el proveedor no publica su SHA-256`);
  const deGithub = activo?.digest?.startsWith("sha256:") ? activo.digest.slice(7) : null;
  if (deGithub && deGithub !== delProveedor) throw new Error(`${nombre}: la suma del proveedor no coincide con la de GitHub`);
  return delProveedor;
}

async function fijar() {
  const lock = { generado: new Date().toISOString().slice(0, 10), ytdlp: { version: YTDLP, sha256: {} }, deno: { version: DENO, sha256: {} }, btbn: {}, riedl: {} };

  const rY = await release("yt-dlp/yt-dlp", YTDLP);
  const sumasY = await bajar(`https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP}/SHA2-256SUMS`, true);
  for (const nombre of new Set(Object.values(PLANES).map((p) => p.ytdlp))) {
    lock.ytdlp.sha256[nombre] = cruzar(nombre, hashDe(sumasY, nombre), rY.assets.find((a) => a.name === nombre));
  }

  const rD = await release("denoland/deno", DENO);
  for (const nombre of new Set(Object.values(PLANES).map((p) => p.deno))) {
    const suma = await bajar(`https://github.com/denoland/deno/releases/download/${DENO}/${nombre}.sha256sum`, true);
    lock.deno.sha256[nombre] = cruzar(nombre, hashDe(suma, nombre) ?? hashDe(suma, ""), rD.assets.find((a) => a.name === nombre));
  }

  // FFmpeg de BtbN: la compilación con fecha más reciente (su enlace no cambia, a diferencia de "latest").
  const lista = await release("BtbN/FFmpeg-Builds");
  const rB = lista.filter((r) => /^autobuild-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}$/.test(r.tag_name)).sort((a, b) => b.tag_name.localeCompare(a.tag_name))[0];
  if (!rB) throw new Error("BtbN: no hay compilaciones con fecha");
  const sumasB = await bajar(`https://github.com/BtbN/FFmpeg-Builds/releases/download/${rB.tag_name}/checksums.sha256`, true);
  for (const [sistema, plan] of Object.entries(PLANES).filter(([, p]) => p.btbn)) {
    const activo = rB.assets.find((a) => plan.btbn.test(a.name));
    if (!activo) throw new Error(`BtbN ${rB.tag_name}: falta el archivo para ${sistema}`);
    lock.btbn[sistema] = { etiqueta: rB.tag_name, archivo: activo.name, sha256: cruzar(activo.name, hashDe(sumasB, activo.name), activo) };
  }

  for (const [sistema, plan] of Object.entries(PLANES).filter(([, p]) => p.riedl)) {
    lock.riedl[sistema] = { ruta: plan.riedl, sha256: {} };
    for (const programa of ["ffmpeg", "ffprobe"]) {
      const suma = await bajar(`https://ffmpeg.martin-riedl.de/download/${plan.riedl}/${programa}.zip.sha256`, true);
      lock.riedl[sistema].sha256[`${programa}.zip`] = cruzar(`${programa}.zip`, hashDe(suma, ""), null);
    }
  }
  writeFileSync(LOCK, JSON.stringify(lock, null, 2) + "\n");
  console.log(`Huellas fijadas en ${LOCK}. Revisa el cambio antes de subirlo.`);
}

// ---------- Descarga normal: verificar contra lo fijado ----------

function sistemaActual() {
  if (process.platform === "win32") return "windows";
  if (process.platform === "linux") return "linux";
  if (process.platform === "darwin") return process.arch === "arm64" ? "macos-arm64" : "macos-x64";
  throw new Error(`Sistema no soportado: ${process.platform}`);
}

function verificar(datos, esperado, nombre) {
  if (!esperado) throw new Error(`${nombre}: no hay huella fijada en motores.lock.json (ejecuta node scripts/motores.mjs --fijar)`);
  const real = sha256(datos);
  if (real !== esperado) throw new Error(`${nombre}: SHA-256 no coincide con la huella fijada (${real} ≠ ${esperado})`);
  console.log(`  ✓ ${nombre} verificado`);
}

function extraer(archivo, carpeta) {
  mkdirSync(carpeta, { recursive: true });
  if (process.platform === "win32") {
    // El tar de Windows (bsdtar) abre .zip y .tar.xz. Se llama por su ruta porque el tar de Git
    // (GNU) puede ir antes en el PATH y confunde "C:" con un servidor remoto.
    execFileSync(join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe"), ["-xf", archivo, "-C", carpeta]);
  } else if (archivo.endsWith(".zip")) {
    execFileSync("unzip", ["-q", "-o", archivo, "-d", carpeta]);
  } else {
    execFileSync("tar", ["-xf", archivo, "-C", carpeta]);
  }
}

/** Busca un archivo regular por nombre; ignora enlaces simbólicos dentro del paquete descargado. */
function buscar(carpeta, filtro) {
  for (const nombre of readdirSync(carpeta)) {
    const ruta = join(carpeta, nombre);
    const info = lstatSync(ruta);
    if (info.isSymbolicLink()) continue;
    if (info.isDirectory()) {
      const hallado = buscar(ruta, filtro);
      if (hallado) return hallado;
    } else if (info.isFile() && filtro(nombre)) return ruta;
  }
  return null;
}

async function instalar(objetivo) {
  const plan = PLANES[objetivo];
  if (!plan) throw new Error(`Sistema desconocido «${objetivo}». Usa: ${Object.keys(PLANES).join(", ")}`);
  if (!existsSync(LOCK)) throw new Error("Falta scripts/motores.lock.json (ejecuta node scripts/motores.mjs --fijar)");
  const lock = JSON.parse(readFileSync(LOCK, "utf8"));
  const trabajo = mkdtempSync(join(tmpdir(), "vydex-motores-"));
  const preparado = join(trabajo, "bin");
  mkdirSync(preparado, { recursive: true });
  const guardar = (origen, nombre) => {
    copyFileSync(origen, join(preparado, nombre));
    if (plan.ext === "") chmodSync(join(preparado, nombre), 0o755);
  };
  try {
    console.log(`Motores de Vydex para ${objetivo}`);
    const y = await bajar(`https://github.com/yt-dlp/yt-dlp/releases/download/${lock.ytdlp.version}/${plan.ytdlp}`);
    verificar(y, lock.ytdlp.sha256[plan.ytdlp], plan.ytdlp);
    writeFileSync(join(trabajo, plan.ytdlp), y);
    guardar(join(trabajo, plan.ytdlp), `yt-dlp${plan.ext}`);

    const d = await bajar(`https://github.com/denoland/deno/releases/download/${lock.deno.version}/${plan.deno}`);
    verificar(d, lock.deno.sha256[plan.deno], plan.deno);
    writeFileSync(join(trabajo, plan.deno), d);
    extraer(join(trabajo, plan.deno), join(trabajo, "deno"));
    guardar(buscar(join(trabajo, "deno"), (n) => n === `deno${plan.ext}`), `deno${plan.ext}`);

    const licencias = join(RECURSOS, "licencias");
    if (plan.btbn) {
      const b = lock.btbn[objetivo];
      if (!b) throw new Error(`FFmpeg para ${objetivo}: no hay huella fijada`);
      const f = await bajar(`https://github.com/BtbN/FFmpeg-Builds/releases/download/${b.etiqueta}/${b.archivo}`);
      verificar(f, b.sha256, b.archivo);
      writeFileSync(join(trabajo, b.archivo), f);
      extraer(join(trabajo, b.archivo), join(trabajo, "ffmpeg"));
      const bin = dirname(buscar(join(trabajo, "ffmpeg"), (n) => n === `ffmpeg${plan.ext}`));
      for (const nombre of readdirSync(bin)) {
        const util = nombre === `ffmpeg${plan.ext}` || nombre === `ffprobe${plan.ext}` || nombre.endsWith(".dll");
        if (util && lstatSync(join(bin, nombre)).isFile()) guardar(join(bin, nombre), nombre);
      }
      const licencia = buscar(join(trabajo, "ffmpeg"), (n) => n === "LICENSE.txt");
      if (licencia) copyFileSync(licencia, join(licencias, "FFmpeg-LGPL.txt"));
    } else {
      const r = lock.riedl[objetivo];
      if (!r) throw new Error(`FFmpeg para ${objetivo}: no hay huella fijada`);
      for (const programa of ["ffmpeg", "ffprobe"]) {
        const z = await bajar(`https://ffmpeg.martin-riedl.de/download/${r.ruta}/${programa}.zip`);
        verificar(z, r.sha256[`${programa}.zip`], `${programa}.zip (${r.ruta})`);
        writeFileSync(join(trabajo, `${programa}.zip`), z);
        extraer(join(trabajo, `${programa}.zip`), join(trabajo, programa));
        guardar(buscar(join(trabajo, programa), (n) => n === programa), programa);
      }
      writeFileSync(join(licencias, "FFmpeg-macOS.txt"), [
        "FFmpeg para macOS: compilación de Martin Riedl (https://ffmpeg.martin-riedl.de), firmada por Apple.",
        "Incluye bibliotecas GPL (x264, x265), por lo que se distribuye bajo la GNU General Public License.",
        "Vydex lo ejecuta como programa aparte. Licencia: https://www.gnu.org/licenses/gpl-3.0.html",
        "Código fuente de FFmpeg: https://ffmpeg.org/download.html",
        "",
      ].join("\n"));
    }

    // Todo verificado: recién ahora se reemplaza la carpeta de recursos.
    const destino = join(RECURSOS, plan.carpeta);
    rmSync(destino, { recursive: true, force: true });
    mkdirSync(destino, { recursive: true });
    for (const nombre of readdirSync(preparado)) copyFileSync(join(preparado, nombre), join(destino, nombre));
    const listado = readdirSync(destino).map((n) => `${n} (${(statSync(join(destino, n)).size / 1e6).toFixed(1)} MB)`);
    console.log(`Listo: ${listado.join(", ")}`);
  } finally {
    rmSync(trabajo, { recursive: true, force: true });
  }
}

try {
  if (process.argv[2] === "--fijar") await fijar();
  else await instalar(process.argv[2] ?? sistemaActual());
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
}
