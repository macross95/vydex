// Datos de demostración: solo para la vista previa en el navegador (fuera de Tauri).

import type { EntradaHistorial, InfoVideo } from "./tipos";
import type { NuevaDescarga } from "./tienda";
import { videoDeReferencia } from "./ejemplo";

/** Respuesta de "analizar" en la vista previa: siempre el video de referencia en 8K. */
export const demoInfo = (url: string): InfoVideo => videoDeReferencia(url);

const AHORA = Date.now();
const HORA = 3600e3;

export const demoHistorial: EntradaHistorial[] = [
  { id: "h1", url: "https://www.youtube.com/watch?v=demo1", titulo: "Torres del Paine en 4K: amanecer en la base de las torres", autor: "Ruta Sur", miniatura: null, modo: "video", etiqueta: "4K", detalle: "MP4 · VP9 · 60 fps", bytes: 1_412_000_000, ruta: "C:\\Users\\demo\\Downloads\\Vydex\\Torres del Paine en 4K [2160p].mp4", fecha: AHORA - 1.2 * HORA },
  { id: "h2", url: "https://www.youtube.com/watch?v=demo2", titulo: "Concierto completo en vivo, Teatro Caupolicán", autor: "Sala Matta", miniatura: null, modo: "audio", etiqueta: "M4A", detalle: "AAC original 129 kbps", bytes: 118_400_000, ruta: "C:\\Users\\demo\\Downloads\\Vydex\\Concierto completo en vivo.m4a", fecha: AHORA - 3.5 * HORA },
  { id: "h3", url: "https://vimeo.com/demo3", titulo: "Cortometraje: Marea baja (versión del director)", autor: "Puerto Frío Films", miniatura: null, modo: "video", etiqueta: "1080p", detalle: "MP4 · H.264 · 24 fps", bytes: 842_000_000, ruta: "C:\\Users\\demo\\Downloads\\Vydex\\Marea baja [1080p].mp4", fecha: AHORA - 26 * HORA },
  { id: "h4", url: "https://www.youtube.com/watch?v=demo4", titulo: "Clase 12: integrales por partes, ejercicios resueltos", autor: "Profe Matías", miniatura: null, modo: "video", etiqueta: "720p", detalle: "MP4 · H.264 · 30 fps", bytes: 214_000_000, ruta: "C:\\Users\\demo\\Downloads\\Vydex\\Clase 12 integrales [720p].mp4", fecha: AHORA - 30 * HORA },
  { id: "h5", url: "https://soundcloud.com/demo5", titulo: "Sesión de cueca urbana, grabación de ensayo", autor: "Los del Puerto", miniatura: null, modo: "audio", etiqueta: "MP3", detalle: "Máxima calidad", bytes: 22_600_000, ruta: "C:\\Users\\demo\\Downloads\\Vydex\\Sesión de cueca urbana.mp3", fecha: AHORA - 74 * HORA },
];

/** Vista previa con ?demo: dos descargas de ejemplo en la cola. */
export function sembrarCola(encolar: (d: NuevaDescarga) => void) {
  const ejemplo = {
    autor: "Cielo Austral",
    miniatura: null,
    duracion: 734,
    contenedor: "mp4" as const,
    audioFormato: "mp3" as const,
    formatoAudio: "140",
  };
  encolar({ ...ejemplo, url: "https://www.youtube.com/watch?v=demoA", titulo: "Ruta de los glaciares: Carretera Austral completa en 4K", modo: "video", etiqueta: "4K", detalle: "MP4 · VP9 · 60 fps", formatoVideo: "315", bytesEsperados: 1_420_000_000 });
  encolar({ ...ejemplo, url: "https://www.youtube.com/watch?v=demoB", titulo: "Lluvia en el bosque valdiviano, 3 horas para dormir", modo: "audio", etiqueta: "Opus", detalle: "Opus original 141 kbps", formatoVideo: null, bytesEsperados: 190_000_000 });
}
