// Video de referencia: imita la respuesta real de yt-dlp para un video de YouTube publicado en
// 8K con versión HDR. Lo usa la vista previa de Ajustes ("qué calidad se marcaría") y la
// demostración del navegador. Nombres y cifras son de ejemplo.

import type { Formato, InfoVideo } from "./tipos";

const DURACION = 734; // 12:14

function v(id: string, alto: number, vcodec: string, fps: number, kbps: number, rango = "SDR", ext = "mp4"): Formato {
  return {
    id, ext, vcodec, acodec: null, alto, ancho: Math.round((alto * 16) / 9), fps, rango,
    bytes: Math.round(kbps * DURACION * 125), bytesAprox: false, tbr: kbps, abr: null,
    idioma: null, preferenciaIdioma: null,
  };
}

function a(id: string, acodec: string, ext: string, kbps: number, pref = 10): Formato {
  return {
    id, ext, vcodec: null, acodec, alto: null, ancho: null, fps: null, rango: null,
    bytes: Math.round(kbps * DURACION * 125), bytesAprox: false, tbr: kbps, abr: kbps,
    idioma: "es", preferenciaIdioma: pref,
  };
}

export function videoDeReferencia(url = ""): InfoVideo {
  return {
    id: "demo8k",
    titulo: "Atacama de noche: la Vía Láctea sobre el Valle de la Luna en 8K",
    autor: "Cielo Austral",
    duracion: DURACION,
    miniatura: null,
    url,
    sitio: "Youtube",
    formatos: [
      v("571", 4320, "av01.0.17M.08", 60, 37200),
      v("337", 2160, "vp09.02.51.10.01.09.16.09.00", 60, 21600, "HDR10", "webm"),
      v("401", 2160, "av01.0.13M.08", 60, 12900),
      v("315", 2160, "vp09.00.51.08", 60, 15400, "SDR", "webm"),
      v("400", 1440, "av01.0.12M.08", 60, 6100),
      v("308", 1440, "vp09.00.50.08", 60, 7400, "SDR", "webm"),
      v("399", 1080, "av01.0.09M.08", 60, 2900),
      v("303", 1080, "vp09.00.41.08", 60, 3400, "SDR", "webm"),
      v("299", 1080, "avc1.64002a", 60, 4500),
      v("298", 720, "avc1.4d4020", 60, 2300),
      v("302", 720, "vp09.00.40.08", 60, 1900, "SDR", "webm"),
      v("135", 480, "avc1.4d401f", 30, 1100),
      v("134", 360, "avc1.4d401e", 30, 640),
      a("140", "mp4a.40.2", "m4a", 129),
      a("251", "opus", "webm", 141),
      a("251-drc", "opus", "webm", 139),
      a("249", "opus", "webm", 52),
    ],
  };
}
