// Estado global: ajustes, cola de descargas e historial. Se guarda en vydex.json (el núcleo lo
// escribe de forma atómica) o en localStorage cuando corre fuera de Tauri.
//
// La cola también se guarda: al cerrar Vydex, lo que estaba descargando o en espera vuelve en
// pausa al abrirlo, y sus archivos a medio bajar se conservan para retomarlo.

import { create } from "zustand";
import * as motor from "./motor";
import { enTauri } from "./plataforma";
import { errorLegible, esFalloDeArmado } from "./errores";
import { fijarIdioma, idiomaDelSistema, t } from "./i18n";
import { avisar } from "../componentes/Aviso";
import type {
  Ajustes,
  AudioFormato,
  CalidadPreferida,
  Contenedor,
  Descarga,
  EntradaHistorial,
  EstadoDescarga,
  PreferenciaCodec,
} from "./tipos";

const AJUSTES_BASE: Ajustes = {
  carpeta: "",
  calidad: "max",
  codec: "auto",
  contenedor: "mp4",
  audioFormato: "mp3",
  hdr: false,
  simultaneas: 3,
  subtitulos: false,
  notificar: true,
  portapapeles: true,
  configurado: false,
  idioma: "es",
};

const MAX_HISTORIAL = 1000;
export const MAX_SIMULTANEAS = 5;
let iniciado = false;

/** Fases con un proceso corriendo: ocupan un cupo de "descargas a la vez". */
export const FASES_ACTIVAS: ReadonlySet<EstadoDescarga> = new Set(["descargando", "uniendo", "convirtiendo", "finalizando"]);
/** Fases posteriores a la descarga, mientras FFmpeg arma el archivo final. */
export const FASES_PROCESANDO: ReadonlySet<EstadoDescarga> = new Set(["uniendo", "convirtiendo", "finalizando"]);
export const estaActiva = (d: Descarga) => FASES_ACTIVAS.has(d.estado);

// ---------- Lectura segura de lo guardado ----------
// vydex.json lo escribe Vydex, pero puede quedar editado a mano o venir de otra versión:
// solo se aceptan valores válidos y el resto vuelve al predeterminado.

type Crudo = Record<string, unknown>;
const esObjeto = (v: unknown): v is Crudo => !!v && typeof v === "object" && !Array.isArray(v);
const esTexto = (v: unknown): v is string => typeof v === "string";
const textoONulo = (v: unknown) => (esTexto(v) ? v : null);
const numeroONulo = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const ID_VALIDO = /^[A-Za-z0-9-]{1,64}$/;

function una<T extends string>(valor: unknown, opciones: readonly T[], base: T): T {
  return opciones.includes(valor as T) ? (valor as T) : base;
}

function sanearAjustes(crudo: unknown): Ajustes {
  const a = esObjeto(crudo) ? crudo : {};
  const si = (clave: "hdr" | "subtitulos" | "notificar" | "portapapeles" | "configurado") =>
    typeof a[clave] === "boolean" ? (a[clave] as boolean) : AJUSTES_BASE[clave];
  const simultaneas = Number(a.simultaneas);
  return {
    carpeta: esTexto(a.carpeta) ? a.carpeta : "",
    calidad: una<CalidadPreferida>(a.calidad, ["max", "2160", "1440", "1080", "720"], "max"),
    codec: una<PreferenciaCodec>(a.codec, ["auto", "av1", "vp9", "h264"], "auto"),
    contenedor: una<Contenedor>(a.contenedor, ["mp4", "mkv"], "mp4"),
    audioFormato: una<AudioFormato>(a.audioFormato, ["mp3", "m4a", "opus"], "mp3"),
    hdr: si("hdr"),
    simultaneas: Number.isInteger(simultaneas) ? Math.min(MAX_SIMULTANEAS, Math.max(1, simultaneas)) : 3,
    subtitulos: si("subtitulos"),
    notificar: si("notificar"),
    portapapeles: si("portapapeles"),
    configurado: si("configurado"),
    idioma: una(a.idioma, ["es", "en"], "es"),
  };
}

