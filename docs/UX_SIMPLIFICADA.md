# Experiencia simplificada — rama `ux-simplificada`

Fecha: 1 de noviembre de 2026. Base: `sprint-1` (`466abb4`).

Quienes probaron la versión funcional dijeron que costaba más aprenderla que la demo
de `main`. Las causas que encontramos en el código y en el paquete de prueba:
mucho texto de advertencia en cada tarjeta, un lugar distinto para subir cada tipo
de archivo, facturas de una en una, un CSV que sólo aceptaba un formato exacto (y que
había que corregir en Excel), y un perfil fiscal que se llenaba a mano.

## Qué cambió

- **Un solo botón «Subir archivos»** (también se puede arrastrar a cualquier parte de
  la página). Acepta varias facturas XML, PDF, fotos y el estado de cuenta CSV a la
  vez; la app detecta cada tipo, procesa primero los XML y muestra el resultado de
  cada archivo: vinculada a qué movimiento, ya estaba cargada o por qué no se guardó.
- **Inicio = lo que hay que hacer**: título con el número de pendientes, tres cifras
  (entró, salió, con factura) y la lista de pendientes con su botón: «Elegir factura»,
  «Subir factura» o «Volver a buscar». Sin pendientes: «Todo al día».
- **Movimientos y Documentos** son listas con filtros (Todos / Pendientes / Con
  factura) y búsqueda. Cada tarjeta dice su estado en dos o tres palabras.
- **Estados con nombres cotidianos**: Con factura, Elige la factura, Sin factura,
  Búsqueda pausada. Si la factura que coincide ya está vinculada a otro movimiento,
  se dice así («Una factura sólo explica un movimiento»).
- **Avisos breves** al guardar, quitar o volver a buscar, en lugar de párrafos fijos.
- **Menú de cuenta** con descargas (Excel para el contador, copia de seguridad,
  recuperación), «Acerca de», reiniciar ejemplos y cerrar sesión.
- Barra de navegación inferior en móvil; sin desplazamiento horizontal a 375 px.

## Lo que ahora se hace solo

- **Perfil desde las facturas**: al crear la cuenta se suben algunos XML y la app toma
  el RFC que aparece en todos, el nombre y el régimen declarado. Si no es seguro (un
  solo XML), pregunta «¿Cuál de estos eres tú?». Después guarda esas facturas.
- **Estados de cuenta de cualquier banco**: detecta separador (`,` `;` tabulador `|`),
  filas de encabezado del banco antes de la tabla, columnas como Fecha, Concepto,
  Referencia, Cargo/Abono, Importe o Saldo (ignorada), separadores de miles, decimales
  con coma, `(116.00)`, `116.00-`, fechas `dd/mm/aaaa`, `08-oct-2026`, años de dos
  dígitos y archivos guardados por Excel en Windows-1252. Las filas «Total» se omiten.
- **Errores del CSV se corrigen dentro de la app**: la fila con error se edita o se
  quita ahí mismo; no se guarda nada hasta resolverlas. El identificador de cada
  movimiento es el mismo que tendría el archivo corregido, así que volver a subirlo
  no duplica nada (también si Excel cambió el formato de fechas y montos).
- **«Subir factura» desde un movimiento** abre el selector de archivos directamente y
  explica el resultado para ese movimiento: vinculada, coincide con otro, importe
  diferente, o factura emitida frente a un pago.
- **Tickets**: si el desglose sólo omite un importe y el total aparece, se completa
  con la suma (subtotal + IVA − retenciones = total). Nada más se supone.

## IA con Claude

Se usa sólo donde ahorra trabajo, y sólo en cuentas con sesión (la demo pública no
gasta tokens):

1. **Leer tickets y PDF** (`/api/ai/extract`): el archivo va a Claude, que devuelve
   proveedor, RFC, fecha, importes y concepto con salida estructurada. El servidor
   descarta el RFC del propio cliente, fechas imposibles, porcentajes y monedas
   distintas de MXN. La persona revisa antes de guardar. Si la IA falla, se usa la
   lectura local (PDF.js/Tesseract) con un aviso.
2. **Asistente**: responde con los datos calculados por la app (pendientes, totales por
   moneda, documentos recientes). No determina deducciones ni impuestos. Sin IA o al
   agotar la cuota, responde con las reglas existentes.

Configuración (variables del servidor, nunca en el navegador):

- `ANTHROPIC_API_KEY`: activa la IA. Sin ella todo funciona como antes, sin IA.
- `FACTURIA_AI_MODEL`: `claude-haiku-5-5` (predeterminado) o `claude-sonnet-5-5`.
- `FACTURIA_AI_DAILY_LIMIT`: tope global diario (predeterminado 300 solicitudes).
- Límites por cuenta: 30 lecturas y 40 preguntas por hora.

Se retiró la IA local experimental (WebLLM, descarga de ~320 MB) y su dependencia.

## Cómo probar

`npm run check`, luego `/demo` y `/workspace`. El recorrido con el paquete de
`docs/prueba-usuario` se comprobó en local (PostgreSQL, cuenta sintética nueva):
perfil detectado desde 4 XML (RFC `XAXX010101000`, régimen 601); CSV editado en Excel
con la fecha imposible corregida en la app (7 movimientos) y resubida sin duplicar;
Imprenta vinculada desde «Subir factura»; Publicidad y Mantenimiento resueltos con
«Elegir factura»; quitar y volver a buscar Papelería; ticket PDF leído, corregido y
guardado con su original; pago parcial y nota de crédito sin cambiar movimientos;
descargas y cierre de sesión. La lectura con Claude se probó con respuestas grabadas
(sin clave en local); falta probarla en staging con la clave real.

## Pendiente

- Configurar `ANTHROPIC_API_KEY` en staging y desplegar esta rama.
- Vincular manualmente un ticket/PDF a un movimiento (hoy sólo se vinculan XML).
- Guardar un ticket que sólo muestra el total (el servidor exige el desglose).
- Asignar columnas a mano cuando un CSV no tiene encabezados reconocibles; leer `.xlsx`.
- `npm audit` reporta vulnerabilidades previas en `next` (crítica), `zod`, `nodemailer`
  y `eslint`; corregirlas en un cambio aparte.
- La prueba de comprensión con usuarios nuevos sigue siendo la validación real.
