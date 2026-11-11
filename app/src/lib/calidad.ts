// La "escalera de calidad": una fila por resolución disponible, con el formato exacto que se
// descargará y su peso real (video + audio).

import type { AudioFormato, Contenedor, Formato, InfoVideo, PreferenciaCodec } from "./tipos";
import { t } from "./i18n";

export type FamiliaCodec = "av1" | "vp9" | "h264" | "hevc" | "otro";

export interface Peldano {
  clave: string;
  /** Lado corto del video: 2160 para 4K horizontal y para un vertical 2160×3840 */
  resolucion: number;
  etiqueta: string;
  nombre: string;
  codec: FamiliaCodec;
  fps: number;
  hdr: boolean;
  video: Formato;
  audio: Formato | null;
  bytes: number | null;
  aprox: boolean;
}

export interface OpcionAudio {
  formato: AudioFormato;
  etiqueta: string;
  detalle: string;
  fuente: Formato | null;
  bytes: number | null;
  aprox: boolean;
}

export function familia(vcodec: string | null): FamiliaCodec {
  const c = (vcodec ?? "").toLowerCase();
  if (c.startsWith("av01") || c === "av1") return "av1";
  if (c.startsWith("vp9") || c.startsWith("vp09")) return "vp9";
  if (c.startsWith("avc") || c.startsWith("h264")) return "h264";
  if (c.startsWith("hev") || c.startsWith("hvc") || c.startsWith("h265")) return "hevc";
  return "otro";
}

export const nombreCodec: Record<FamiliaCodec, string> = {
  av1: "AV1",
  vp9: "VP9",
  h264: "H.264",
  hevc: "H.265",
  otro: "Video",
};

function etiquetaResolucion(r: number): { etiqueta: string; nombre: string } {
  const e = t().escalera;
  if (r >= 4320) return { etiqueta: "8K", nombre: e.uhd };
  if (r >= 2160) return { etiqueta: "4K", nombre: e.uhd };
  if (r >= 1440) return { etiqueta: "2K", nombre: e.qhd };
  if (r >= 1080) return { etiqueta: "1080p", nombre: e.fhd };
  if (r >= 720) return { etiqueta: "720p", nombre: e.hd };
  return { etiqueta: `${r}p`, nombre: e.basica };
}

/** Orden de preferencia de códec para una resolución dada. */
function ordenCodec(pref: PreferenciaCodec, resolucion: number): FamiliaCodec[] {
  switch (pref) {
    case "av1":
      return ["av1", "vp9", "h264", "hevc", "otro"];
    case "vp9":
      return ["vp9", "av1", "h264", "hevc", "otro"];
    case "h264":
      return ["h264", "vp9", "av1", "hevc", "otro"];
    default:
      // Hasta 1080p, H.264 se reproduce en cualquier equipo. Sobre 1080p YouTube solo
      // entrega VP9 o AV1, así que se elige VP9 (decodificación más extendida).
      return resolucion <= 1080
        ? ["h264", "vp9", "av1", "hevc", "otro"]
        : ["vp9", "av1", "h264", "hevc", "otro"];
  }
}

const esHdr = (f: Formato) => !!f.rango && f.rango.toUpperCase() !== "SDR";
const soloVideo = (f: Formato) => !!f.vcodec && !f.acodec;
const ladoCorto = (f: Formato) => Math.min(f.alto ?? 0, f.ancho ?? f.alto ?? 0) || (f.alto ?? 0);

export const esAac = (f: Formato) => (f.acodec ?? "").toLowerCase().startsWith("mp4a") || f.ext === "m4a";
export const esOpus = (f: Formato) => (f.acodec ?? "").toLowerCase().startsWith("opus");
const soloAudios = (info: InfoVideo) => info.formatos.filter((f) => f.acodec && !f.vcodec);

/** Nombre del códec de una pista de audio: "AAC", "Opus"… */
export function nombreAudio(f: Formato): string {
  return esAac(f) ? "AAC" : esOpus(f) ? "Opus" : (f.acodec ?? "audio").toUpperCase();
}

/** "4K", "4K HDR"… */
export const etiquetaPeldano = (p: Peldano) => `${p.etiqueta}${p.hdr ? " HDR" : ""}`;

/**
 * La mejor pista de una lista: idioma original primero, sin compresión de rango dinámico
 * (DRC), luego la que cumpla `preferida` (el códec que calza con el contenedor) y la de más kbps.
 * Es el único criterio de Vydex para elegir audio, para video y para "solo audio".
 */
function mejorAudioDe(audios: Formato[], preferida?: (f: Formato) => boolean): Formato | null {
  const puntaje = (f: Formato) => [
    f.preferenciaIdioma ?? 0,
    f.id.includes("drc") ? 0 : 1,
    preferida?.(f) ? 1 : 0,
    f.abr ?? f.tbr ?? 0,
  ];
  return [...audios].sort((a, b) => comparar(puntaje(b), puntaje(a)))[0] ?? null;
}

