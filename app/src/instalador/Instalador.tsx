import { useEffect, useMemo, useState } from "react";
import { Check, CircleCheck, CircleAlert, Minus, X } from "lucide-react";
import * as puente from "./puente";
import type { Info, Progreso } from "./puente";
import { TEXTOS_INSTALADOR } from "./textos";
import { BotonPrincipal, BotonSecundario, Segmentado } from "../componentes/Piezas";
import { abrirEnlace, LINKEDIN } from "../lib/plataforma";
import { idiomaDe, localeDe, type Idioma } from "../lib/idioma";

type Paso = "cargando" | "inicio" | "trabajando" | "listo" | "error";

const demo = new URLSearchParams(window.location.search);

function idiomaInicial(info: Info | null): Idioma {
  return idiomaDe(info?.idiomaInstalado ?? demo.get("lang") ?? navigator.language);
}

function Casilla({
  activa,
  alCambiar,
  etiqueta,
  descripcion,
  className = "",
}: {
  activa: boolean;
  alCambiar: (v: boolean) => void;
  etiqueta: string;
  descripcion?: string;
  className?: string;
}) {
  return (
    <button
      role="checkbox"
      aria-checked={activa}
      onClick={() => alCambiar(!activa)}
      className={`group flex items-start gap-3 text-left ${className}`}
    >
      <span
        className={`mt-px flex h-[18px] w-[18px] flex-none items-center justify-center rounded-[5px] border transition-colors ${
          activa ? "border-acento bg-acento" : "border-control bg-pozo group-hover:border-tenue"
        }`}
      >
        {activa && <Check size={13} strokeWidth={3} className="text-white" />}
      </span>
      <span>
        <span className="block text-cuerpo text-texto">{etiqueta}</span>
        {descripcion && <span className="mt-0.5 block text-meta text-tenue">{descripcion}</span>}
      </span>
    </button>
  );
}

