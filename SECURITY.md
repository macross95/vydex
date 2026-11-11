# Seguridad de Vydex

## Reportar una vulnerabilidad

No abras un issue público. Usa **[Report a vulnerability](https://github.com/macross95/vydex/security/advisories/new)** en la pestaña Security del repositorio: el reporte queda privado entre tú y el autor.

Incluye la versión de Vydex, el sistema operativo y los pasos para reproducirlo.

## Versiones con soporte

Solo la última versión publicada en [Releases](https://github.com/macross95/vydex/releases/latest) recibe correcciones.

## Cómo se protege Vydex

- Todo ocurre en el computador de la persona: sin cuentas, servidores intermedios ni telemetría.
- yt-dlp se ejecuta sin consola ni configuración externa (`--ignore-config --no-plugin-dirs --no-remote-components`) y el enlace va siempre después de `--`.
- yt-dlp, Deno y FFmpeg se verifican contra huellas SHA-256 fijadas en `app/scripts/motores.lock.json`.
- El instalador de Windows corre sin permisos de administrador, busca sus DLL solo en System32 y nunca borra una carpeta que no sea una instalación de Vydex.
- Cada versión publica `SHA256SUMS.txt` para verificar los instaladores.
