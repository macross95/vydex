// Bienvenida de la primera vez: elige idioma e invita a revisar los Ajustes antes de descargar.

import { useEffect } from "react";
import { Film, FolderDown, Music2 } from "lucide-react";
import { useVydex } from "../lib/tienda";
import { useT } from "../lib/useT";
import { carpetaCorta } from "../lib/formato";
import { BotonPrincipal, BotonSecundario, Segmentado } from "./Piezas";

export default function Bienvenida({
  alIrAjustes,
  alUsarValores,
  alCerrar,
}: {
  alIrAjustes: () => void;
  alUsarValores: () => void;
  alCerrar: () => void;
}) {
  const tx = useT();
  const ajustes = useVydex((s) => s.ajustes);
  const cambiar = useVydex((s) => s.cambiar);

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => e.key === "Escape" && alCerrar();
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [alCerrar]);

  const filas = [
    { icono: FolderDown, nombre: tx.bienvenida.carpeta, valor: carpetaCorta(ajustes.carpeta) },
    {
      icono: Film,
      nombre: tx.bienvenida.video,
      valor: `${tx.calidad[ajustes.calidad]} · ${ajustes.contenedor.toUpperCase()}`,
    },
    { icono: Music2, nombre: tx.bienvenida.audio, valor: tx.formatoAudio[ajustes.audioFormato] },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="bienvenida-titulo"
        aria-describedby="bienvenida-texto"
        className="aparecer w-full max-w-[480px] rounded-tarjeta border border-regla bg-flotante p-6 sm:p-8"
      >
        <div className="flex items-start justify-between gap-4">
          <img src={`${import.meta.env.BASE_URL}vydex-logo.png`} alt="Vydex" width={72} height={72} className="h-[72px] w-[72px]" />
          <Segmentado
            etiqueta={tx.bienvenida.idioma}
            valor={ajustes.idioma}
            alCambiar={(v) => cambiar("idioma", v)}
            opciones={[
              { valor: "es", nombre: "Español" },
              { valor: "en", nombre: "English" },
            ]}
          />
        </div>
        <h2 id="bienvenida-titulo" className="mt-5 text-titulo font-semibold">
          {tx.bienvenida.titulo}
        </h2>
        <p id="bienvenida-texto" className="mt-2 text-cuerpo text-suave">
          {tx.bienvenida.texto}
        </p>

        <p className="mt-6 text-meta text-tenue">{tx.bienvenida.configuracionActual}</p>
        <dl className="mt-2 flex flex-col gap-2.5 rounded-panel bg-pozo px-4 py-3.5">
          {filas.map(({ icono: Icono, nombre, valor }) => (
            <div key={nombre} className="flex items-center gap-3 text-cuerpo">
              <Icono size={16} strokeWidth={1.5} className="flex-none text-tenue" />
              <dt className="w-16 flex-none text-tenue">{nombre}</dt>
              <dd className="min-w-0 truncate text-texto">{valor}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <BotonSecundario onClick={alUsarValores}>{tx.bienvenida.usarValores}</BotonSecundario>
          <BotonPrincipal onClick={alIrAjustes} autoFocus>
            {tx.bienvenida.irAjustes}
          </BotonPrincipal>
        </div>
      </div>
    </div>
  );
}
