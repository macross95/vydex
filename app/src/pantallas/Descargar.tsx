import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownToLine, Link2, LoaderCircle, X } from "lucide-react";
import * as motor from "../lib/motor";
import { enTauri } from "../lib/plataforma";
import { useVydex } from "../lib/tienda";
import { errorLegible } from "../lib/errores";
import { t } from "../lib/i18n";
import { useT } from "../lib/useT";
import {
  construirEscalera,
  etiquetaPeldano,
  nombreAudio,
  nombreCodec,
  opcionesAudio,
  peldanoInicial,
} from "../lib/calidad";
import { bytes, carpetaCorta, duracion, enlaceCorto, fecha, nombreSitio } from "../lib/formato";
import type { AudioFormato, Contenedor, Formato, InfoVideo, Modo } from "../lib/tipos";
import Escalera, { type FilaEscalera } from "../componentes/Escalera";
import FilaDescarga from "../componentes/FilaDescarga";
import { BotonPrincipal, Miniatura, Segmentado } from "../componentes/Piezas";
import { avisar } from "../componentes/Aviso";

type Estado = "inicio" | "analizando" | "listo" | "error";
const ES_ENLACE = /^https?:\/\/[^\s]+$/i;

function describirAudio(f: Formato | null): string {
  if (!f) return t().descargar.audioDelVideo;
  const codec = nombreAudio(f);
  const kbps = f.abr ?? f.tbr;
  const idioma = f.idioma ? t().idiomas[f.idioma.slice(0, 2)] ?? f.idioma : null;
  return [codec, kbps ? `${Math.round(kbps)} kbps` : null, idioma].filter(Boolean).join(" · ");
}

