import { FileText, Pause, Play, RotateCcw, X } from "lucide-react";
import type { Descarga } from "../lib/tipos";
import { bytes, porcentaje, restante, velocidad } from "../lib/formato";
import { errorLegible } from "../lib/errores";
import { FASES_PROCESANDO, useVydex } from "../lib/tienda";
import { useT } from "../lib/useT";
import { abrir } from "../lib/motor";
import { BotonIcono, Miniatura } from "./Piezas";
import { avisar } from "./Aviso";

export default function FilaDescarga({ d }: { d: Descarga }) {
  const tx = useT();
  const pausar = useVydex((s) => s.pausar);
  const reanudar = useVydex((s) => s.reanudar);
  const cancelar = useVydex((s) => s.cancelar);
  const pct = d.estado === "completada" ? 100 : porcentaje(d.bytes, d.total);
  const procesando = FASES_PROCESANDO.has(d.estado);
  const conError = d.estado === "error";

  const fases: Record<string, string> = {
    "en-cola": d.sinExtras ? tx.fila.sinExtras : tx.fila.enEspera,
    uniendo: tx.fila.uniendo,
    convirtiendo: tx.fila.convirtiendo,
    finalizando: tx.fila.finalizando,
    pausada: tx.fila.pausada,
    completada: tx.fila.guardado,
  };

  let estado: string;
  if (d.estado === "descargando")
    estado = d.total
      ? `${tx.fila.de(bytes(d.bytes), bytes(d.total))} · ${velocidad(d.velocidad)} · ${restante(d.eta)}`
      : `${bytes(d.bytes)} · ${velocidad(d.velocidad)}`;
  else if (conError) estado = d.error ? errorLegible(d.error) : tx.fila.fallo;
  else estado = fases[d.estado] ?? "";

  return (
    <li className="flex items-center gap-3 py-3 sm:gap-4">
      <div className="hidden sm:block">
        <Miniatura src={d.miniatura} className="w-24" audio={d.modo === "audio"} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-col md:flex-row md:items-baseline md:gap-3">
          <p className="truncate text-cuerpo font-medium text-texto">{d.titulo}</p>
          <span className="truncate text-meta text-tenue md:flex-none">
            {d.etiqueta} · {d.detalle}
          </span>
        </div>
        <div
          className="mt-2.5 h-1 overflow-hidden rounded-full bg-pista"
          role="progressbar"
          aria-label={tx.fila.progresoDe(d.titulo)}
          aria-valuenow={Math.round(pct)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className={`h-full rounded-full transition-[width] duration-300 ${
              conError ? "bg-negativo" : d.estado === "pausada" ? "bg-tenue" : "bg-acento"
            } ${procesando ? "animate-pulse" : ""}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className={`num mt-1.5 truncate text-meta ${conError ? "text-negativo" : "text-tenue"}`}>{estado}</p>
      </div>
      <span className="num w-12 flex-none text-right text-seccion font-semibold text-texto sm:w-14">
        {d.estado === "en-cola" ? "—" : `${Math.floor(pct)} %`}
      </span>
      <div className="flex flex-none justify-end gap-0.5 sm:w-[108px] sm:gap-1">
        {conError && d.registro && (
          <BotonIcono etiqueta={tx.fila.verRegistro} onClick={() => void abrir(d.registro!, false).catch((e) => avisar(errorLegible(e), "error"))}>
            <FileText size={16} strokeWidth={1.5} />
          </BotonIcono>
        )}
        {d.estado === "descargando" || d.estado === "en-cola" ? (
          <BotonIcono etiqueta={tx.fila.pausar} onClick={() => pausar(d.id)}>
            <Pause size={16} strokeWidth={1.5} />
          </BotonIcono>
        ) : d.estado === "pausada" ? (
          <BotonIcono etiqueta={tx.fila.reanudar} onClick={() => reanudar(d.id)}>
            <Play size={16} strokeWidth={1.5} />
          </BotonIcono>
        ) : conError ? (
          <BotonIcono etiqueta={tx.fila.reintentar} onClick={() => reanudar(d.id)}>
            <RotateCcw size={16} strokeWidth={1.5} />
          </BotonIcono>
        ) : null}
        {d.estado !== "completada" && !procesando && (
          <BotonIcono etiqueta={conError ? tx.fila.quitar : tx.fila.cancelar} onClick={() => cancelar(d.id)}>
            <X size={16} strokeWidth={1.5} />
          </BotonIcono>
        )}
      </div>
    </li>
  );
}