function sanearHistorial(crudo: unknown): EntradaHistorial[] {
  if (!Array.isArray(crudo)) return [];
  const vistos = new Set<string>();
  const lista: EntradaHistorial[] = [];
  for (const h of crudo) {
    if (!esObjeto(h) || !esTexto(h.id) || !esTexto(h.ruta) || !esTexto(h.titulo) || vistos.has(h.id)) continue;
    vistos.add(h.id);
    lista.push({
      id: h.id,
      url: esTexto(h.url) ? h.url : "",
      titulo: h.titulo,
      autor: textoONulo(h.autor),
      miniatura: textoONulo(h.miniatura),
      modo: h.modo === "audio" ? "audio" : "video",
      etiqueta: esTexto(h.etiqueta) ? h.etiqueta : "",
      detalle: esTexto(h.detalle) ? h.detalle : "",
      bytes: numeroONulo(h.bytes),
      ruta: h.ruta,
      fecha: numeroONulo(h.fecha) ?? 0,
    });
    if (lista.length >= MAX_HISTORIAL) break;
  }
  return lista;
}

/** La cola guardada vuelve en pausa (o con su error): nada arranca sin que la persona lo pida. */
function sanearCola(crudo: unknown): Descarga[] {
  if (!Array.isArray(crudo)) return [];
  const lista: Descarga[] = [];
  for (const d of crudo) {
    if (!esObjeto(d) || !esTexto(d.id) || !ID_VALIDO.test(d.id) || !esTexto(d.url) || !esTexto(d.titulo)) continue;
    if (d.estado === "completada" || d.estado === "cancelada") continue;
    lista.push({
      id: d.id,
      url: d.url,
      titulo: d.titulo,
      autor: textoONulo(d.autor),
      miniatura: textoONulo(d.miniatura),
      duracion: numeroONulo(d.duracion),
      modo: d.modo === "audio" ? "audio" : "video",
      etiqueta: esTexto(d.etiqueta) ? d.etiqueta : "",
      detalle: esTexto(d.detalle) ? d.detalle : "",
      formatoVideo: textoONulo(d.formatoVideo),
      formatoAudio: textoONulo(d.formatoAudio),
      contenedor: una<Contenedor>(d.contenedor, ["mp4", "mkv"], "mp4"),
      audioFormato: una<AudioFormato>(d.audioFormato, ["mp3", "m4a", "opus"], "mp3"),
      bytesEsperados: numeroONulo(d.bytesEsperados),
      estado: d.estado === "error" ? "error" : "pausada",
      bytes: numeroONulo(d.bytes) ?? 0,
      total: numeroONulo(d.total),
      velocidad: null,
      eta: null,
      error: textoONulo(d.error),
      ruta: null,
      creada: numeroONulo(d.creada) ?? Date.now(),
      sinExtras: d.sinExtras === true,
      registro: textoONulo(d.registro),
    });
  }
  return lista;
}

// ---------- Guardado ----------
type Guardable = { ajustes: Ajustes; historial: EntradaHistorial[]; cola: Descarga[] };

/** false si no se pudo leer lo guardado: así no se pisa el archivo con valores vacíos. */
let sePuedeGuardar = true;
let escribiendo = false;
let pendiente: Guardable | null = null;
let avisadoNoSeGuardo = false;

/** Escrituras en serie: nunca dos a la vez, y si llegan varias seguidas gana la última. */
async function guardar(datos: Guardable) {
  pendiente = datos;
  if (escribiendo) return;
  escribiendo = true;
  try {
    while (pendiente) {
      const actual = pendiente;
      pendiente = null;
      try {
        await motor.guardarDatos(actual);
      } catch (e) {
        if (!avisadoNoSeGuardo) {
          avisadoNoSeGuardo = true;
          avisar(t().datos.noSeGuardo(errorLegible(e)), "error");
        }
      }
    }
  } finally {
    escribiendo = false;
  }
}

async function carpetaPorDefecto(): Promise<string> {
  if (!enTauri) return "C:\\Users\\demo\\Downloads\\Vydex";
  const { downloadDir, join } = await import("@tauri-apps/api/path");
  return join(await downloadDir(), "Vydex");
}

