import { useEffect, useState } from "react";
import { FolderOpen } from "lucide-react";
import { useVydex, estaActiva } from "./lib/tienda";
import { iniciarActualizador } from "./lib/actualizador";
import * as motor from "./lib/motor";
import { abrirEnlace, enTauri, LINKEDIN, VERSION } from "./lib/plataforma";
import { velocidad } from "./lib/formato";
import { t } from "./lib/i18n";
import { useT } from "./lib/useT";
import { Avisos, avisar } from "./componentes/Aviso";
import Bienvenida from "./componentes/Bienvenida";
import ControlesVentana, { esMac } from "./componentes/ControlesVentana";
import Descargar from "./pantallas/Descargar";
import Historial from "./pantallas/Historial";
import Ajustes from "./pantallas/Ajustes";

type Pantalla = "descargar" | "historial" | "ajustes";

const PANTALLAS: Pantalla[] = ["descargar", "historial", "ajustes"];

function pantallaInicial(): Pantalla {
  const h = window.location.hash.replace("#", "");
  return h === "historial" || h === "ajustes" ? h : "descargar";
}

export default function App() {
  const tx = useT();
  const [pantalla, setPantalla] = useState<Pantalla>(pantallaInicial);
  const [conBorde, setConBorde] = useState(false);
  const [bienvenidaCerrada, setBienvenidaCerrada] = useState(false);
  const [guia, setGuia] = useState(false);
  const iniciar = useVydex((s) => s.iniciar);
  const listo = useVydex((s) => s.listo);
  const carpeta = useVydex((s) => s.ajustes.carpeta);
  const configurado = useVydex((s) => s.ajustes.configurado);
  const cambiar = useVydex((s) => s.cambiar);
  const cola = useVydex((s) => s.cola);
  const activas = cola.filter(estaActiva);
  const velocidadTotal = activas.reduce((total, d) => total + (d.velocidad ?? 0), 0);

  useEffect(() => {
    void iniciar();
  }, [iniciar]);

  // Con los ajustes ya leídos, revisa si hay una versión nueva de Vydex.
  useEffect(() => {
    if (listo) iniciarActualizador();
  }, [listo]);

  useEffect(() => {
    window.location.hash = pantalla;
    window.scrollTo({ top: 0 });
  }, [pantalla]);

  useEffect(() => {
    const alDesplazar = () => setConBorde(window.scrollY > 4);
    window.addEventListener("scroll", alDesplazar, { passive: true });
    return () => window.removeEventListener("scroll", alDesplazar);
  }, []);

  // Al cerrar con descargas en curso, se pide confirmación (en el idioma elegido).
  useEffect(() => {
    if (!enTauri) return;
    let soltar: (() => void) | undefined;
    void (async () => {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const { ask } = await import("@tauri-apps/plugin-dialog");
      soltar = await getCurrentWindow().onCloseRequested(async (evento) => {
        const n = useVydex.getState().cola.filter(estaActiva).length;
        if (n === 0) return;
        const textos = t().cerrar;
        const cerrar = await ask(textos.mensaje(n), {
          title: "Vydex",
          kind: "warning",
          okLabel: textos.cerrarIgual,
          cancelLabel: textos.seguir,
        });
        if (!cerrar) evento.preventDefault();
      });
    })();
    return () => soltar?.();
  }, []);

  const abrirCarpeta = () => motor.abrir(carpeta, false).catch(() => avisar(t().barra.carpetaNueva));

  const irAjustesGuiado = () => {
    cambiar("configurado", true);
    setGuia(true);
    setPantalla("ajustes");
  };

  return (
    <div className="flex min-h-full flex-col">
      <div className="capa-fondo fondo-vydex" aria-hidden />

      {/* El encabezado es la barra de título: se arrastra, doble clic maximiza y lleva los botones de la ventana */}
      <header
        data-tauri-drag-region="deep"
        className={`fondo-vydex sticky top-0 z-40 border-b transition-[border-color] ${
          conBorde ? "border-regla" : "border-transparent"
        }`}
      >
        <div
          className={`mx-auto flex h-16 max-w-[1088px] items-center gap-3 px-4 sm:gap-8 sm:px-6 lg:px-8 ${
            !enTauri ? "" : esMac ? "columna-barra-mac" : "columna-barra"
          }`}
        >
          <button
            onClick={() => setPantalla("descargar")}
            className="flex flex-none items-center gap-3 rounded-[10px]"
            aria-label={tx.nav.irInicio}
          >
            <img src={`${import.meta.env.BASE_URL}vydex-logo.png`} alt="" width={40} height={40} className="h-10 w-10" />
            <span className="hidden text-[21px] font-semibold tracking-[-0.02em] sm:inline">Vydex</span>
          </button>
          <nav aria-label={tx.nav.secciones} className="flex min-w-0 items-center gap-3 sm:gap-6">
            {PANTALLAS.map((id) => (
              <button
                key={id}
                onClick={() => setPantalla(id)}
                aria-current={pantalla === id ? "page" : undefined}
                className={`relative h-16 text-cuerpo font-semibold whitespace-nowrap transition-colors ${
                  pantalla === id ? "text-texto" : "text-nav hover:text-texto"
                }`}
              >
                {tx.nav[id]}
                {id === "ajustes" && !configurado && listo && (
                  <>
                    <span aria-hidden className="absolute -right-2.5 top-[24px] h-1.5 w-1.5 rounded-full bg-acento" />
                    <span className="sr-only">{tx.nav.porRevisar}</span>
                  </>
                )}
              </button>
            ))}
          </nav>
          <div className="ml-auto flex flex-none items-center gap-5">
            {activas.length > 0 && (
              <span className="num hidden text-meta whitespace-nowrap text-suave lg:inline">
                {tx.barra.enCurso(activas.length, velocidad(velocidadTotal))}
              </span>
            )}
            <button
              onClick={abrirCarpeta}
              aria-label={tx.barra.abrirCarpetaAria}
              className="flex items-center gap-2 text-cuerpo font-semibold text-nav transition-colors hover:text-texto"
            >
              <FolderOpen size={18} strokeWidth={1.5} />
              <span className="hidden sm:inline">{tx.barra.abrirCarpeta}</span>
            </button>
          </div>
        </div>
        <ControlesVentana />
      </header>

      <main className="mx-auto w-full max-w-[1088px] flex-1 px-4 pb-14 pt-6 sm:px-6 sm:pt-7 lg:px-8">
        {!listo ? null : pantalla === "descargar" ? (
          <Descargar irA={setPantalla} />
        ) : pantalla === "historial" ? (
          <Historial />
        ) : (
          <Ajustes
            guia={guia}
            alTerminarGuia={() => {
              setGuia(false);
              setPantalla("descargar");
            }}
          />
        )}
      </main>

      <footer className="mx-auto w-full max-w-[1088px] px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-1 border-t border-regla py-5 text-meta text-tenue sm:flex-row sm:items-center sm:justify-between">
          <p>
            {tx.pie.creadoPor}{" "}
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
          <p className="num">Vydex {VERSION}</p>
        </div>
      </footer>

      {listo && !configurado && !bienvenidaCerrada && (
        <Bienvenida
          alIrAjustes={irAjustesGuiado}
          alUsarValores={() => {
            cambiar("configurado", true);
            avisar(t().bienvenida.listo, "ok");
          }}
          alCerrar={() => setBienvenidaCerrada(true)}
        />
      )}
      <Avisos />
    </div>
  );
}
