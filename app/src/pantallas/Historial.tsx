import { useEffect, useMemo, useState } from "react";
import { FolderOpen, Search, Trash2 } from "lucide-react";
import { useVydex } from "../lib/tienda";
import * as motor from "../lib/motor";
import { bytes, fecha } from "../lib/formato";
import { locale, t } from "../lib/i18n";
import { useT } from "../lib/useT";
import type { Modo } from "../lib/tipos";
import { BotonIcono, Miniatura } from "../componentes/Piezas";
import { avisar } from "../componentes/Aviso";

type Filtro = "todo" | Modo;

export default function Historial() {
  const tx = useT();
  const historial = useVydex((s) => s.historial);
  const faltantes = useVydex((s) => s.faltantes);
  const revisar = useVydex((s) => s.revisarArchivos);
  const borrar = useVydex((s) => s.borrarDelHistorial);
  const [filtro, setFiltro] = useState<Filtro>("todo");
  const [busqueda, setBusqueda] = useState("");

  useEffect(() => {
    void revisar();
  }, [revisar]);

  const conteo = useMemo(
    () => ({
      todo: historial.length,
      video: historial.filter((h) => h.modo === "video").length,
      audio: historial.filter((h) => h.modo === "audio").length,
    }),
    [historial],
  );

  const filas = useMemo(() => {
    const q = busqueda.trim().toLocaleLowerCase(locale());
    return historial.filter(
      (h) =>
        (filtro === "todo" || h.modo === filtro) &&
        (!q || `${h.titulo} ${h.autor ?? ""}`.toLocaleLowerCase(locale()).includes(q)),
    );
  }, [historial, filtro, busqueda]);

  const pesoTotal = filas.reduce((total, h) => total + (h.bytes ?? 0), 0);

  const abrir = (ruta: string, enCarpeta: boolean) =>
    motor.abrir(ruta, enCarpeta).catch(() => {
      avisar(t().historial.noEsta, "error");
      void revisar();
    });

  const tarjetas: { id: Filtro; nombre: string }[] = [
    { id: "todo", nombre: tx.historial.todo },
    { id: "video", nombre: tx.historial.video },
    { id: "audio", nombre: tx.historial.audio },
  ];

  return (
    <div className="flex flex-col gap-[14px]">
      <div className="mb-2 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
        <div>
          <h1 className="text-titulo font-semibold">{tx.historial.titulo}</h1>
          <p className="num mt-0.5 text-cuerpo text-suave">
            {tx.historial.resumen(filas.length, bytes(pesoTotal), filtro !== "todo" || !!busqueda)}
          </p>
        </div>
        <label className="relative block">
          <span className="sr-only">{tx.historial.buscar}</span>
          <Search size={14} strokeWidth={1.75} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-tenue" />
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder={tx.historial.buscarPlaceholder}
            className="h-9 w-full rounded-full border border-control bg-pozo pl-9 pr-4 text-cuerpo outline-none placeholder:text-tenue hover:border-tenue focus:border-texto focus-visible:outline-none sm:w-72"
          />
        </label>
      </div>

      <div role="radiogroup" aria-label={tx.historial.tipo} className="grid grid-cols-3 gap-[14px]">
        {tarjetas.map((tarjeta) => {
          const activa = filtro === tarjeta.id;
          return (
            <button
              key={tarjeta.id}
              role="radio"
              aria-checked={activa}
              onClick={() => setFiltro(tarjeta.id)}
              className={`flex h-[61px] flex-col justify-center rounded-panel px-4 text-left transition-colors ${
                activa ? "bg-elevado" : "bg-superficie hover:bg-encima"
              }`}
            >
              <span className={`text-[13px] ${activa ? "text-texto" : "text-tenue"}`}>{tarjeta.nombre}</span>
              <span className="num text-seccion font-semibold text-texto">{conteo[tarjeta.id]}</span>
            </button>
          );
        })}
      </div>

      <section aria-label={tx.historial.archivos} className="rounded-tarjeta bg-superficie px-4 py-2 sm:px-[22px]">
        {filas.length === 0 ? (
          <p className="my-3 rounded-panel border border-dashed border-control px-4 py-3 text-cuerpo text-suave">
            {historial.length === 0
              ? tx.historial.vacio
              : busqueda
                ? tx.historial.sinCoincidencias(busqueda)
                : tx.historial.sinTipo(filtro === "audio")}
          </p>
        ) : (
          <ul className="divide-y divide-regla">
            {filas.map((h) => {
              const falta = faltantes.has(h.id);
              return (
                <li key={h.id} className="flex min-h-20 items-center gap-3 py-3 sm:gap-4">
                  <div className="hidden sm:block">
                    <Miniatura src={h.miniatura} className="w-24" audio={h.modo === "audio"} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className={`truncate text-cuerpo font-medium ${falta ? "text-tenue" : "text-texto"}`}>{h.titulo}</p>
                    <p className="truncate text-meta text-tenue">
                      {[h.autor, `${h.etiqueta} · ${h.detalle}`].filter(Boolean).join(" · ")}
                    </p>
                    <p className="num truncate text-meta text-tenue md:hidden">
                      {bytes(h.bytes)} · {fecha(h.fecha)}
                    </p>
                  </div>
                  <span className="num hidden w-24 flex-none text-right text-cuerpo text-texto md:block">{bytes(h.bytes)}</span>
                  <span className="num hidden w-28 flex-none text-right text-meta text-tenue md:block">{fecha(h.fecha)}</span>
                  <div className="flex flex-none items-center justify-end gap-0.5 sm:w-[132px] sm:gap-1">
                    {falta ? (
                      <span className="mr-1 text-meta text-tenue">{tx.historial.movido}</span>
                    ) : (
                      <>
                        <button onClick={() => abrir(h.ruta, false)} className="mr-1 text-cuerpo font-semibold text-texto hover:text-acento sm:mr-2">
                          {tx.historial.abrir}
                        </button>
                        <span className="hidden sm:inline-flex">
                          <BotonIcono etiqueta={tx.historial.mostrarCarpeta} onClick={() => abrir(h.ruta, true)}>
                            <FolderOpen size={16} strokeWidth={1.5} />
                          </BotonIcono>
                        </span>
                      </>
                    )}
                    <BotonIcono etiqueta={tx.historial.quitar} onClick={() => borrar(h.id)}>
                      <Trash2 size={16} strokeWidth={1.5} />
                    </BotonIcono>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
