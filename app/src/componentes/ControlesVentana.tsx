// Botones de la barra de título propia: minimizar, maximizar/restaurar y cerrar.
// En macOS no se dibujan: ahí se usan los botones nativos de colores sobre el encabezado.

import { useEffect, useState } from "react";
import { enTauri } from "../lib/plataforma";
import { useT } from "../lib/useT";

export const esMac = /Mac/i.test(navigator.userAgent);

async function ventana() {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return getCurrentWindow();
}

const trazo = { fill: "none", stroke: "currentColor", strokeWidth: 1 } as const;

function Icono({ tipo }: { tipo: "minimizar" | "maximizar" | "restaurar" | "cerrar" }) {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
      {tipo === "minimizar" && <path d="M0 5.5h10" {...trazo} />}
      {tipo === "maximizar" && <rect x="0.5" y="0.5" width="9" height="9" rx="1.5" {...trazo} />}
      {tipo === "restaurar" && (
        <>
          <rect x="0.5" y="2.5" width="7" height="7" rx="1.5" {...trazo} />
          <path d="M2.5 2.5v-.5a1.5 1.5 0 0 1 1.5-1.5h4a1.5 1.5 0 0 1 1.5 1.5v4a1.5 1.5 0 0 1-1.5 1.5h-.5" {...trazo} />
        </>
      )}
      {tipo === "cerrar" && <path d="M.5.5l9 9M9.5.5l-9 9" {...trazo} />}
    </svg>
  );
}

export default function ControlesVentana() {
  const tx = useT();
  const [maximizada, setMaximizada] = useState(false);

  useEffect(() => {
    if (!enTauri) return;
    let soltar: (() => void) | undefined;
    void (async () => {
      const v = await ventana();
      setMaximizada(await v.isMaximized());
      soltar = await v.onResized(async () => setMaximizada(await v.isMaximized()));
    })();
    return () => soltar?.();
  }, []);

  // En macOS se usan los botones nativos; en la vista previa del navegador no hay ventana que mover.
  if (esMac || !enTauri) return null;

  const boton = "flex h-full w-[46px] items-center justify-center text-suave transition-colors";

  return (
    <div className="absolute right-0 top-0 flex h-full">
      <button
        aria-label={tx.ventana.minimizar}
        title={tx.ventana.minimizar}
        onClick={() => void ventana().then((v) => v.minimize())}
        className={`${boton} hover:bg-elevado hover:text-texto`}
      >
        <Icono tipo="minimizar" />
      </button>
      <button
        aria-label={maximizada ? tx.ventana.restaurar : tx.ventana.maximizar}
        title={maximizada ? tx.ventana.restaurar : tx.ventana.maximizar}
        onClick={() => void ventana().then((v) => v.toggleMaximize())}
        className={`${boton} hover:bg-elevado hover:text-texto`}
      >
        <Icono tipo={maximizada ? "restaurar" : "maximizar"} />
      </button>
      <button
        aria-label={tx.ventana.cerrar}
        title={tx.ventana.cerrar}
        onClick={() => void ventana().then((v) => v.close())}
        className={`${boton} hover:bg-[#c42b1c] hover:text-white active:bg-[#a52317]`}
      >
        <Icono tipo="cerrar" />
      </button>
    </div>
  );
}
