import { useVydex } from "./tienda";
import { TEXTOS } from "./i18n";

/** Textos del idioma elegido; el componente se vuelve a dibujar al cambiar de idioma. */
export function useT() {
  const idioma = useVydex((s) => s.ajustes.idioma);
  return TEXTOS[idioma];
}
