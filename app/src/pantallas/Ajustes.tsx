import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Minus, Plus } from "lucide-react";
import { MAX_SIMULTANEAS, useVydex } from "../lib/tienda";
import * as motor from "../lib/motor";
import { enTauri } from "../lib/plataforma";
import { construirEscalera, etiquetaPeldano, nombreCodec, peldanoInicial } from "../lib/calidad";
import { videoDeReferencia } from "../lib/ejemplo";
import { errorLegible } from "../lib/errores";
import { t } from "../lib/i18n";
import { useT } from "../lib/useT";
import type { Ajustes as TAjustes, EstadoMotor } from "../lib/tipos";
import { BotonIcono, BotonPrincipal, BotonSecundario, Interruptor, Segmentado } from "../componentes/Piezas";
import { avisar } from "../componentes/Aviso";

function Seccion({ titulo, descripcion, children }: { titulo: string; descripcion: ReactNode; children: ReactNode }) {
  return (
    <section className="grid gap-4 border-t border-regla py-7 first:border-t-0 first:pt-2 md:grid-cols-[240px_minmax(0,1fr)] md:gap-8 md:py-8 lg:grid-cols-[300px_minmax(0,1fr)]">
      <div className="md:pt-1.5">
        <h2 className="text-seccion font-medium">{titulo}</h2>
        <div className="mt-1 text-cuerpo text-suave">{descripcion}</div>
      </div>
      <div className="flex min-w-0 flex-col gap-5 rounded-tarjeta bg-superficie p-4 sm:p-5">{children}</div>
    </section>
  );
}

function Campo({ titulo, ayuda, children }: { titulo: string; ayuda?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-cuerpo font-medium">{titulo}</p>
      {children}
      {ayuda && <p className="mt-2 text-meta text-tenue">{ayuda}</p>}
    </div>
  );
}

function FilaInterruptor({
  titulo,
  descripcion,
  activo,
  alCambiar,
}: {
  titulo: string;
  descripcion: string;
  activo: boolean;
  alCambiar: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-6">
      <div>
        <p className="text-cuerpo font-medium">{titulo}</p>
        <p className="mt-0.5 text-meta text-tenue">{descripcion}</p>
      </div>
      <Interruptor etiqueta={titulo} activo={activo} alCambiar={alCambiar} />
    </div>
  );
}