export default function Descargar({ irA }: { irA: (p: "historial" | "ajustes") => void }) {
  const tx = useT();
  const ajustes = useVydex((s) => s.ajustes);
  const cola = useVydex((s) => s.cola);
  const historial = useVydex((s) => s.historial);
  const encolar = useVydex((s) => s.encolar);

  const [url, setUrl] = useState("");
  const [estado, setEstado] = useState<Estado>("inicio");
  const [error, setError] = useState("");
  const [info, setInfo] = useState<InfoVideo | null>(null);
  const [modo, setModo] = useState<Modo>("video");
  const [contenedor, setContenedor] = useState<Contenedor>(ajustes.contenedor);
  const [elegida, setElegida] = useState<string | null>(null);
  const [audioElegido, setAudioElegido] = useState<AudioFormato>(ajustes.audioFormato);
  const [copiado, setCopiado] = useState<string | null>(null);
  const descartados = useRef(new Set<string>());
  const campo = useRef<HTMLInputElement>(null);

  const escalera = useMemo(
    () => (info ? construirEscalera(info, ajustes.codec, contenedor) : []),
    [info, ajustes.codec, contenedor, ajustes.idioma],
  );
  const audios = useMemo(() => (info ? opcionesAudio(info) : []), [info, ajustes.idioma]);

  useEffect(() => {
    setElegida(peldanoInicial(escalera, ajustes.calidad, ajustes.hdr)?.clave ?? null);
  }, [escalera, ajustes.calidad, ajustes.hdr]);

  // Solo en la vista previa del navegador (?demo): carga un análisis de ejemplo.
  useEffect(() => {
    if (!enTauri && new URLSearchParams(window.location.search).has("demo")) {
      void analizar("https://www.youtube.com/watch?v=demo8k");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ofrece el enlace copiado al volver a la ventana.
  const revisarPortapapeles = useCallback(async () => {
    if (!ajustes.portapapeles || !enTauri) return;
    try {
      const { readText } = await import("@tauri-apps/plugin-clipboard-manager");
      const texto = (await readText())?.trim() ?? "";
      if (ES_ENLACE.test(texto) && texto !== url && texto !== info?.url && !descartados.current.has(texto)) {
        setCopiado(texto);
      }
    } catch {
      /* portapapeles vacío o sin texto */
    }
  }, [ajustes.portapapeles, url, info?.url]);

  useEffect(() => {
    void revisarPortapapeles();
    window.addEventListener("focus", revisarPortapapeles);
    return () => window.removeEventListener("focus", revisarPortapapeles);
  }, [revisarPortapapeles]);

  const analizar = async (enlace: string) => {
    const limpio = enlace.trim();
    if (!ES_ENLACE.test(limpio)) {
      setEstado("error");
      setError("ENLACE_INCOMPLETO");
      return;
    }
    setUrl(limpio);
    setCopiado(null);
    descartados.current.add(limpio);
    setEstado("analizando");
    setError("");
    try {
      const datos = await motor.analizar(limpio);
      setInfo(datos);
      setModo("video");
      setEstado("listo");
    } catch (e) {
      setInfo(null);
      setEstado("error");
      setError(String(e));
    }
  };

  /** Borra el enlace y el análisis para pegar otro. */
  const limpiar = () => {
    setUrl("");
    setInfo(null);
    setEstado("inicio");
    setError("");
    campo.current?.focus();
  };

  const peldano = escalera.find((p) => p.clave === elegida) ?? null;
  const audio = audios.find((a) => a.formato === audioElegido) ?? audios[0] ?? null;
  const sinVideo = info !== null && escalera.length === 0;
  const modoActivo: Modo = sinVideo ? "audio" : modo;

  const descargar = () => {
    if (!info) return;
    const base = {
      url: info.url,
      titulo: info.titulo,
      autor: info.autor,
      miniatura: info.miniatura,
      duracion: info.duracion,
      contenedor,
      audioFormato: audioElegido,
    };
    if (modoActivo === "video" && peldano) {
      encolar({
        ...base,
        modo: "video",
        etiqueta: etiquetaPeldano(peldano),
        detalle: `${contenedor.toUpperCase()} · ${nombreCodec[peldano.codec]} · ${peldano.fps} fps`,
        formatoVideo: peldano.video.id,
        formatoAudio: peldano.audio?.id ?? null,
        bytesEsperados: peldano.bytes,
      });
      avisar(tx.descargar.agregado(etiquetaPeldano(peldano)), "ok");
    } else if (audio) {
      encolar({
        ...base,
        modo: "audio",
        etiqueta: audio.etiqueta,
        detalle: audio.detalle.split(" · ")[0],
        formatoVideo: null,
        formatoAudio: audio.fuente?.id ?? null,
        audioFormato: audio.formato,
        bytesEsperados: audio.bytes,
      });
      avisar(tx.descargar.agregado(audio.etiqueta), "ok");
    }
  };

  const filasVideo: FilaEscalera[] = escalera.map((p) => ({
    clave: p.clave,
    etiqueta: p.etiqueta,
    nombre: p.nombre,
    detalle: `${p.resolucion}p · ${nombreCodec[p.codec]} · ${p.fps} fps`,
    detalleCorto: `${nombreCodec[p.codec]} · ${p.fps} fps`,
    hdr: p.hdr,
    bytes: p.bytes,
    aprox: p.aprox,
  }));
  const filasAudio: FilaEscalera[] = audios.map((a) => ({
    clave: a.formato,
    etiqueta: a.etiqueta,
    nombre: a.formato === "mp3" ? tx.escalera.compatible : tx.escalera.original,
    detalle: a.detalle,
    bytes: a.bytes,
    aprox: a.aprox,
  }));

  const maxima = escalera[0];
  const recientes = historial.slice(0, 3);

  return (
    <div className="flex flex-col gap-[14px]">
      <div className="mb-2 flex items-end justify-between gap-6">
        <div>
          <h1 className="text-titulo font-semibold">{tx.descargar.titulo}</h1>
          <p className="mt-0.5 text-cuerpo text-suave">
            {tx.descargar.seGuardanEn(carpetaCorta(ajustes.carpeta))}{" "}
            <button onClick={() => irA("ajustes")} className="font-medium text-texto underline-offset-4 hover:underline">
              {tx.descargar.cambiarCarpeta}
            </button>
          </p>
        </div>
      </div>

      {/* Enlace */}
      <section aria-labelledby="titulo-enlace" className="rounded-tarjeta bg-superficie p-4 sm:p-[22px]">
        <h2 id="titulo-enlace" className="sr-only">
          {tx.descargar.enlace}
        </h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void analizar(url);
          }}
          className="flex gap-2 sm:gap-3"
        >
          <div className="relative min-w-0 flex-1">
            <label htmlFor="enlace" className="sr-only">
              {tx.descargar.enlace}
            </label>
            <Link2 size={16} strokeWidth={1.5} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-tenue sm:left-5" />
            <input
              id="enlace"
              ref={campo}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape" && url) {
                  e.preventDefault();
                  limpiar();
                }
              }}
              onPaste={(e) => {
                const pegado = e.clipboardData.getData("text").trim();
                if (ES_ENLACE.test(pegado)) {
                  e.preventDefault();
                  void analizar(pegado);
                }
              }}
              placeholder={tx.descargar.placeholder}
              spellCheck={false}
              autoFocus
              className="h-12 w-full rounded-full border border-control bg-pozo pl-11 pr-12 text-[15px] text-texto outline-none transition-colors placeholder:text-tenue hover:border-tenue focus:border-texto focus-visible:outline-none sm:pl-12"
            />
            {url && (
              <button
                type="button"
                onClick={limpiar}
                aria-label={tx.descargar.borrarEnlace}
                title={tx.descargar.borrarEnlaceEsc}
                className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-suave transition-colors hover:bg-elevado hover:text-texto"
              >
                <X size={18} strokeWidth={1.75} />
              </button>
            )}
          </div>
          <BotonPrincipal type="submit" disabled={estado === "analizando" || !url.trim()} className="h-12 px-4 sm:px-6">
            {estado === "analizando" ? <LoaderCircle size={16} className="animate-spin" /> : null}
            {estado === "analizando" ? tx.descargar.leyendo : tx.descargar.analizar}
          </BotonPrincipal>
        </form>

        <div className="mt-3 flex min-h-5 flex-wrap items-center gap-x-3 gap-y-1 px-1 text-cuerpo sm:pl-5">
          {estado === "error" ? (
            <p role="alert" className="text-negativo">
              {error === "ENLACE_INCOMPLETO" ? tx.descargar.enlaceIncompleto : errorLegible(error)}
            </p>
          ) : estado === "analizando" ? (
            <p className="text-suave">{tx.descargar.buscando(enlaceCorto(url))}</p>
          ) : copiado ? (
            <>
              <span className="truncate text-suave">{tx.descargar.copiaste(enlaceCorto(copiado))}</span>
              <button onClick={() => void analizar(copiado)} className="flex-none font-semibold text-texto hover:underline">
                {tx.descargar.usarEnlace}
              </button>
              <button
                onClick={() => {
                  descartados.current.add(copiado);
                  setCopiado(null);
                }}
                className="flex-none text-tenue hover:text-texto"
              >
                {tx.descargar.ignorar}
              </button>
            </>
          ) : (
            <p className="text-tenue">{tx.descargar.sitios}</p>
          )}
        </div>
      </section>

      {/* Resultado del análisis */}
      {(estado === "analizando" || info) && (
        <section aria-labelledby="titulo-video" aria-busy={estado === "analizando"} className="rounded-tarjeta bg-superficie p-4 sm:p-[22px]">
          {estado === "analizando" || !info ? (
            <EsqueletoResultado />
          ) : (
            <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)] lg:gap-7">
              <div className="grid gap-x-5 gap-y-4 sm:grid-cols-[240px_minmax(0,1fr)] lg:block">
                <Miniatura src={info.miniatura} className="w-full" sitio={nombreSitio[info.sitio] ?? info.sitio} audio={sinVideo}>
                  {info.duracion ? (
                    <span className="num absolute bottom-2 right-2 rounded-[4px] bg-black/80 px-1.5 text-meta font-medium leading-5 text-texto">
                      {duracion(info.duracion)}
                    </span>
                  ) : null}
                </Miniatura>
                <div className="min-w-0">
                <h2 id="titulo-video" className="line-clamp-2 text-seccion font-semibold text-texto lg:mt-4">
                  {info.titulo}
                </h2>
                <p className="mt-1 truncate text-cuerpo text-suave">
                  {[info.autor, nombreSitio[info.sitio] ?? info.sitio].filter(Boolean).join(" · ")}
                </p>
                {maxima && (
                  <p className="mt-4 text-cuerpo text-texto">
                    {tx.descargar.maximaCalidad} <span className="font-semibold">{maxima.etiqueta}</span>
                    <span className="text-suave">
                      {" "}
                      · {maxima.fps} fps{escalera.some((p) => p.hdr) ? tx.descargar.tambienHdr : ""}
                    </span>
                  </p>
                )}
                <dl className="mt-4 grid grid-cols-[104px_minmax(0,1fr)] gap-y-2 rounded-panel bg-pozo px-4 py-3 text-meta">
                  <dt className="text-tenue">{tx.descargar.audioIncluido}</dt>
                  <dd className="truncate text-suave">{describirAudio(modoActivo === "video" ? peldano?.audio ?? null : audio?.fuente ?? null)}</dd>
                  <dt className="text-tenue">{tx.descargar.archivoFinal}</dt>
                  <dd className="truncate text-suave">
                    {modoActivo === "video" && peldano
                      ? `${contenedor.toUpperCase()} · ${peldano.video.ancho ?? "?"}×${peldano.video.alto ?? "?"}`
                      : audio
                        ? audio.etiqueta
                        : "—"}
                  </dd>
                  <dt className="text-tenue">{tx.descargar.subtitulos}</dt>
                  <dd className="text-suave">
                    {modoActivo === "audio" ? tx.descargar.noAplica : ajustes.subtitulos ? tx.descargar.subtitulosSi : tx.descargar.subtitulosNo}
                  </dd>
                </dl>
                </div>
              </div>

              <div className="flex min-w-0 flex-col">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  {sinVideo ? (
                    <p className="text-cuerpo text-suave">{tx.descargar.soloAudioEnlace}</p>
                  ) : (
                    <Segmentado
                      etiqueta={tx.descargar.queDescargar}
                      valor={modo}
                      alCambiar={setModo}
                      opciones={[
                        { valor: "video", nombre: tx.descargar.video },
                        { valor: "audio", nombre: tx.descargar.soloAudio },
                      ]}
                    />
                  )}
                  {modoActivo === "video" && (
                    <Segmentado
                      etiqueta={tx.descargar.formatoArchivo}
                      valor={contenedor}
                      alCambiar={setContenedor}
                      opciones={[
                        { valor: "mp4", nombre: "MP4" },
                        { valor: "mkv", nombre: "MKV" },
                      ]}
                    />
                  )}
                </div>

                {modoActivo === "video" ? (
                  <Escalera etiqueta={tx.descargar.calidadVideo} filas={filasVideo} elegida={elegida} alElegir={setElegida} />
                ) : (
                  <Escalera
                    etiqueta={tx.descargar.formatoAudio}
                    filas={filasAudio}
                    elegida={audio?.formato ?? null}
                    alElegir={(c) => setAudioElegido(c as AudioFormato)}
                  />
                )}

                <div className="mt-4 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:pl-3">
                  <p className="text-center text-meta text-tenue sm:text-left">
                    {modoActivo === "video" && peldano
                      ? tx.descargar.resumenVideo(
                          contenedor.toUpperCase(),
                          nombreCodec[peldano.codec],
                          peldano.audio ? (contenedor === "mp4" ? tx.descargar.audioAac : tx.descargar.audioOpus) : tx.descargar.suAudio,
                        )
                      : audio
                        ? audio.detalle
                        : ""}
                  </p>
                  <BotonPrincipal onClick={descargar} disabled={modoActivo === "video" ? !peldano : !audio} className="h-11 w-full sm:h-9 sm:w-auto">
                    <ArrowDownToLine size={16} strokeWidth={1.75} />
                    {modoActivo === "video" && peldano
                      ? tx.descargar.boton(etiquetaPeldano(peldano), bytes(peldano.bytes))
                      : audio
                        ? tx.descargar.boton(audio.etiqueta, bytes(audio.bytes))
                        : tx.descargar.botonSolo}
                  </BotonPrincipal>
                </div>
              </div>
            </div>
          )}
        </section>
      )}

      {/* Cola */}
      <section aria-labelledby="titulo-cola" className="rounded-tarjeta bg-superficie px-4 pb-2 pt-4 sm:px-[22px] sm:pt-[18px]">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="titulo-cola" className="text-seccion font-semibold">
            {tx.descargar.enCurso}
          </h2>
          <span className="num truncate text-meta text-tenue">
            {cola.length === 0
              ? tx.descargar.aLaVez(ajustes.simultaneas)
              : tx.descargar.archivosALaVez(cola.length, ajustes.simultaneas)}
          </span>
        </div>
        {cola.length === 0 ? (
          <p className="my-3 rounded-panel border border-dashed border-control px-4 py-3 text-cuerpo text-suave">
            {tx.descargar.sinDescargas}{" "}
            <button onClick={() => irA("historial")} className="font-medium text-texto hover:underline">
              {tx.descargar.historial}
            </button>
            .
          </p>
        ) : (
          <ul className="divide-y divide-regla">
            {cola.map((d) => (
              <FilaDescarga key={d.id} d={d} />
            ))}
          </ul>
        )}
      </section>

      {/* Recientes */}
      {recientes.length > 0 && (
        <section aria-labelledby="titulo-recientes" className="rounded-tarjeta bg-superficie px-4 pb-2 pt-4 sm:px-[22px] sm:pt-[18px]">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="titulo-recientes" className="text-seccion font-semibold">
              {tx.descargar.recientes}
            </h2>
            <button onClick={() => irA("historial")} className="text-meta font-medium whitespace-nowrap text-suave hover:text-texto">
              {tx.descargar.verHistorial(historial.length)}
            </button>
          </div>
          <ul className="divide-y divide-regla">
            {recientes.map((h) => (
              <li key={h.id} className="flex items-center gap-3 py-3 sm:gap-4">
                <div className="hidden sm:block">
                  <Miniatura src={h.miniatura} className="w-16" audio={h.modo === "audio"} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-cuerpo font-medium">{h.titulo}</p>
                  <p className="truncate text-meta text-tenue">
                    {h.etiqueta} · {h.detalle}
                    <span className="sm:hidden"> · {bytes(h.bytes)}</span>
                  </p>
                </div>
                <span className="num hidden w-24 flex-none text-right text-cuerpo text-texto sm:block">{bytes(h.bytes)}</span>
                <span className="num hidden w-28 flex-none text-right text-meta text-tenue md:block">{fecha(h.fecha)}</span>
                <button
                  onClick={() => motor.abrir(h.ruta, false).catch(() => avisar(t().descargar.archivoNoEsta, "error"))}
                  className="flex-none text-right text-cuerpo font-semibold text-texto hover:text-acento sm:w-14"
                >
                  {tx.descargar.abrir}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function EsqueletoResultado() {
  return (
    <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)] lg:gap-7" aria-hidden>
      <div className="grid gap-x-5 gap-y-4 sm:grid-cols-[240px_minmax(0,1fr)] lg:block">
        <div className="aspect-video w-full rounded-[8px] bg-elevado" />
        <div>
          <div className="h-4 w-4/5 rounded bg-elevado lg:mt-4" />
          <div className="mt-2 h-3.5 w-2/5 rounded bg-elevado" />
        </div>
      </div>
      <div className="flex flex-col gap-0.5">
        <div className="mb-3 h-10 w-52 rounded-full bg-pozo" />
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="flex h-[52px] items-center gap-3 px-3">
            <div className="h-4 w-4 rounded-full bg-elevado" />
            <div className="h-4 w-14 rounded bg-elevado" />
            <div className="h-1 flex-1 rounded-full bg-pista" />
            <div className="h-3.5 w-16 rounded bg-elevado" />
          </div>
        ))}
      </div>
    </div>
  );
}
