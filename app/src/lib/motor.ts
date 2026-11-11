// Puente con el núcleo Rust: el único archivo de la interfaz que sabe si corre dentro de Tauri.
// Fuera de Tauri (vista previa en el navegador) responde con datos de demostración para poder
// revisar el diseño sin descargar nada.

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { EstadoMotor, InfoVideo } from "./tipos";
import { enTauri } from "./plataforma";

export interface Progreso {
  id: string;
  fase: "descargando" | "uniendo" | "convirtiendo" | "finalizando";
  bytes: number;
  total: number | null;
  velocidad: number | null;
  eta: number | null;
}

export interface Final {
  id: string;
  estado: "completada" | "error" | "cancelada" | "pausada";
  ruta: string | null;
  error: string | null;
  registro: string | null;
}

export interface OpcionesDescarga {
  id: string;
  url: string;
  modo: "video" | "audio";
  formatoVideo: string | null;
  formatoAudio: string | null;
  contenedor: "mp4" | "mkv";
  audioFormato: "mp3" | "m4a" | "opus";
  carpeta: string;
  subtitulos: boolean;
  bytesEsperados: number | null;
  extras: boolean;
}

/** Contenido de vydex.json. Si estaba dañado, el núcleo lo aparta y avisa con su ruta. */
export interface Lectura {
  datos: Record<string, unknown>;
  copiaDanada: string | null;
}

// ---------- Demostración ----------
const oyentesProgreso = new Set<(p: Progreso) => void>();
const oyentesFinal = new Set<(f: Final) => void>();
const simulaciones = new Map<string, number>();

function simular(o: OpcionesDescarga) {
  const total = o.bytesEsperados ?? 400e6;
  let bytes = 0;
  const paso = () => {
    const velocidad = 9e6 + Math.random() * 5e6;
    bytes = Math.min(total, bytes + velocidad * 0.5);
    oyentesProgreso.forEach((cb) =>
      cb({ id: o.id, fase: "descargando", bytes, total, velocidad, eta: (total - bytes) / velocidad }),
    );
    if (bytes >= total) {
      clearInterval(simulaciones.get(o.id));
      simulaciones.delete(o.id);
      oyentesProgreso.forEach((cb) =>
        cb({ id: o.id, fase: o.modo === "audio" ? "convirtiendo" : "uniendo", bytes, total, velocidad: null, eta: null }),
      );
      setTimeout(
        () =>
          oyentesFinal.forEach((cb) =>
            cb({ id: o.id, estado: "completada", ruta: `${o.carpeta}\\demo.${o.modo === "audio" ? o.audioFormato : o.contenedor}`, error: null, registro: null }),
          ),
        900,
      );
    }
  };
  simulaciones.set(o.id, window.setInterval(paso, 500));
}

// ---------- API ----------

export async function analizar(url: string): Promise<InfoVideo> {
  if (!enTauri) {
    await new Promise((r) => setTimeout(r, 700));
    // Los datos de demostración se cargan solo en la vista previa: no van en el programa.
    return (await import("./demo")).demoInfo(url);
  }
  return invoke<InfoVideo>("analizar", { url });
}

export async function descargar(opciones: OpcionesDescarga): Promise<void> {
  if (!enTauri) return simular(opciones);
  return invoke("descargar", { opciones });
}

export async function detener(id: string, motivo: "pausar" | "cancelar"): Promise<void> {
  if (!enTauri) {
    clearInterval(simulaciones.get(id));
    simulaciones.delete(id);
    oyentesFinal.forEach((cb) =>
      cb({ id, estado: motivo === "pausar" ? "pausada" : "cancelada", ruta: null, error: null, registro: null }),
    );
    return;
  }
  return invoke("detener", { id, motivo });
}

/** Borra los restos de descargas que ya no están en la cola (se llama al abrir Vydex). */
export async function limpiarTemporales(conservar: string[]): Promise<void> {
  if (enTauri) await invoke("limpiar_temporales", { conservar });
}

/** Revisa que se pueda escribir en una carpeta de descargas; falla con SIN_PERMISO si no. */
export async function probarCarpeta(ruta: string): Promise<void> {
  if (enTauri) await invoke("probar_carpeta", { ruta });
}

export async function abrir(ruta: string, enCarpeta: boolean): Promise<void> {
  if (!enTauri) return;
  return invoke("abrir", { ruta, enCarpeta });
}

export async function existen(rutas: string[]): Promise<boolean[]> {
  if (!enTauri) return rutas.map(() => true);
  return invoke<boolean[]>("existen", { rutas });
}

/** Ajustes, historial y cola guardados. En la vista previa, desde localStorage. */
export async function leerDatos(): Promise<Lectura> {
  if (!enTauri) {
    try {
      const datos: unknown = JSON.parse(localStorage.getItem("vydex") ?? "{}");
      return { datos: datos && typeof datos === "object" ? (datos as Record<string, unknown>) : {}, copiaDanada: null };
    } catch {
      return { datos: {}, copiaDanada: null };
    }
  }
  return invoke<Lectura>("leer_datos");
}

export async function guardarDatos(datos: object): Promise<void> {
  if (!enTauri) {
    localStorage.setItem("vydex", JSON.stringify(datos));
    return;
  }
  return invoke("guardar_datos", { datos });
}

/** Idioma elegido en el instalador, si Vydex se instaló con él. */
export async function idiomaInstalado(): Promise<"es" | "en" | null> {
  if (!enTauri) return null;
  return invoke<"es" | "en" | null>("idioma_instalado");
}

/** Abre la carpeta de licencias de los componentes de código abierto. */
export async function abrirLicencias(): Promise<void> {
  if (enTauri) await invoke("abrir_licencias");
}

export async function estadoMotor(): Promise<EstadoMotor> {
  if (!enTauri) return { ytdlp: "2026.10.26", deno: "2.9.8", ffmpeg: "n8.1.3", problema: null };
  return invoke<EstadoMotor>("estado_motor");
}

export async function actualizarMotor(): Promise<string> {
  if (!enTauri) {
    await new Promise((r) => setTimeout(r, 1200));
    return "2026.10.26";
  }
  return invoke<string>("actualizar_motor");
}

export async function alProgresar(cb: (p: Progreso) => void): Promise<UnlistenFn> {
  if (!enTauri) {
    oyentesProgreso.add(cb);
    return () => oyentesProgreso.delete(cb);
  }
  return listen<Progreso>("vydex://progreso", (e) => cb(e.payload));
}

export async function alTerminar(cb: (f: Final) => void): Promise<UnlistenFn> {
  if (!enTauri) {
    oyentesFinal.add(cb);
    return () => oyentesFinal.delete(cb);
  }
  return listen<Final>("vydex://final", (e) => cb(e.payload));
}
