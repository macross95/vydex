// Actualización automática de Vydex desde las versiones publicadas en GitHub. El actualizador de
// Tauri descarga la versión nueva y verifica su firma con la clave pública de tauri.conf.json;
// sin una firma válida no instala nada. Se instala solo con la cola quieta, porque instalar
// cierra Vydex y lo vuelve a abrir.

import { enTauri } from "./plataforma";
import { estaActiva, useVydex } from "./tienda";
import { t } from "./i18n";
import { avisar } from "../componentes/Aviso";

const PRIMERA_REVISION_MS = 8_000;
const CADA_MS = 6 * 3600_000;
const ESPERA_COLA_MS = 30_000;

let iniciado = false;
let ocupado = false;

const colaQuieta = () => !useVydex.getState().cola.some(estaActiva);

async function esperarColaQuieta() {
  while (!colaQuieta()) await new Promise((r) => setTimeout(r, ESPERA_COLA_MS));
}

async function revisar() {
  if (ocupado || !useVydex.getState().ajustes.actualizarAuto) return;
  ocupado = true;
  let descargando = false;
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const nueva = await check();
    if (!nueva) return;
    descargando = true;
    await nueva.download();
    await esperarColaQuieta();
    avisar(t().ajustes.actualizando(nueva.version), "info");
    await nueva.install();
    // macOS y Linux: se reabre aquí. En Windows el instalador ya cerró Vydex y lo vuelve a abrir.
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
  } catch {
    // Sin conexión o sin versión nueva no se avisa; un fallo al instalar sí.
    if (descargando) avisar(t().ajustes.actualizacionFallida, "error");
  } finally {
    ocupado = false;
  }
}

export function iniciarActualizador() {
  if (!enTauri || iniciado) return;
  iniciado = true;
  setTimeout(() => void revisar(), PRIMERA_REVISION_MS);
  setInterval(() => void revisar(), CADA_MS);
}
