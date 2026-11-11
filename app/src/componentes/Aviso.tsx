// Avisos breves en la esquina inferior (errores y confirmaciones).

import { create } from "zustand";
import { CircleAlert, CircleCheck, X } from "lucide-react";
import { t } from "../lib/i18n";

type Tono = "error" | "ok" | "info";
interface Mensaje {
  id: number;
  tono: Tono;
  texto: string;
}

const useAvisos = create<{ lista: Mensaje[]; quitar: (id: number) => void }>((set) => ({
  lista: [],
  quitar: (id) => set((s) => ({ lista: s.lista.filter((m) => m.id !== id) })),
}));

let contador = 0;
export function avisar(texto: string, tono: Tono = "info") {
  const id = ++contador;
  useAvisos.setState((s) => ({ lista: [...s.lista.slice(-2), { id, tono, texto }] }));
  setTimeout(() => useAvisos.getState().quitar(id), tono === "error" ? 7000 : 3500);
}

function Item({ m }: { m: Mensaje }) {
  const quitar = useAvisos((s) => s.quitar);
  const Icono = m.tono === "error" ? CircleAlert : CircleCheck;
  return (
    <div
      role={m.tono === "error" ? "alert" : "status"}
      className="aparecer flex items-start gap-3 rounded-panel bg-flotante px-4 py-3 shadow-[0_12px_28px_rgba(0,0,0,0.5)]"
    >
      {m.tono !== "info" && (
        <Icono
          size={16}
          strokeWidth={1.75}
          className={`mt-0.5 flex-none ${m.tono === "error" ? "text-negativo" : "text-positivo"}`}
        />
      )}
      <p className="max-w-80 text-cuerpo text-texto">{m.texto}</p>
      <button
        onClick={() => quitar(m.id)}
        aria-label={t().aviso.cerrar}
        className="-mr-1 ml-1 flex-none rounded-full p-0.5 text-tenue hover:text-texto"
      >
        <X size={14} strokeWidth={1.75} />
      </button>
    </div>
  );
}

export function Avisos() {
  const lista = useAvisos((s) => s.lista);
  return (
    <div className="pointer-events-none fixed bottom-4 left-4 right-4 z-[60] flex flex-col items-start gap-2 sm:bottom-5 sm:left-5 sm:right-auto">
      {lista.map((m) => (
        <div key={m.id} className="pointer-events-auto">
          <Item m={m} />
        </div>
      ))}
    </div>
  );
}
