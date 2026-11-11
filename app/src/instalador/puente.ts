// Puente con el núcleo del instalador. Fuera de Tauri (vista previa) simula cada paso.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { enTauri, VERSION } from "../lib/plataforma";

export interface Info {
  modo: "instalar" | "desinstalar";
  version: string;
  carpeta: string;
  versionInstalada: string | null;
  idiomaInstalado: string | null;
  tamano: number;
  vydexAbierto: boolean;
  /** Problema que impide seguir, detectado al abrir (instalador dañado, Vydex no instalado). */
  error: string | null;
}

export interface Progreso {
  hecho: number;
  total: number;
  archivo: string;
}

const demo = new URLSearchParams(window.location.search);
const esperar = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function info(): Promise<Info> {
  if (!enTauri)
    return {
      modo: demo.get("modo") === "desinstalar" ? "desinstalar" : "instalar",
      version: VERSION,
      carpeta: "C:\\Users\\demo\\AppData\\Local\\Vydex",
      versionInstalada: demo.has("actualizar") ? "0.2.1" : null,
      idiomaInstalado: demo.get("lang"),
      tamano: 287_400_000,
      vydexAbierto: demo.has("abierto"),
      error: demo.get("error"),
    };
  return invoke<Info>("info");
}

export async function instalar(
  carpeta: string,
  escritorio: boolean,
  idioma: string,
  alProgresar: (p: Progreso) => void,
): Promise<void> {
  if (!enTauri) {
    const total = 287_400_000;
    const archivos = ["vydex.exe", "bin\\avcodec-62.dll", "bin\\deno.exe", "bin\\yt-dlp.exe", "licencias\\AVISOS.txt"];
    for (let paso = 1; paso <= 40; paso++) {
      await esperar(60);
      alProgresar({ hecho: (total * paso) / 40, total, archivo: archivos[Math.min(4, Math.floor(paso / 8))] });
    }
    return;
  }
  const soltar = await listen<Progreso>("instalador://progreso", (e) => alProgresar(e.payload));
  try {
    await invoke("instalar", { carpeta, escritorio, idioma });
  } finally {
    soltar();
  }
}

export async function desinstalar(borrarDatos: boolean): Promise<void> {
  if (!enTauri) return esperar(1200);
  await invoke("desinstalar", { borrarDatos });
}

/** Abre el Vydex recién instalado (el núcleo sabe en qué carpeta quedó). */
export async function abrirVydex(): Promise<void> {
  if (enTauri) await invoke("abrir_vydex");
}

export async function salir(): Promise<void> {
  if (enTauri) await invoke("salir");
}

export async function minimizar(): Promise<void> {
  if (!enTauri) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().minimize();
}

/** Abre el selector de carpeta; Vydex se instala en una subcarpeta "Vydex" propia. */
export async function elegirCarpeta(actual: string, titulo: string): Promise<string | null> {
  if (!enTauri) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const elegida = await open({ directory: true, defaultPath: actual, title: titulo });
  if (typeof elegida !== "string") return null;
  return /[\\/]vydex$/i.test(elegida) ? elegida : `${elegida.replace(/[\\/]+$/, "")}\\Vydex`;
}
