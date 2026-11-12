// Tipos compartidos con el núcleo Rust (src-tauri/src/descarga.rs y motor.rs).

export interface Formato {
  id: string;
  ext: string;
  vcodec: string | null;
  acodec: string | null;
  alto: number | null;
  ancho: number | null;
  fps: number | null;
  rango: string | null;
  bytes: number | null;
  bytesAprox: boolean;
  tbr: number | null;
  abr: number | null;
  idioma: string | null;
  preferenciaIdioma: number | null;
  protocolo?: string | null;
}

export interface InfoVideo {
  id: string;
  titulo: string;
  autor: string | null;
  duracion: number | null;
  miniatura: string | null;
  url: string;
  sitio: string;
  formatos: Formato[];
}

export type Modo = "video" | "audio";
export type Contenedor = "mp4" | "mkv";
export type AudioFormato = "mp3" | "m4a" | "opus";
export type PreferenciaCodec = "auto" | "av1" | "vp9" | "h264";
export type CalidadPreferida = "max" | "2160" | "1440" | "1080" | "720";

export type EstadoDescarga =
  | "en-cola"
  | "descargando"
  | "uniendo"
  | "convirtiendo"
  | "finalizando"
  | "pausada"
  | "error"
  | "completada"
  | "cancelada";

export interface Descarga {
  id: string;
  url: string;
  titulo: string;
  autor: string | null;
  miniatura: string | null;
  duracion: number | null;
  modo: Modo;
  /** "4K", "1080p", "MP3"… */
  etiqueta: string;
  /** "MP4 · VP9 · 60 fps" */
  detalle: string;
  formatoVideo: string | null;
  formatoAudio: string | null;
  contenedor: Contenedor;
  audioFormato: AudioFormato;
  bytesEsperados: number | null;
  estado: EstadoDescarga;
  bytes: number;
  total: number | null;
  velocidad: number | null;
  eta: number | null;
  error: string | null;
  ruta: string | null;
  creada: number;
  /** true cuando se reintenta sin capítulos, metadatos ni subtítulos incrustados */
  sinExtras: boolean;
  /** Registro completo de yt-dlp si la descarga falló */
  registro: string | null;
}

export interface EntradaHistorial {
  id: string;
  url: string;
  titulo: string;
  autor: string | null;
  miniatura: string | null;
  modo: Modo;
  etiqueta: string;
  detalle: string;
  bytes: number | null;
  ruta: string;
  fecha: number;
}

export interface Ajustes {
  carpeta: string;
  calidad: CalidadPreferida;
  codec: PreferenciaCodec;
  contenedor: Contenedor;
  audioFormato: AudioFormato;
  hdr: boolean;
  simultaneas: number;
  subtitulos: boolean;
  notificar: boolean;
  portapapeles: boolean;
  /** Instala sola cada versión nueva de Vydex publicada en GitHub */
  actualizarAuto: boolean;
  /** false hasta que la persona pasa por la bienvenida (primera vez que abre Vydex) */
  configurado: boolean;
  idioma: "es" | "en";
}

export interface EstadoMotor {
  ytdlp: string | null;
  deno: string | null;
  ffmpeg: string | null;
  /** Qué impidió preparar los motores al abrir Vydex */
  problema: string | null;
}
