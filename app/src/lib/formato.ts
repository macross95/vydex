// Cifras y fechas en el idioma elegido: español de Chile (1,24 GB) o inglés (1.24 GB).

import { idioma, locale, t } from "./i18n";

const cache = new Map<string, Intl.NumberFormat>();
function numero(decimales: number, n: number): string {
  const clave = `${locale()}-${decimales}`;
  let f = cache.get(clave);
  if (!f) {
    f = new Intl.NumberFormat(locale(), { minimumFractionDigits: decimales, maximumFractionDigits: decimales });
    cache.set(clave, f);
  }
  return f.format(n);
}

/** 1,24 GB · 512 MB · 840 KB */
export function bytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 1e9) return `${numero(2, n / 1e9)} GB`;
  if (n >= 1e6) return `${numero(0, n / 1e6)} MB`;
  if (n >= 1e3) return `${numero(0, n / 1e3)} KB`;
  return `${numero(0, n)} B`;
}

/** 12,4 MB/s */
export function velocidad(n: number | null | undefined): string {
  if (n == null || n <= 0) return "—";
  if (n >= 1e6) return `${numero(1, n / 1e6)} MB/s`;
  return `${numero(0, n / 1e3)} KB/s`;
}

/** 1:05:09 · 4:12 */
export function duracion(seg: number | null | undefined): string {
  if (seg == null || !Number.isFinite(seg)) return "—";
  const s = Math.round(seg);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const dd = (x: number) => String(x).padStart(2, "0");
  return h > 0 ? `${h}:${dd(m)}:${dd(r)}` : `${m}:${dd(r)}`;
}

/** "quedan 1 min 20 s" / "1 min 20 s left" */
export function restante(seg: number | null | undefined): string {
  const tx = t().tiempo;
  if (seg == null || !Number.isFinite(seg)) return tx.calculando;
  const s = Math.max(0, Math.round(seg));
  if (s < 60) return tx.segundos(s);
  const m = Math.floor(s / 60);
  if (m < 60) return tx.minutos(m, s % 60);
  return tx.horas(Math.floor(m / 60), m % 60);
}

export function porcentaje(bytesHechos: number, total: number | null): number {
  if (!total || total <= 0) return 0;
  return Math.min(100, Math.max(0, (bytesHechos / total) * 100));
}

/** Hoy, 14:32 · Ayer, 09:10 · 3 nov 2026 */
export function fecha(ms: number): string {
  const d = new Date(ms);
  const hoy = new Date();
  const ayer = new Date();
  ayer.setDate(hoy.getDate() - 1);
  const hora = d.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  if (d.toDateString() === hoy.toDateString()) return `${t().tiempo.hoy}, ${hora}`;
  if (d.toDateString() === ayer.toDateString()) return `${t().tiempo.ayer}, ${hora}`;
  return d.toLocaleDateString(locale(), { day: "numeric", month: "short", year: "numeric" });
}

/** "youtube.com/watch?v=…" para mostrar un enlace en poco espacio */
export function enlaceCorto(url: string, max = 46): string {
  const limpio = url.replace(/^https?:\/\/(www\.)?/, "");
  return limpio.length > max ? `${limpio.slice(0, max - 1)}…` : limpio;
}

/** Último tramo de una ruta: "Descargas › Vydex" / "Downloads › Vydex" */
export function carpetaCorta(ruta: string): string {
  // En español, Windows muestra estas carpetas con su nombre traducido aunque la ruta esté en inglés.
  const nombres: Record<string, string> =
    idioma() === "es" ? { Downloads: "Descargas", Music: "Música", Desktop: "Escritorio", Documents: "Documentos" } : {};
  const partes = ruta.split(/[\\/]/).filter(Boolean).map((p) => nombres[p] ?? p);
  return partes.slice(-2).join(" › ") || ruta;
}

export const nombreSitio: Record<string, string> = {
  Youtube: "YouTube",
  YoutubeTab: "YouTube",
  Vimeo: "Vimeo",
  TikTok: "TikTok",
  Twitter: "X",
  Instagram: "Instagram",
  Facebook: "Facebook",
  Twitch: "Twitch",
  TwitchVod: "Twitch",
  Dailymotion: "Dailymotion",
  Soundcloud: "SoundCloud",
  Reddit: "Reddit",
};
