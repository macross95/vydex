// La ventana de la portada muestra la demo real de Vydex. En pantallas anchas se dibuja a
// 1280 px y en el teléfono a 430 px (la interfaz de Vydex se adapta), y se escala para entrar
// completa en el ancho disponible.
const lienzo = document.querySelector("[data-lienzo]");

function ajustar() {
  if (!lienzo) return;
  const telefono = window.innerWidth < 640;
  // En el teléfono, al ancho exacto de la ventana (sin escalar); en pantallas anchas, a 1280 px.
  const base = telefono ? lienzo.clientWidth : 1280;
  const altoBase = telefono ? 900 : 860;
  const escala = lienzo.clientWidth / base;
  lienzo.style.setProperty("--base-ancho", `${base}px`);
  lienzo.style.setProperty("--base-alto", `${altoBase}px`);
  lienzo.style.setProperty("--escala", String(escala));
}
ajustar();
if (lienzo) new ResizeObserver(ajustar).observe(lienzo);