export default function Instalador() {
  const [info, setInfo] = useState<Info | null>(null);
  const [idioma, setIdioma] = useState<Idioma>(idiomaInicial(null));
  const [paso, setPaso] = useState<Paso>("cargando");
  const [carpeta, setCarpeta] = useState("");
  const [escritorio, setEscritorio] = useState(true);
  const [borrarDatos, setBorrarDatos] = useState(false);
  const [abrirAhora, setAbrirAhora] = useState(true);
  const [progreso, setProgreso] = useState<Progreso>({ hecho: 0, total: 1, archivo: "" });
  const [error, setError] = useState("");
  /** Error detectado al abrir (instalador dañado, Vydex no instalado): solo se puede cerrar. */
  const [bloqueado, setBloqueado] = useState(false);
  const tx = TEXTOS_INSTALADOR[idioma];

  useEffect(() => {
    const bloquear = (motivo: string) => {
      setError(motivo);
      setBloqueado(true);
      setPaso("error");
    };
    puente.info().catch((e) => bloquear(String(e))).then((datos) => {
      if (!datos) return;
      setInfo(datos);
      setCarpeta(datos.carpeta);
      setIdioma(idiomaInicial(datos));
      if (datos.error) return bloquear(datos.error);
      // Vista previa del navegador: ?paso=trabajando|listo|error muestra ese paso.
      const pasoDemo = demo.get("paso") as Paso | null;
      if (pasoDemo === "trabajando") setProgreso({ hecho: 0.62, total: 1, archivo: "bin\\avcodec-62.dll" });
      if (pasoDemo === "error") setError("SIN_PERMISO");
      setPaso(pasoDemo ?? "inicio");
    });
  }, []);

  useEffect(() => {
    document.documentElement.lang = idioma;
  }, [idioma]);

  // Sin menú contextual del navegador: es una ventana de instalación, no una página.
  useEffect(() => {
    const evitar = (e: MouseEvent) => e.preventDefault();
    document.addEventListener("contextmenu", evitar);
    return () => document.removeEventListener("contextmenu", evitar);
  }, []);

  const desinstalando = info?.modo === "desinstalar";
  const actualizando = !desinstalando && !!info?.versionInstalada;
  const pct = Math.min(100, Math.floor((progreso.hecho / Math.max(1, progreso.total)) * 100));
  const peso = useMemo(() => {
    const mb = (info?.tamano ?? 0) / 1e6;
    return `${new Intl.NumberFormat(localeDe(idioma), { maximumFractionDigits: 0 }).format(mb)} MB`;
  }, [info?.tamano, idioma]);

  const ejecutar = async () => {
    setPaso("trabajando");
    setError("");
    try {
      if (desinstalando) await puente.desinstalar(borrarDatos);
      else await puente.instalar(carpeta, escritorio, idioma, setProgreso);
      setPaso("listo");
    } catch (e) {
      setError(String(e));
      setPaso("error");
    }
  };

  const terminar = async () => {
    if (!desinstalando && abrirAhora) await puente.abrirVydex().catch(() => undefined);
    await puente.salir();
  };

  const cambiarCarpeta = async () => {
    const elegida = await puente.elegirCarpeta(carpeta, tx.elegirCarpeta);
    if (elegida) setCarpeta(elegida);
  };

  const mensajeError = tx.errores[error] ?? error;
  const titulo = desinstalando ? tx.ventanaDesinstalar : tx.ventanaInstalar;

  return (
    <div className="fondo-vydex flex h-screen flex-col overflow-hidden text-texto">
      {/* Barra de título propia: se arrastra para mover la ventana */}
      <header data-tauri-drag-region className="flex h-11 flex-none items-center justify-between pl-4">
        <div className="pointer-events-none flex items-center gap-2 text-meta text-suave">
          <img src={`${import.meta.env.BASE_URL}vydex-logo.png`} alt="" width={18} height={18} className="h-[18px] w-[18px]" />
          {titulo}
        </div>
        <div className="flex h-full">
          <button
            onClick={() => void puente.minimizar()}
            aria-label={tx.minimizar}
            title={tx.minimizar}
            className="flex h-full w-12 items-center justify-center text-suave transition-colors hover:bg-elevado hover:text-texto"
          >
            <Minus size={16} strokeWidth={1.5} />
          </button>
          <button
            onClick={() => void puente.salir()}
            disabled={paso === "trabajando"}
            aria-label={tx.cerrar}
            title={tx.cerrar}
            className="flex h-full w-12 items-center justify-center text-suave transition-colors hover:bg-[#c42b1c] hover:text-white disabled:pointer-events-none disabled:opacity-30"
          >
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>
      </header>

      <main className="grid min-h-0 flex-1 grid-cols-[230px_minmax(0,1fr)] gap-9 px-9 pb-8 pt-4">
        {/* Marca */}
        <div className="flex min-h-0 flex-col">
          <img src={`${import.meta.env.BASE_URL}vydex-logo.png`} alt="Vydex" width={104} height={104} className="h-[104px] w-[104px]" />
          <p className="mt-6 text-[34px] font-semibold leading-none tracking-[-0.03em]">Vydex</p>
          <p className="num mt-2 text-meta text-tenue">{info ? tx.version(info.version) : " "}</p>
          <p className="mt-5 text-cuerpo text-suave">{tx.eslogan}</p>
          {paso === "inicio" && (
            <div className="mt-6">
              <Segmentado
                etiqueta={tx.idioma}
                valor={idioma}
                alCambiar={setIdioma}
                opciones={[
                  { valor: "es", nombre: "Español" },
                  { valor: "en", nombre: "English" },
                ]}
              />
            </div>
          )}
          <p className="mt-auto text-meta text-tenue">
            {tx.creadoPor}{" "}
            <a
              href={LINKEDIN}
              onClick={(e) => {
                e.preventDefault();
                void abrirEnlace(LINKEDIN);
              }}
              className="font-semibold text-texto underline-offset-4 hover:text-acento hover:underline"
            >
              MacrosS
            </a>
            .
          </p>
        </div>

        {/* Paso actual */}
        <section className="aparecer flex min-h-0 flex-col rounded-tarjeta bg-superficie p-7" key={paso}>
          {paso === "cargando" || (!info && !bloqueado) ? null : paso === "inicio" && info ? (
            <>
              <h1 className="text-titulo font-semibold">
                {desinstalando ? tx.tituloDesinstalar : actualizando ? tx.tituloActualizar : tx.tituloInstalar}
              </h1>
              <p className="mt-1 text-cuerpo text-suave">
                {desinstalando
                  ? tx.textoDesinstalar
                  : actualizando
                    ? tx.textoActualizar(info.versionInstalada!)
                    : tx.textoInstalar}
              </p>

              {desinstalando ? (
                <>
                  <p className="mt-7 truncate rounded-panel bg-pozo px-4 py-2.5 text-cuerpo" title={carpeta}>
                    {carpeta}
                  </p>
                  <Casilla
                    className="mt-6"
                    activa={borrarDatos}
                    alCambiar={setBorrarDatos}
                    etiqueta={tx.borrarDatos}
                    descripcion={tx.borrarDatosDesc}
                  />
                </>
              ) : (
                <>
                  <div className="mt-7">
                    <p className="mb-2 text-cuerpo font-medium">{tx.carpeta}</p>
                    <div className="flex gap-3">
                      <p className="min-w-0 flex-1 truncate rounded-panel bg-pozo px-4 py-2.5 text-cuerpo" title={carpeta}>
                        {carpeta}
                      </p>
                      <BotonSecundario onClick={() => void cambiarCarpeta()} className="h-10">
                        {tx.cambiar}
                      </BotonSecundario>
                    </div>
                    <p className="num mt-2 text-meta text-tenue">{tx.espacio(peso)}</p>
                  </div>
                  <Casilla className="mt-6" activa={escritorio} alCambiar={setEscritorio} etiqueta={tx.escritorio} />
                </>
              )}

              {info.vydexAbierto && (
                <p className="mt-5 flex items-center gap-2 text-meta text-aviso">
                  <CircleAlert size={14} strokeWidth={1.75} className="flex-none" />
                  {tx.abierto}
                </p>
              )}

              <div className="mt-auto flex items-center justify-between gap-4 pt-6">
                {desinstalando ? (
                  <>
                    <span />
                    <div className="flex gap-3">
                      <BotonSecundario onClick={() => void puente.salir()} className="h-11 px-6">
                        {tx.cancelar}
                      </BotonSecundario>
                      <BotonPrincipal onClick={() => void ejecutar()} className="h-11 px-7">
                        {tx.botonDesinstalar}
                      </BotonPrincipal>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-meta text-tenue">{tx.licencias}</p>
                    <BotonPrincipal onClick={() => void ejecutar()} className="h-11 px-9">
                      {actualizando ? tx.botonActualizar : tx.botonInstalar}
                    </BotonPrincipal>
                  </>
                )}
              </div>
            </>
          ) : paso === "trabajando" ? (
            <>
              <h1 className="text-titulo font-semibold">
                {desinstalando ? tx.desinstalando : actualizando ? tx.actualizando : tx.instalando}
              </h1>
              <p className="mt-1 text-cuerpo text-suave">{tx.noCierres}</p>
              <div className="mt-auto">
                {desinstalando ? (
                  <div className="h-1.5 overflow-hidden rounded-full bg-pista">
                    <div className="h-full w-1/3 animate-pulse rounded-full bg-acento" />
                  </div>
                ) : (
                  <>
                    <div className="flex items-end justify-between gap-6">
                      <span className="num text-[44px] font-semibold leading-none tracking-[-0.02em]">{pct} %</span>
                      <span className="num min-w-0 truncate pb-1 text-meta text-tenue">{progreso.archivo}</span>
                    </div>
                    <div
                      className="mt-4 h-1.5 overflow-hidden rounded-full bg-pista"
                      role="progressbar"
                      aria-valuenow={pct}
                      aria-valuemin={0}
                      aria-valuemax={100}
                    >
                      <div className="h-full rounded-full bg-acento transition-[width] duration-200" style={{ width: `${pct}%` }} />
                    </div>
                  </>
                )}
              </div>
            </>
          ) : paso === "listo" ? (
            <>
              <CircleCheck size={36} strokeWidth={1.5} className="text-positivo" />
              <h1 className="mt-4 text-titulo font-semibold">
                {desinstalando ? tx.desinstaladoTitulo : tx.listoTitulo}
              </h1>
              <p className="mt-1 text-cuerpo text-suave">
                {desinstalando ? tx.desinstaladoTexto : tx.listoTexto(escritorio)}
              </p>
              {!desinstalando && (
                <Casilla className="mt-7" activa={abrirAhora} alCambiar={setAbrirAhora} etiqueta={tx.abrirAhora} />
              )}
              <div className="mt-auto flex justify-end pt-6">
                <BotonPrincipal onClick={() => void terminar()} className="h-11 px-9">
                  {desinstalando ? tx.cerrar : tx.terminar}
                </BotonPrincipal>
              </div>
            </>
          ) : (
            <>
              <CircleAlert size={36} strokeWidth={1.5} className="text-negativo" />
              <h1 className="mt-4 text-titulo font-semibold">
                {desinstalando ? tx.errorDesinstalar : tx.errorInstalar}
              </h1>
              <p className="mt-1 text-cuerpo text-suave">{mensajeError}</p>
              <div className="mt-auto flex justify-end gap-3 pt-6">
                <BotonSecundario onClick={() => void puente.salir()} className="h-11 px-6">
                  {tx.cerrar}
                </BotonSecundario>
                {!bloqueado && (
                  <BotonPrincipal onClick={() => setPaso("inicio")} className="h-11 px-7">
                    {tx.reintentar}
                  </BotonPrincipal>
                )}
              </div>
            </>
          )}
        </section>
      </main>
    </div>
  );
}