async function notificar(titulo: string, cuerpo: string) {
  if (!enTauri || document.hasFocus()) return;
  const n = await import("@tauri-apps/plugin-notification");
  let permitido = await n.isPermissionGranted();
  if (!permitido) permitido = (await n.requestPermission()) === "granted";
  // En Linux el servidor de avisos interpreta marcado (<b>, <a href>…): el título del sitio se
  // escapa para que se vea tal cual. En Windows y macOS el aviso ya es texto plano.
  const linux = /Linux/i.test(navigator.userAgent) && !/Android/i.test(navigator.userAgent);
  const plano = (s: string) => (linux ? s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") : s);
  if (permitido) n.sendNotification({ title: plano(titulo), body: plano(cuerpo) });
}

export function nuevoId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// ---------- Tienda ----------
export type NuevaDescarga = Omit<
  Descarga,
  "id" | "estado" | "bytes" | "total" | "velocidad" | "eta" | "error" | "ruta" | "creada" | "sinExtras" | "registro"
>;

interface Estado {
  listo: boolean;
  ajustes: Ajustes;
  cola: Descarga[];
  historial: EntradaHistorial[];
  faltantes: Set<string>;
  iniciar: () => Promise<void>;
  cambiar: <K extends keyof Ajustes>(clave: K, valor: Ajustes[K]) => void;
  encolar: (d: NuevaDescarga) => void;
  pausar: (id: string) => void;
  reanudar: (id: string) => void;
  cancelar: (id: string) => void;
  borrarDelHistorial: (id: string) => void;
  revisarArchivos: () => Promise<void>;
}

export const useVydex = create<Estado>((set, get) => {
  const persistir = () => {
    const { ajustes, historial, cola, listo } = get();
    if (!listo || !sePuedeGuardar) return;
    void guardar({
      ajustes,
      historial,
      cola: cola.filter((d) => d.estado !== "completada" && d.estado !== "cancelada"),
    });
  };

  /** Cambia una descarga; se guarda solo cuando cambia su estado (no con cada avance). */
  const actualizar = (id: string, cambios: Partial<Descarga>) => {
    const previo = get().cola.find((d) => d.id === id)?.estado;
    set((s) => ({ cola: s.cola.map((d) => (d.id === id ? { ...d, ...cambios } : d)) }));
    if (cambios.estado !== undefined && cambios.estado !== previo) persistir();
  };

  const quitarDeCola = (id: string) => {
    set((s) => ({ cola: s.cola.filter((x) => x.id !== id) }));
    persistir();
  };

  /** Arranca las descargas en espera mientras haya cupo. */
  const bombear = () => {
    const { cola, ajustes } = get();
    let libres = ajustes.simultaneas - cola.filter(estaActiva).length;
    for (const d of cola) {
      if (libres <= 0) break;
      if (d.estado !== "en-cola") continue;
      libres--;
      actualizar(d.id, { estado: "descargando", error: null, velocidad: null, eta: null });
      motor
        .descargar({
          id: d.id,
          url: d.url,
          modo: d.modo,
          formatoVideo: d.formatoVideo,
          formatoAudio: d.formatoAudio,
          contenedor: d.contenedor,
          audioFormato: d.audioFormato,
          carpeta: ajustes.carpeta,
          subtitulos: ajustes.subtitulos,
          bytesEsperados: d.bytesEsperados,
          extras: !d.sinExtras,
        })
        .catch((e) => {
          // Se guarda el error en bruto; la interfaz lo traduce al idioma elegido al mostrarlo.
          actualizar(d.id, { estado: "error", error: String(e) });
          bombear();
        });
    }
  };

  return {
    listo: false,
    ajustes: AJUSTES_BASE,
    cola: [],
    historial: [],
    faltantes: new Set(),

    // React (modo estricto) llama esto dos veces: la marca síncrona evita oyentes duplicados.
    iniciar: async () => {
      if (iniciado) return;
      iniciado = true;
      let lectura: motor.Lectura = { datos: {}, copiaDanada: null };
      try {
        lectura = await motor.leerDatos();
      } catch {
        // Sin poder leer, no se guarda nada en esta sesión: el archivo queda como estaba.
        sePuedeGuardar = false;
        avisar(t().datos.noSeLeyeron, "error");
      }
      const { datos, copiaDanada } = lectura;
      const crudos = esObjeto(datos.ajustes) ? datos.ajustes : {};
      const ajustes = sanearAjustes(crudos);
      if (!ajustes.carpeta) ajustes.carpeta = await carpetaPorDefecto().catch(() => "");
      // Primera vez: el idioma elegido en el instalador o, si no hay, el del sistema.
      if (crudos.idioma !== "es" && crudos.idioma !== "en") {
        ajustes.idioma = (await motor.idiomaInstalado().catch(() => null)) ?? idiomaDelSistema();
      }
      // Vista previa del navegador: la bienvenida solo aparece con ?bienvenida; ?lang=en en inglés.
      const parametros = new URLSearchParams(window.location.search);
      const demo = !enTauri && parametros.has("demo");
      if (demo) {
        ajustes.configurado = !parametros.has("bienvenida");
        ajustes.idioma = parametros.get("lang") === "en" ? "en" : "es";
      }
      fijarIdioma(ajustes.idioma);
      const historial =
        datos.historial !== undefined ? sanearHistorial(datos.historial) : enTauri ? [] : (await import("./demo")).demoHistorial;
      const cola = sanearCola(datos.cola);
      set({ ajustes, historial, cola, listo: true });
      if (copiaDanada) avisar(t().datos.danados, "error");
      persistir();
      // Borra los restos de descargas que ya no están en la cola (las demás se pueden retomar).
      // Si no se pudo leer lo guardado, la cola real es desconocida: no se borra nada.
      if (sePuedeGuardar) void motor.limpiarTemporales(cola.map((d) => d.id)).catch(() => undefined);

      await motor.alProgresar((p) => {
        const d = get().cola.find((x) => x.id === p.id);
        if (!d || d.estado === "pausada") return;
        actualizar(p.id, {
          estado: p.fase,
          bytes: p.bytes,
          total: p.total ?? d.total,
          velocidad: p.velocidad,
          eta: p.eta,
        });
      });

      await motor.alTerminar((f) => {
        const d = get().cola.find((x) => x.id === f.id);
        if (!d) return bombear();
        if (f.estado === "completada" && f.ruta) {
          actualizar(f.id, { estado: "completada", bytes: d.total ?? d.bytes, velocidad: null, eta: 0, ruta: f.ruta });
          const entrada: EntradaHistorial = {
            id: d.id,
            url: d.url,
            titulo: d.titulo,
            autor: d.autor,
            miniatura: d.miniatura,
            modo: d.modo,
            etiqueta: d.etiqueta,
            detalle: d.detalle,
            bytes: d.total ?? d.bytesEsperados,
            ruta: f.ruta,
            fecha: Date.now(),
          };
          set((s) => ({ historial: [entrada, ...s.historial].slice(0, MAX_HISTORIAL) }));
          persistir();
          if (get().ajustes.notificar) void notificar(t().notificacion.lista, `${d.etiqueta} · ${d.titulo}`);
          // La fila terminada se queda un momento para que se vea el 100 %.
          setTimeout(() => quitarDeCola(f.id), 4000);
        } else if (f.estado === "error" && !d.sinExtras && esFalloDeArmado(f.error)) {
          // Reintento automático sin capítulos, metadatos ni subtítulos: reutiliza lo ya descargado.
          actualizar(f.id, { estado: "en-cola", sinExtras: true, error: null, registro: f.registro, velocidad: null, eta: null });
        } else if (f.estado === "error") {
          actualizar(f.id, { estado: "error", error: f.error ?? "SIN_EXPLICACION", registro: f.registro, velocidad: null, eta: null });
        } else if (f.estado === "pausada") {
          actualizar(f.id, { estado: "pausada", velocidad: null, eta: null });
        } else {
          quitarDeCola(f.id);
        }
        bombear();
      });

      // Vista previa del navegador (?demo): dos descargas de ejemplo en la cola.
      if (demo) (await import("./demo")).sembrarCola(get().encolar);
    },

    cambiar: (clave, valor) => {
      // El idioma se fija antes de redibujar, para que formato y errores ya usen el nuevo.
      if (clave === "idioma") fijarIdioma(valor as Ajustes["idioma"]);
      set((s) => ({ ajustes: { ...s.ajustes, [clave]: valor } }));
      persistir();
      if (clave === "simultaneas") bombear();
    },

    encolar: (nueva) => {
      const d: Descarga = {
        ...nueva,
        id: nuevoId(),
        estado: "en-cola",
        bytes: 0,
        total: nueva.bytesEsperados,
        velocidad: null,
        eta: null,
        error: null,
        ruta: null,
        creada: Date.now(),
        sinExtras: false,
        registro: null,
      };
      set((s) => ({ cola: [...s.cola, d] }));
      persistir();
      bombear();
    },

    pausar: (id) => {
      const d = get().cola.find((x) => x.id === id);
      if (!d) return;
      if (d.estado === "en-cola") return actualizar(id, { estado: "pausada" });
      void motor.detener(id, "pausar").catch((e) => avisar(errorLegible(e), "error"));
    },

    reanudar: (id) => {
      actualizar(id, { estado: "en-cola", error: null });
      bombear();
    },

    cancelar: (id) => {
      const d = get().cola.find((x) => x.id === id);
      if (!d) return;
      void motor.detener(id, "cancelar").catch(() => undefined);
      if (!estaActiva(d)) quitarDeCola(id);
    },

    borrarDelHistorial: (id) => {
      set((s) => ({ historial: s.historial.filter((h) => h.id !== id) }));
      persistir();
    },

    revisarArchivos: async () => {
      const { historial } = get();
      const vivos = await motor.existen(historial.map((h) => h.ruta));
      set({ faltantes: new Set(historial.filter((_, i) => !vivos[i]).map((h) => h.id)) });
    },
  };
});
