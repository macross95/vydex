// La escalera de calidad: una fila por opción, con una barra proporcional al peso del archivo.
// El acento (rojo-naranja de la marca) solo marca la barra de la opción elegida.

import { bytes } from "../lib/formato";

export interface FilaEscalera {
  clave: string;
  etiqueta: string;
  nombre: string;
  detalle: string;
  /** Versión breve del detalle para ventanas angostas */
  detalleCorto?: string;
  hdr?: boolean;
  bytes: number | null;
  aprox: boolean;
}

export default function Escalera({
  filas,
  elegida,
  alElegir,
  etiqueta,
}: {
  filas: FilaEscalera[];
  elegida: string | null;
  alElegir: (clave: string) => void;
  etiqueta: string;
}) {
  const maximo = Math.max(1, ...filas.map((f) => f.bytes ?? 0));

  const mover = (e: React.KeyboardEvent, i: number) => {
    const destino = e.key === "ArrowDown" ? i + 1 : e.key === "ArrowUp" ? i - 1 : -1;
    if (destino < 0 || destino >= filas.length) return;
    e.preventDefault();
    alElegir(filas[destino].clave);
    (e.currentTarget.parentElement?.children[destino] as HTMLElement | undefined)?.focus();
  };

  return (
    <div role="radiogroup" aria-label={etiqueta} className="flex flex-col gap-0.5">
      {filas.map((f, i) => {
        const activa = f.clave === elegida;
        const ancho = f.bytes ? Math.max(1.5, (f.bytes / maximo) * 100) : 0;
        return (
          <button
            key={f.clave}
            role="radio"
            aria-checked={activa}
            tabIndex={activa || (!elegida && i === 0) ? 0 : -1}
            onClick={() => alElegir(f.clave)}
            onKeyDown={(e) => mover(e, i)}
            className={`grid min-h-[52px] grid-cols-[16px_62px_minmax(0,1fr)_auto] items-center gap-x-2.5 rounded-panel px-2.5 py-1.5 text-left transition-colors sm:grid-cols-[20px_76px_minmax(0,1fr)_92px] sm:gap-x-3 sm:px-3 ${
              activa ? "bg-elevado" : "hover:bg-encima"
            }`}
          >
            <span
              aria-hidden
              className={`flex h-4 w-4 items-center justify-center rounded-full border ${
                activa ? "border-texto" : "border-control"
              }`}
            >
              {activa && <span className="h-2 w-2 rounded-full bg-texto" />}
            </span>
            <span className="flex min-w-0 flex-col leading-tight">
              <span className="text-seccion font-semibold text-texto">{f.etiqueta}</span>
              <span className="truncate text-meta whitespace-nowrap text-tenue">{f.nombre}</span>
            </span>
            <span className="flex min-w-0 flex-col gap-1.5">
              <span className="flex min-w-0 items-center gap-2 text-meta text-suave">
                <span className="truncate">
                  {f.detalleCorto ? (
                    <>
                      <span className="sm:hidden">{f.detalleCorto}</span>
                      <span className="hidden sm:inline">{f.detalle}</span>
                    </>
                  ) : (
                    f.detalle
                  )}
                </span>
                {f.hdr && (
                  <span className="flex-none rounded-[4px] bg-elevado px-1.5 py-px text-[11px] font-semibold leading-4 text-texto">
                    HDR
                  </span>
                )}
              </span>
              <span className="h-1 w-full overflow-hidden rounded-full bg-pista">
                <span
                  className={`block h-full rounded-full ${activa ? "bg-acento" : "bg-control"}`}
                  style={{ width: `${ancho}%` }}
                />
              </span>
            </span>
            <span className="num text-right text-cuerpo font-medium text-texto">
              {f.bytes ? `${f.aprox ? "≈ " : ""}${bytes(f.bytes)}` : "—"}
            </span>
          </button>
        );
      })}
    </div>
  );
}