export default function Ajustes({ guia, alTerminarGuia }: { guia: boolean; alTerminarGuia: () => void }) {
  const tx = useT();
  const a = tx.ajustes;
  const ajustes = useVydex((s) => s.ajustes);
  const cambiarBase = useVydex((s) => s.cambiar);
  const [guardado, setGuardado] = useState(false);
  const temporizador = useRef<number>(undefined);
  const [estadoMotor, setEstadoMotor] = useState<EstadoMotor | null>(null);
  const [actualizando, setActualizando] = useState(false);

  useEffect(() => {
    void motor.estadoMotor().then(setEstadoMotor);
  }, []);

  const cambiar = <K extends keyof TAjustes>(clave: K, valor: TAjustes[K]) => {
    cambiarBase(clave, valor);
    setGuardado(true);
    clearTimeout(temporizador.current);
    temporizador.current = window.setTimeout(() => setGuardado(false), 1800);
  };

  // Vista previa: qué se marcaría en un video publicado en 8K con versión HDR.
  const ejemplo = useMemo(() => {
    const escalera = construirEscalera(videoDeReferencia(), ajustes.codec, ajustes.contenedor);
    const p = peldanoInicial(escalera, ajustes.calidad, ajustes.hdr);
    return p ? `${etiquetaPeldano(p)} · ${nombreCodec[p.codec]} · ${ajustes.contenedor.toUpperCase()}` : "—";
  }, [ajustes.codec, ajustes.contenedor, ajustes.calidad, ajustes.hdr]);

  // Antes de aceptar la carpeta se prueba escribir en ella: así el problema aparece aquí y no
  // recién al terminar una descarga.
  const elegirCarpeta = async () => {
    if (!enTauri) return;
    const { open } = await import("@tauri-apps/plugin-dialog");
    const elegida = await open({ directory: true, defaultPath: ajustes.carpeta, title: t().ajustes.carpeta });
    if (typeof elegida !== "string") return;
    try {
      await motor.probarCarpeta(elegida);
      cambiar("carpeta", elegida);
    } catch (e) {
      avisar(errorLegible(e), "error");
    }
  };

  const actualizar = async () => {
    setActualizando(true);
    try {
      const version = await motor.actualizarMotor();
      setEstadoMotor((e) => (e ? { ...e, ytdlp: version } : e));
      avisar(t().ajustes.motorAlDia(version), "ok");
    } catch (e) {
      avisar(errorLegible(e), "error");
    } finally {
      setActualizando(false);
    }
  };

  return (
    <div>
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-titulo font-semibold">{a.titulo}</h1>
          <p className="mt-0.5 text-cuerpo text-suave">{a.subtitulo}</p>
        </div>
        <span aria-live="polite" className={`text-meta text-positivo transition-opacity ${guardado ? "opacity-100" : "opacity-0"}`}>
          {a.guardado}
        </span>
      </div>

      {guia && (
        <div className="aparecer mb-6 flex flex-col gap-4 rounded-tarjeta bg-superficie p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div className="flex items-start gap-3.5">
            <img src={`${import.meta.env.BASE_URL}vydex-logo.png`} alt="" width={44} height={44} className="h-11 w-11 flex-none" />
            <div>
              <p className="text-seccion font-semibold">{a.guiaTitulo}</p>
              <p className="mt-0.5 text-cuerpo text-suave">{a.guiaTexto}</p>
            </div>
          </div>
          <BotonPrincipal onClick={alTerminarGuia} className="h-10 flex-none">
            {a.empezar}
          </BotonPrincipal>
        </div>
      )}

      <Seccion titulo={a.idioma} descripcion={a.idiomaDesc}>
        <Segmentado
          etiqueta={a.idioma}
          valor={ajustes.idioma}
          alCambiar={(v) => cambiar("idioma", v)}
          opciones={[
            { valor: "es", nombre: "Español" },
            { valor: "en", nombre: "English" },
          ]}
        />
      </Seccion>

      <Seccion titulo={a.carpeta} descripcion={a.carpetaDesc}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
          <p className="min-w-0 flex-1 truncate rounded-panel bg-pozo px-4 py-2.5 text-cuerpo text-texto" title={ajustes.carpeta}>
            {ajustes.carpeta}
          </p>
          <BotonSecundario onClick={elegirCarpeta} className="self-start sm:self-auto">
            {a.cambiarCarpeta}
          </BotonSecundario>
        </div>
      </Seccion>

      <Seccion
        titulo={a.video}
        descripcion={
          <>
            {a.videoDesc}
            <span className="mt-4 block rounded-panel bg-superficie px-4 py-3 text-texto">
              <span className="block text-meta text-tenue">{a.ejemplo}</span>
              <span className="num mt-0.5 block font-semibold">{ejemplo}</span>
            </span>
          </>
        }
      >
        <Campo titulo={a.calidadPreferida} ayuda={a.calidadAyuda}>
          <Segmentado
            etiqueta={a.calidadPreferida}
            valor={ajustes.calidad}
            alCambiar={(v) => cambiar("calidad", v)}
            opciones={[
              { valor: "max", nombre: a.maxima },
              { valor: "2160", nombre: "4K" },
              { valor: "1440", nombre: "2K" },
              { valor: "1080", nombre: "1080p" },
              { valor: "720", nombre: "720p" },
            ]}
          />
        </Campo>
        <Campo titulo={a.codec} ayuda={a.codecAyuda[ajustes.codec]}>
          <Segmentado
            etiqueta={a.codec}
            valor={ajustes.codec}
            alCambiar={(v) => cambiar("codec", v)}
            opciones={[
              { valor: "auto", nombre: a.automatico },
              { valor: "vp9", nombre: "VP9" },
              { valor: "av1", nombre: "AV1" },
              { valor: "h264", nombre: "H.264" },
            ]}
          />
        </Campo>
        <Campo titulo={a.formatoArchivo} ayuda={ajustes.contenedor === "mp4" ? a.mp4Ayuda : a.mkvAyuda}>
          <Segmentado
            etiqueta={a.formatoArchivo}
            valor={ajustes.contenedor}
            alCambiar={(v) => cambiar("contenedor", v)}
            opciones={[
              { valor: "mp4", nombre: "MP4" },
              { valor: "mkv", nombre: "MKV" },
            ]}
          />
        </Campo>
        <FilaInterruptor titulo={a.hdr} descripcion={a.hdrDesc} activo={ajustes.hdr} alCambiar={(v) => cambiar("hdr", v)} />
      </Seccion>

      <Seccion titulo={a.audio} descripcion={a.audioDesc}>
        <Campo titulo={a.formatoPreferido} ayuda={a.audioAyuda[ajustes.audioFormato]}>
          <Segmentado
            etiqueta={a.formatoAudioPreferido}
            valor={ajustes.audioFormato}
            alCambiar={(v) => cambiar("audioFormato", v)}
            opciones={[
              { valor: "mp3", nombre: "MP3" },
              { valor: "m4a", nombre: "M4A" },
              { valor: "opus", nombre: "Opus" },
            ]}
          />
        </Campo>
      </Seccion>

      <Seccion titulo={a.descargas} descripcion={a.descargasDesc}>
        <div className="flex items-center justify-between gap-6">
          <div>
            <p className="text-cuerpo font-medium">{a.simultaneas}</p>
            <p className="mt-0.5 text-meta text-tenue">{a.simultaneasDesc}</p>
          </div>
          <div className="flex flex-none items-center gap-1 rounded-full bg-pozo p-1">
            <BotonIcono
              etiqueta={a.unaMenos}
              disabled={ajustes.simultaneas <= 1}
              onClick={() => cambiar("simultaneas", ajustes.simultaneas - 1)}
              className="disabled:opacity-40"
            >
              <Minus size={14} strokeWidth={1.75} />
            </BotonIcono>
            <span className="num w-6 text-center text-seccion font-semibold">{ajustes.simultaneas}</span>
            <BotonIcono
              etiqueta={a.unaMas}
              disabled={ajustes.simultaneas >= MAX_SIMULTANEAS}
              onClick={() => cambiar("simultaneas", ajustes.simultaneas + 1)}
              className="disabled:opacity-40"
            >
              <Plus size={14} strokeWidth={1.75} />
            </BotonIcono>
          </div>
        </div>
        <FilaInterruptor
          titulo={a.subtitulos}
          descripcion={a.subtitulosDesc}
          activo={ajustes.subtitulos}
          alCambiar={(v) => cambiar("subtitulos", v)}
        />
        <FilaInterruptor titulo={a.avisar} descripcion={a.avisarDesc} activo={ajustes.notificar} alCambiar={(v) => cambiar("notificar", v)} />
        <FilaInterruptor
          titulo={a.portapapeles}
          descripcion={a.portapapelesDesc}
          activo={ajustes.portapapeles}
          alCambiar={(v) => cambiar("portapapeles", v)}
        />
        <FilaInterruptor
          titulo={a.actualizarAuto}
          descripcion={a.actualizarAutoDesc}
          activo={ajustes.actualizarAuto}
          alCambiar={(v) => cambiar("actualizarAuto", v)}
        />
      </Seccion>

      <Seccion titulo={a.motor} descripcion={a.motorDesc}>
        <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-y-2 text-cuerpo">
          <dt className="text-suave">{a.extraccion}</dt>
          <dd className="num text-right">{estadoMotor?.ytdlp ?? "—"}</dd>
          <dt className="text-suave">{a.desafios}</dt>
          <dd className="num text-right">{estadoMotor?.deno ?? "—"}</dd>
          <dt className="text-suave">{a.union}</dt>
          <dd className="num text-right">{estadoMotor?.ffmpeg ?? "—"}</dd>
        </dl>
        {estadoMotor?.problema && (
          <p role="alert" className="text-meta text-negativo">
            {a.motorProblema} {estadoMotor.problema}
          </p>
        )}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <p className="text-meta text-tenue">
            {a.licencias}{" "}
            <button
              onClick={() => void motor.abrirLicencias().catch((e) => avisar(errorLegible(e), "error"))}
              className="font-semibold text-texto underline-offset-4 hover:text-acento hover:underline"
            >
              {a.verLicencias}
            </button>
          </p>
          <BotonSecundario onClick={actualizar} disabled={actualizando} className="flex-none self-start sm:self-auto">
            {actualizando ? a.buscandoActualizacion : a.buscarActualizacion}
          </BotonSecundario>
        </div>
      </Seccion>

      {guia && (
        <div className="flex justify-end border-t border-regla pt-7">
          <BotonPrincipal onClick={alTerminarGuia} className="h-10 w-full sm:w-auto">
            {a.listoEmpezar}
          </BotonPrincipal>
        </div>
      )}
    </div>
  );
}
