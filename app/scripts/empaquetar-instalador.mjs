#!/usr/bin/env node
// Arma el instalador de Vydex para Windows (con el diseño del programa):
//   1. compila Vydex sin el instalador clásico (tauri build --no-bundle)
//   2. compila la interfaz del instalador (vite) y su ejecutable (app-instalador)
//   3. empaqueta vydex.exe + motores + licencias en un zip
//   4. une instalador + zip + pie en  VYDEX/instalador/Vydex_<versión>_x64-setup.exe
//   5. revisa que el instalador encuentre su paquete
//
// Requisitos: haber corrido antes `node scripts/motores.mjs windows`.
//
// Firma de código (opcional): define VYDEX_FIRMAR con el comando de firma, sin el archivo:
//   set VYDEX_FIRMAR=signtool sign /fd sha256 /tr http://timestamp.digicert.com /td sha256 /a
// Se firma vydex.exe antes de empaquetarlo y el instalador final después de unirlo. El orden
// importa: la firma del instalador queda al final del archivo y el paquete se busca justo
// antes de ella. No firmes vydex-instalador.exe por separado.

import { execFileSync, execSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "win32") {
  console.error("El instalador con diseño propio es para Windows. En macOS y Linux usa `npm run tauri build`.");
  process.exit(1);
}

const APP = join(dirname(fileURLToPath(import.meta.url)), "..");
const RAIZ = join(APP, "..");
const TARGET = join(APP, "src-tauri", "target");
const version = JSON.parse(readFileSync(join(APP, "package.json"), "utf8")).version;
const MOTORES = join(APP, "src-tauri", "resources", "bin-windows");
const FIRMAR = process.env.VYDEX_FIRMAR?.trim();

const cargo = join(homedir(), ".cargo", "bin");
if (existsSync(cargo)) process.env.PATH = `${cargo}${delimiter}${process.env.PATH}`;

function paso(texto) {
  console.log(`\n▸ ${texto}`);
}
/** npx es un .cmd y en Windows necesita la consola; sus argumentos son fijos y sin espacios. */
function npx(args) {
  execFileSync("npx", args, { cwd: APP, stdio: "inherit", shell: true });
}
/** Programas .exe: sin consola intermedia, así las rutas con espacios llegan intactas. */
function ejecutar(programa, args, cwd) {
  execFileSync(programa, args, { cwd, stdio: "inherit" });
}
function firmar(archivo) {
  if (!FIRMAR) return;
  paso(`Firmando ${basename(archivo)}`);
  execSync(`${FIRMAR} "${archivo}"`, { stdio: "inherit" });
}

if (!existsSync(join(MOTORES, "yt-dlp.exe"))) {
  console.error("Faltan los motores. Ejecuta primero: node scripts/motores.mjs windows");
  process.exit(1);
}

paso(`Compilando Vydex ${version}`);
// --locked: si Cargo.lock no coincide con los manifiestos, falla en vez de resolver otras versiones.
npx(["tauri", "build", "--no-bundle", "--", "--locked"]);

paso("Compilando la interfaz del instalador");
npx(["vite", "build", "--config", "vite.instalador.config.ts"]);

paso("Compilando el instalador");
// Comparte la carpeta target con Vydex para reutilizar lo ya compilado.
ejecutar("cargo", ["build", "--release", "--locked", "--manifest-path", join(RAIZ, "app-instalador", "Cargo.toml"), "--target-dir", TARGET], RAIZ);

paso("Empaquetando archivos");
const paquete = join(TARGET, "paquete-vydex");
rmSync(paquete, { recursive: true, force: true });
mkdirSync(paquete, { recursive: true });
cpSync(join(TARGET, "release", "vydex.exe"), join(paquete, "vydex.exe"));
firmar(join(paquete, "vydex.exe"));
cpSync(MOTORES, join(paquete, "bin"), { recursive: true });
cpSync(join(APP, "src-tauri", "resources", "licencias"), join(paquete, "licencias"), { recursive: true });

const zip = join(TARGET, "paquete-vydex.zip");
rmSync(zip, { force: true });
const tar = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
ejecutar(tar, ["-a", "-c", "-f", zip, "--options", "zip:compression-level=9", "vydex.exe", "bin", "licencias"], paquete);

paso("Uniendo instalador y paquete");
const instalador = readFileSync(join(TARGET, "release", "vydex-instalador.exe"));
const datos = readFileSync(zip);
const pie = Buffer.alloc(16);
pie.writeBigUInt64LE(BigInt(datos.length), 0);
pie.write("VYDEXPKG", 8, "ascii");

const carpetaSalida = join(RAIZ, "instalador");
mkdirSync(carpetaSalida, { recursive: true });
const salida = join(carpetaSalida, `Vydex_${version}_x64-setup.exe`);
writeFileSync(salida, Buffer.concat([instalador, datos, pie]));
firmar(salida);

paso("Verificando el instalador");
// El instalador revisa su propio paquete (también después de firmarlo) y termina sin abrirse.
const revision = spawnSync(salida, ["--verificar-paquete"], { stdio: "ignore" });
if (revision.status !== 0) {
  console.error("El instalador no encuentra su paquete. No lo publiques: revisa los pasos anteriores.");
  process.exit(1);
}

// Firma de actualización (minisign): con TAURI_SIGNING_PRIVATE_KEY definida, se crea el .sig que
// el actualizador de Vydex verifica antes de instalar esta versión.
if (process.env.TAURI_SIGNING_PRIVATE_KEY) {
  paso("Firmando la actualización");
  // --app-version ata la firma a esta versión: no sirve para hacer pasar un instalador viejo.
  npx(["tauri", "signer", "sign", "--app-version", version, `"${salida}"`]);
}

const mb = (n) => `${(n / 1e6).toFixed(1)} MB`;
console.log(`\nListo: ${salida}`);
console.log(`  instalador ${mb(instalador.length)} + paquete ${mb(datos.length)} = ${mb(statSync(salida).size)}`);
console.log(`  paquete verificado${FIRMAR ? " · firmado" : " · sin firma (define VYDEX_FIRMAR para firmar)"}`);