/** El mejor audio para acompañar el video en el contenedor elegido (AAC en MP4, Opus en MKV). */
export function mejorAudio(info: InfoVideo, contenedor: Contenedor): Formato | null {
  return mejorAudioDe(soloAudios(info), contenedor === "mp4" ? esAac : esOpus);
}

function comparar(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

export function construirEscalera(
  info: InfoVideo,
  pref: PreferenciaCodec,
  contenedor: Contenedor,
): Peldano[] {
  const videos = info.formatos.filter((f) => f.vcodec && (f.alto ?? 0) > 0);
  const audio = mejorAudio(info, contenedor);
  const grupos = new Map<string, Formato[]>();

  for (const f of videos) {
    const clave = `${ladoCorto(f)}-${esHdr(f) ? "hdr" : "sdr"}`;
    grupos.set(clave, [...(grupos.get(clave) ?? []), f]);
  }

  const peldanos: Peldano[] = [];
  for (const [clave, lista] of grupos) {
    const resolucion = ladoCorto(lista[0]);
    const orden = ordenCodec(pref, resolucion);
    // Se prefieren pistas de solo video (se unen con el mejor audio) sobre las ya mezcladas.
    const candidatos = lista.some(soloVideo) ? lista.filter(soloVideo) : lista;
    // A igual códec se prefiere DASH (https) sobre HLS (m3u8): las pistas HLS llegan como
    // MPEG-TS con marcas de tiempo incompletas y fallan al unirse en MKV.
    const directo = (f: Formato) => (f.protocolo && f.protocolo.includes("m3u8") ? 0 : 1);
    const elegido = [...candidatos].sort((a, b) =>
      comparar(
        [-orden.indexOf(familia(b.vcodec)), directo(b), b.fps ?? 0, b.tbr ?? 0],
        [-orden.indexOf(familia(a.vcodec)), directo(a), a.fps ?? 0, a.tbr ?? 0],
      ),
    )[0];
    const conAudio = soloVideo(elegido) ? audio : null;
    const tamVideo = elegido.bytes;
    const tamAudio = conAudio?.bytes ?? 0;
    const { etiqueta, nombre } = etiquetaResolucion(resolucion);
    peldanos.push({
      clave,
      resolucion,
      etiqueta,
      nombre,
      codec: familia(elegido.vcodec),
      fps: Math.round(elegido.fps ?? 30),
      hdr: esHdr(elegido),
      video: elegido,
      audio: conAudio,
      bytes: tamVideo != null ? tamVideo + tamAudio : null,
      aprox: elegido.bytesAprox || !!conAudio?.bytesAprox,
    });
  }

  // Mayor resolución arriba; a igual resolución, SDR antes que HDR.
  return peldanos
    .filter((p) => p.resolucion >= 144)
    .sort((a, b) => b.resolucion - a.resolucion || Number(a.hdr) - Number(b.hdr));
}

/** Fila que se marca por defecto según la calidad preferida y la opción HDR. */
export function peldanoInicial(
  escalera: Peldano[],
  calidad: string,
  hdr: boolean,
): Peldano | undefined {
  const tope = calidad === "max" ? Infinity : Number(calidad);
  const aptos = escalera.filter((p) => p.resolucion <= tope && (hdr || !p.hdr));
  return aptos[0] ?? escalera[escalera.length - 1];
}

export function opcionesAudio(info: InfoVideo): OpcionAudio[] {
  const audios = soloAudios(info);
  const aac = mejorAudioDe(audios.filter(esAac));
  const opus = mejorAudioDe(audios.filter(esOpus));
  const cualquiera = mejorAudioDe(audios);
  const dur = info.duracion ?? 0;
  const kbps = (f: Formato | null) => Math.round(f?.abr ?? f?.tbr ?? 0);

  const lista: OpcionAudio[] = [
    {
      formato: "mp3",
      etiqueta: "MP3",
      detalle: t().escalera.mp3,
      fuente: opus ?? aac ?? cualquiera,
      // MP3 VBR V0 promedia unos 245 kbit/s
      bytes: dur ? Math.round(dur * 245 * 125) : null,
      aprox: true,
    },
  ];
  if (aac)
    lista.push({
      formato: "m4a",
      etiqueta: "M4A",
      detalle: t().escalera.m4a(kbps(aac)),
      fuente: aac,
      bytes: aac.bytes,
      aprox: aac.bytesAprox,
    });
  if (opus)
    lista.push({
      formato: "opus",
      etiqueta: "Opus",
      detalle: t().escalera.opus(kbps(opus)),
      fuente: opus,
      bytes: opus.bytes,
      aprox: opus.bytesAprox,
    });
  return lista;
}
