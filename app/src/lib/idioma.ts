// Idioma de la interfaz. Lo comparten el programa (i18n.ts) y el instalador.

export type Idioma = "es" | "en";

/** "es" si el texto empieza con "es" (es, es-CL, es-419…); cualquier otro, "en". */
export function idiomaDe(texto: string | null | undefined): Idioma {
  return (texto ?? "").toLowerCase().startsWith("es") ? "es" : "en";
}

/** Cifras en español de Chile (1,24 GB) o en inglés (1.24 GB). */
export const localeDe = (idioma: Idioma) => (idioma === "es" ? "es-CL" : "en-US");
