// Lo que comparten el programa y el instalador sobre el entorno: si corren dentro de Tauri,
// la versión, el enlace del autor y cómo abrir enlaces web.

import { isTauri } from "@tauri-apps/api/core";

/** false en la vista previa del navegador: ahí todo responde con datos de demostración. */
export const enTauri = isTauri();

/** Versión de Vydex: viene de package.json, el único lugar donde se escribe. */
export const VERSION = __VERSION__;

export const LINKEDIN = "https://www.linkedin.com/in/felipelucero/";

export async function abrirEnlace(url: string): Promise<void> {
  if (!enTauri) {
    window.open(url, "_blank", "noopener");
    return;
  }
  const { openUrl } = await import("@tauri-apps/plugin-opener");
  await openUrl(url);
}
