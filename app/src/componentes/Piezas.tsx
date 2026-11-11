// Piezas pequeñas reutilizadas en varias pantallas.

import { useState, type ReactNode } from "react";
import { Music2 } from "lucide-react";

/** Miniatura 16:9. El ancho lo da `className` (w-24, w-full…); sin imagen muestra un bloque neutro. */
export function Miniatura({
  src,
  className = "",
  sitio,
  audio = false,
  children,
}: {
  src: string | null;
  className?: string;
  sitio?: string;
  audio?: boolean;
  children?: ReactNode;
}) {
  const [fallo, setFallo] = useState(false);
  return (
    <div
      className={`relative flex aspect-video flex-none items-center justify-center overflow-hidden rounded-[8px] bg-elevado ${className}`}
    >
      {src && !fallo ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFallo(true)}
          className="h-full w-full object-cover"
        />
      ) : audio ? (
        <Music2 size={18} strokeWidth={1.5} className="text-tenue" />
      ) : (
        <span className="px-2 text-center text-meta text-tenue">{sitio ?? ""}</span>
      )}
      {children}
    </div>
  );
}

export function Segmentado<T extends string>({
  opciones,
  valor,
  alCambiar,
  etiqueta,
}: {
  opciones: { valor: T; nombre: string }[];
  valor: T;
  alCambiar: (v: T) => void;
  etiqueta: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={etiqueta}
      className="sin-barra inline-flex max-w-full overflow-x-auto rounded-full bg-pozo p-1"
    >
      {opciones.map((o) => {
        const activo = o.valor === valor;
        return (
          <button
            key={o.valor}
            role="radio"
            aria-checked={activo}
            onClick={() => alCambiar(o.valor)}
            className={`h-8 flex-none rounded-full px-3 text-cuerpo font-semibold whitespace-nowrap transition-colors sm:px-4 ${
              activo ? "bg-elevado text-texto" : "text-nav hover:text-texto"
            }`}
          >
            {o.nombre}
          </button>
        );
      })}
    </div>
  );
}

export function Interruptor({
  activo,
  alCambiar,
  etiqueta,
}: {
  activo: boolean;
  alCambiar: (v: boolean) => void;
  etiqueta: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={activo}
      aria-label={etiqueta}
      onClick={() => alCambiar(!activo)}
      className={`relative h-5 w-[34px] flex-none rounded-full transition-colors ${
        activo ? "bg-acento" : "bg-control"
      }`}
    >
      <span
        className={`absolute left-0 top-0.5 h-4 w-4 rounded-full bg-texto transition-transform ${
          activo ? "translate-x-[16px]" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

/** Botón principal: rojo-naranja de la marca con texto blanco. */
export function BotonPrincipal({
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`inline-flex h-9 items-center justify-center gap-2 rounded-full bg-boton px-5 text-cuerpo font-semibold whitespace-nowrap text-white transition-[background-color,transform] hover:bg-boton-hover active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-elevado disabled:text-tenue ${
        props.className ?? ""
      }`}
    >
      {children}
    </button>
  );
}

/** Botón secundario: contorno claro, sin relleno. */
export function BotonSecundario({
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`inline-flex h-9 items-center justify-center gap-2 rounded-full border border-control px-4 text-cuerpo font-semibold whitespace-nowrap text-texto transition-colors hover:border-tenue hover:bg-encima disabled:cursor-not-allowed disabled:text-tenue ${
        props.className ?? ""
      }`}
    >
      {children}
    </button>
  );
}

/** Botón de ícono redondo de 32 px, con nombre accesible. */
export function BotonIcono({
  etiqueta,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { etiqueta: string }) {
  return (
    <button
      {...props}
      aria-label={etiqueta}
      title={etiqueta}
      className={`flex h-8 w-8 flex-none items-center justify-center rounded-full text-suave transition-colors hover:bg-elevado hover:text-texto ${
        props.className ?? ""
      }`}
    >
      {children}
    </button>
  );
}
