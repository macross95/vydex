// Traduce los errores (códigos del núcleo y mensajes de yt-dlp) a frases claras en el idioma
// elegido, con el paso siguiente.

import { t, type Textos } from "./i18n";

type Clave = Exclude<keyof Textos["errores"], "desconocido">;

/** Falla de FFmpeg al armar el archivo final, después de descargar todo. */
const FALLO_ARMADO = /Postprocessing|Conversion failed|Error (opening|while)|Invalid data found/i;

/** true si conviene reintentar sin capítulos, metadatos ni subtítulos incrustados. */
export const esFalloDeArmado = (texto: string | null | undefined) => FALLO_ARMADO.test(texto ?? "");

const reglas: [RegExp, Clave][] = [
  // Códigos del núcleo
  [/^PLAYLIST$/, "PLAYLIST"],
  [/^URL_INVALIDA/, "URL_INVALIDA"],
  [/^TIEMPO_AGOTADO/, "TIEMPO_AGOTADO"],
  [/^MOTOR_NO_INICIA/, "MOTOR_NO_INICIA"],
  [/^MOTOR_NO_PREPARADO/, "MOTOR_NO_PREPARADO"],
  [/^MOTOR_NO_RESPONDE/, "MOTOR_NO_RESPONDE"],
  [/^MOTOR_RESTAURADO/, "MOTOR_RESTAURADO"],
  [/^LECTURA_FALLIDA/, "LECTURA_FALLIDA"],
  [/^EN_VIVO/, "EN_VIVO"],
  [/^ID_INVALIDO/, "ID_INVALIDO"],
  [/^YA_EN_CURSO/, "YA_EN_CURSO"],
  [/^SIN_CARPETA/, "SIN_CARPETA"],
  [/^SIN_PERMISO/, "sinPermiso"],
  [/^SIN_EXPLICACION/, "SIN_EXPLICACION"],
  [/^NO_EXISTE/, "NO_EXISTE"],
  [/^NO_PERMITIDO/, "NO_PERMITIDO"],
  [/^DATOS_INVALIDOS/, "DATOS_INVALIDOS"],
  // Mensajes de yt-dlp
  [/Unsupported URL/i, "noSoportado"],
  [/Private video/i, "privado"],
  [/members-only|Join this channel/i, "miembros"],
  [/confirm your age|age-restricted|inappropriate for some users/i, "edad"],
  [/not a bot/i, "bot"],
  [/Video unavailable|This video is unavailable|has been removed/i, "noDisponible"],
  [/live event will begin|Premieres in/i, "enVivo"],
  [/HTTP Error 403|Forbidden/i, "rechazado"],
  [/HTTP Error 429|Too Many Requests/i, "limitado"],
  [/getaddrinfo|Unable to download webpage|timed out|Connection|No route/i, "sinRed"],
  [/No space left/i, "sinEspacio"],
  [/Permission denied|Access is denied/i, "sinPermiso"],
  [FALLO_ARMADO, "armado"],
  [/Requested format is not available/i, "formato"],
  // Va al final: si la actualización falló por falta de red, ya lo explicó "sinRed".
  [/^ACTUALIZACION_FALLIDA/, "ACTUALIZACION_FALLIDA"],
];

export function errorLegible(bruto: unknown): string {
  const texto = typeof bruto === "string" ? bruto : bruto instanceof Error ? bruto.message : String(bruto);
  for (const [patron, clave] of reglas) if (patron.test(texto)) return t().errores[clave];
  const detalle = `${t().errores.desconocido}: ${texto}`;
  return detalle.length > 180 ? `${detalle.slice(0, 177)}…` : detalle;
}
