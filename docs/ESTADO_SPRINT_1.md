# Estado del sprint — 13 de octubre de 2026

Trabajo publicado en `sprint-1` del repositorio público, con autoría de la cuenta
GitHub `d1512pb` del usuario y sin coautores de IA. `main` permanece intacto;
no se creó PR ni se hizo merge. PostgreSQL local está habilitado y migrado.
Railway staging está activo con datos sintéticos y límite duro de USD 10
para recursos de todo el workspace.

## Frontend y experiencia de usuario — 13 de octubre

Primera iteración publicada y comprobada en staging:

- Inicio explica documentos/movimientos y ofrece el siguiente paso según los
  registros; los pendientes abren la lista con el filtro correspondiente.
- Estados cotidianos, causas y acciones reales: Con documento vinculado,
  Revisar coincidencia, Sin documento vinculado y Volver a buscar.
- Agregar comprobante conserva el movimiento y muestra el resultado al guardar;
  un vínculo no se anuncia por el mero hecho de cargar un XML.
- Facturas emitidas/recibidas se distinguen por RFC; bancos muestran entradas,
  salidas y diferencia por moneda y fechas cargadas, sin atribuir saldo real.
- Pagos priorizan importes y saldos de ese documento, con códigos en datos
  secundarios. SAT distingue sin consultar/no encontrado/fallo/respuesta.
- Plantilla CSV compatible con el parser; captura manual deja impuestos
  desconocidos vacíos. Descargas y recuperación quedan en una zona secundaria.
- Régimen se elige explícitamente, sin heredar elección de otra cuenta. Diálogos
  permiten teclado/Escape y devuelven foco; móvil ajusta cabecera y destinos.

La revisión local comprobó filtro, comparación, vínculo, quitar/volver a buscar,
carga XML con contexto, apertura del resultado y reinicio a seis documentos y
cinco movimientos. Los hallazgos de foco tras resolver y desbordamiento a 320 px
se corrigieron y se comprobaron en la compilación final: sin desbordamiento
horizontal a 320 px, foco en movimientos y aviso visible después de vincular,
quitar vínculo y volver a buscar. Teclado/Escape conserva el foco del diálogo.
No se modificaron el motor, los estados persistidos, el SQL ni las integraciones.
La prueba de comprensión del dueño está pendiente, junto con el resto del
plan UX: navegación separada, mapeo CSV, perfil incompleto, captura simplificada,
revisión completa de accesibilidad, zoom y más dispositivos.
Validación local: **407/407 pruebas**, lint, TypeScript y compilación aprobados.
Auditoría npm completa: cero vulnerabilidades conocidas. Publicado como
`cf56569d88c19be18d845b700666557966a60f28`, con
[CI aprobado](https://github.com/itnelimipi-rgb/FacturIA/actions/runs/38497611693).
La plantilla CSV se probó en interfaz: vista previa sin guardar, confirmación de
dos registros y reinicio a cinco movimientos. Deployment
`bdd26a3a-2f57-4176-be95-2800b827ce5c`: **SUCCESS**. Pasaron ocho comprobaciones
HTTPS con cuentas anteriores y cinco preguntas de ayuda por reglas, con datos
intactos y sesiones invalidadas. Una nueva cuenta sintética empezó sin perfil ni
registros. Su primer uso detectó reutilización del correo en el campo RFC; la
corrección separa los formularios y volvió a pasar 407 pruebas, lint, tipos y build;
publicada como `860974488a41017cd4d9b3f14a50cdac76b9d6bf`, con
[CI aprobado](https://github.com/itnelimipi-rgb/FacturIA/actions/runs/38500342854).
Deployment `62ca96bd-0b66-4921-bf51-b882cad71706`: **SUCCESS**, fijado a ese
commit. La repetición visual confirmó RFC/nombre vacíos, régimen requerido sin
preselección y opción de copiar un código cuando no aparece en la lista. El
perfil sintético guardado persistió al recargar; el Inicio vacío propone ambos
tipos de carga y no inventa un saldo bancario. La sesión se cerró y la demo quedó
con seis documentos/cinco movimientos, tres vinculados/uno por revisar/uno sin
documento. Evidencia visual de Inicio y cuenta vacía guardada en los artefactos
del chat, sin publicar credenciales ni archivos privados en el repositorio.
No se añadieron dependencias ni recursos de Railway.
Consumo de recursos del workspace leído el 13 de octubre a las 20:42 (Ciudad
de México): **USD 0.0654**, con límite duro **USD 10** activo y sin excederlo.
El nuevo ciclo va del 13 de octubre al 13 de noviembre a las 13:13; USD 6.60
corresponde a la lectura histórica del ciclo anterior.

## Incremento del 11 de octubre implementado en código

### Documentos relacionados y pagos — 12 de octubre

- Lectura de `CfdiRelacionados` y método PUE/PPD; detalle y listado distinguen
  ingreso, egreso/nota de crédito, pagos, nómina y traslado.
- Pagos 2.0 en CFDI 4.0: Monto/MonedaP, UUID/MonedaDR, parcialidad y saldos
  declarados. Decimales preservados como texto y comprobaciones con BigInt.
  Rechaza un CFDI P sin Pagos, referencias/namespace falsos, saldos incoherentes,
  subtotal pagado en la moneda del pago superior a Monto y total MXN inconsistente.
- Total XML P cero/XXX separado del monto del pago. El panel suma XML I por
  moneda y muestra notas E aparte; E/P no se convierten en movimientos ni se
  concilian automáticamente. La demo inicial conserva seis comprobantes y cinco
  movimientos. CSV de comprobantes con tipos/relaciones/importes separados.
- Metadatos conservados en demo, JSON y PostgreSQL; restaurar interpreta el XML
  original y descarta metadatos de pago falsificados por el respaldo.

Fuentes técnicas: [CFDI 4.0](https://www.sat.gob.mx/sitio_internet/cfd/4/cfdv40.xsd)
y [Pagos 2.0](https://www.sat.gob.mx/sitio_internet/cfd/Pagos/Pagos20.xsd).
Alcance documental: no valida XSD completo, sellos, catálogo íntegro o impuestos
del complemento; no emite CFDI ni determina deducciones. EquivalenciaDR entre
monedas distintas se muestra declarada, sin conciliar la conversión de saldos.
Pagos 1.0 y CFDI 3.3 de pago quedan fuera de este incremento. Límite: 100 pagos,
1,000 documentos relacionados y 20 grupos de relaciones por XML; la UI muestra
listas acotadas y remite al original para revisar el resto.
Validación local: **373 pruebas**, lint, TypeScript y build aprobados; auditoría
npm completa con cero vulnerabilidades conocidas. Las pruebas incluyen JSONB,
restauración desde XML, entradas malformadas y ausencia de movimientos o vínculos
bancarios creados por E/P. Publicado como
`561566cc8f71de6d46546fd9d8a601910f78cab0`, con
[CI aprobado](https://github.com/itnelimipi-rgb/FacturIA/actions/runs/38338464649).
Railway confirmó SUCCESS del deployment `568ff73d-a31f-4ef1-a88a-adfac19fa25a`,
fijado a ese SHA sólo en staging; su suspensión automática posterior es esperada.
Pasaron **22 comprobaciones HTTPS de este incremento**: 14 del flujo documental
con dos cuentas nuevas, cuatro después de reiniciar web y cuatro con cuentas
anteriores. Incluyen originales, aislamiento, metadatos, restauración canónica,
idempotencia y ausencia de conciliación automática de E/P. PostgreSQL no se reinició.
La interfaz mostró pago de 58 MXN separado del total XML cero/XXX, parcialidad
y saldos declarados, referencias propias y notas E separadas en el panel.
La descarga real del CSV conservó los nueve comprobantes sintéticos de la prueba.
La demo se restableció después a sus seis comprobantes y cinco movimientos,
con tres conciliados y neto bancario 14,490 MXN. No se amplió infraestructura.
Correos, dominio/remitente y WhatsApp permanecen pospuestos por el usuario.
Consumo total del workspace comprobado a las 21:36 del 12 de octubre (Ciudad
de México): USD 6.60, con límite duro USD 10 activo y sin excederlo.

### Guías de revisión — 12 de octubre

El asistente por reglas explica cómo revisar candidatos y los estados conciliado,
ambiguo y discrepancia, y cómo importar XML/CSV o confirmar PDF/imágenes como
gastos provisionales. Usa los controles existentes de la app y distingue el vínculo
documental de la vigencia o deducibilidad. Incluye el caso de un CFDI disputado por
varios movimientos. Las preguntas mixtas y fiscales conservan la ruta protegida.
El modelo recibe la misma información de ayuda, sin datos cuantitativos privados;
la explicación circular observada queda rechazada por una prueba de regresión.
La suite ampliada pasó **281 pruebas**, lint, TypeScript y build. Código publicado
como `7c3fb8eba0a21cf806e8412f34fa2444c648bf61`, con
[CI aprobado](https://github.com/itnelimipi-rgb/FacturIA/actions/runs/38220560236).
Railway confirmó SUCCESS del deployment `93a418c7-e6d1-4790-b979-ae0ab78a3f04`,
fijado a ese SHA sólo en staging. Pasaron cinco comprobaciones HTTPS de ayuda,
resumen, egresos, límite fiscal y pregunta mixta, y cuatro de persistencia,
aislamiento y logout. Son **43 comprobaciones HTTPS acumuladas** del incremento:
34 previas y nueve en esta versión.
La interfaz mostró la guía útil sin IA y el resumen 3/1/1 por reglas con IA activa.
La explicación local rechazada recuperó automáticamente la guía por reglas. La
cancelación explícita detuvo el modelo y volvió a reglas sin iniciar otra respuesta.
El modelo pequeño sigue experimental; esta prueba no garantiza calidad lingüística
ni compatibilidad en otros dispositivos.

### Corrección del asistente — 12 de octubre

El checkpoint `98b135f` pasó CI y está desplegado con SUCCESS en
`8136e018-7442-4b58-bd51-d4522b453d6c`. La carga del modelo y una inferencia
real funcionaron en el navegador. La revisión detectó que mezcló comprobantes
con movimientos y enumeró seis cuando la demo tiene cinco. Ese resultado no es
válido y motivó esta corrección:

- Cifras, conteos, listados, presencia de registros y resúmenes se consultan mediante
  reglas, aun con IA activa. Sólo las preguntas claras de ayuda o significado de
  estados llegan al modelo; preguntas fiscales o mixtas usan reglas.
- El modelo sólo recibe presencia de estados y monedas, sin importes, fechas,
  conteos ni identificadores. Se limita a explicar cómo revisar los estados.
- Respuestas con cifras, cantidades escritas o referencias DOC/MOV se rechazan;
  se intenta una respuesta por reglas. Un fallo del worker o timeout también permite
  esa recuperación; cancelar explícitamente no inicia una consulta automática.

La corrección pasó **276 pruebas**, lint, TypeScript y build. Incluye regresiones
del listado inventado, preguntas mixtas, recuperación de fallos y el falso positivo «Si ves…».
Se publicó como `b252d045ba40a2247630503e1bc7d97afcdac61f`, con
[CI aprobado](https://github.com/itnelimipi-rgb/FacturIA/actions/runs/38217311426).
Railway confirmó SUCCESS de `0049720b-2832-4f7b-80b9-a0cea3c0c759`, fijado
a ese SHA. Pasaron cuatro comprobaciones HTTPS de salud, aislamiento, persistencia
y logout con cuentas anteriores: **34 acumuladas** en este incremento (26 iniciales,
cuatro en `98b135f` y cuatro en `b252d04`). La demo conserva seis comprobantes y
cinco movimientos. Con IA activa, la interfaz respondió el resumen 3/1/1 mediante
reglas; la pregunta de ISR devolvió el límite fiscal sin cálculo inventado. También
se observó recuperación automática a reglas tras rechazar una respuesta local.
La explicación del modelo sobre un movimiento ambiguo resultó circular: se añadió
una guía basada en el flujo real de la app al contexto del modelo y ayuda equivalente
por reglas, con regresión del texto observado. Esa mejora quedó publicada y
verificada en `7c3fb8e`, como se registra arriba.
Las evidencias históricas siguientes conservan su fecha y alcance.

- PDF.js lee PDF y Tesseract.js realiza OCR en español en el navegador. Workers,
  WASM y datos del idioma se sirven desde la app; no se usa una API OCR paga.
  Archivos de hasta 5 MiB, imágenes de 5 millones de píxeles, 10 páginas con texto
  o 3 escaneadas, lectura de 60 segundos y cancelación. Los campos detectados son
  editables y se confirman antes de guardar; impuestos desconocidos permanecen
  vacíos, sin IVA calculado ni UUID inventado.
- Originales privados PDF/PNG/JPEG/WebP en PostgreSQL: 5 MiB por archivo,
  20 archivos y 25 MiB por cuenta. Metadatos y hash SHA-256; descarga por sesión
  y propietario como adjunto, con `no-store`, `nosniff` y CSP `sandbox`.
  Una clave de idempotencia conserva el mismo registro ante un reintento;
  reutilizarla con otro contenido o importes se rechaza sin cambiar datos.
- Consulta SOAP al servicio oficial SAT de un XML propio, con resultado fechado,
  vigencia y EFOS únicamente según la respuesta. Fallos de transporte o un CFDI
  no encontrado conservan `no_verificado`. No valida XSD, sellos o timbre ni
  emite facturas. No sincroniza una lista EFOS completa.
- IA local opcional y experimental mediante WebLLM/Qwen2.5 0.5B y WebGPU:
  descarga aproximada de 320 MB del modelo desde Hugging Face y MLC, sin clave
  de API ni servidor GPU. Reglas e indicadores deterministas permanecen como
  referencia; las respuestas del modelo no acreditan importes ni decisiones
  fiscales. La inferencia real y compatibilidad de dispositivos siguen por probar.
- Correo de verificación y recuperación de contraseña implementados, sin activar
  entrega hasta configurar y probar un remitente autorizado. Resend HTTPS es la
  opción preferida en Railway Hobby, donde SMTP saliente no está disponible.
  SMTP con TLS queda para entornos que lo permitan. Un proveedor sin configurar
  devuelve indisponibilidad y no anuncia un envío ficticio.
- Cuotas compartidas en PostgreSQL para autenticación, originales, consultas
  SAT y envíos de correo; el contador no depende de memoria de una sola réplica.

**Verificación local inicial del incremento:** 262 pruebas, lint, TypeScript y build aprobados;
auditoría npm completa sin vulnerabilidades conocidas. PDF.js y Tesseract/WASM
leyeron realmente los fixtures sintéticos. El flujo con PostgreSQL local aprobó
14 comprobaciones HTTP, incluida respuesta SAT oficial N602 para un XML sintético,
aislamiento de originales y reintentos idempotentes.

La recuperación completa de PostgreSQL local coincidió en 11 tablas, esquema y
contenido, incluido el PDF original. La comprobación de carga en el clon usó 200
documentos, 200 movimientos y 20 lecturas a concurrencia 2; p50 204 ms y p95 358 ms.
Consultar [el ensayo de recuperación](RECUPERACION_POSTGRES.md) para límites y
custodia privada. El CI del commit `4b09262` aprobó y Railway confirmó SUCCESS
del deployment `4e2c291e-456d-4407-a5e1-e6b1016ef9a8`.

La versión pasó 26 comprobaciones HTTPS: 14 iniciales, cuatro después de reiniciar
sólo web y ocho de cuentas anteriores. PDF/hash, XML, consulta SAT, propietarios,
vínculos, pausas y sesiones persistieron; también persistió el rechazo de cuota
SAT dentro de su ventana de un minuto. La interfaz leyó PDF/OCR sintéticos,
rechazó total inconsistente y se revisó a 390 × 844 sin desbordamiento horizontal.
La demo conservó su escenario inicial. Login y consulta SAT por botón funcionaron.

La activación de WebLLM falló en este navegador; el asistente por reglas siguió
respondiendo 3 conciliados, 1 ambiguo y 1 en discrepancia. No se acredita inferencia
del modelo. Se corrigió el diagnóstico de errores del worker como texto: ahora
clasifica descarga, GPU, almacenamiento, configuración, cancelación y timeout
mediante códigos permitidos. Sólo registra código y fase, sin texto crudo ni
secretos. Nueve pruebas adicionales cubren strings reales del SDK, redacción,
cancelación y rechazos tardíos. La nueva revisión visual se hará al desplegarlo.

El usuario pidió posponer dominio y correo real el 11 de octubre. El transporte
de correo se conserva desactivado; sus pruebas usan un proveedor simulado y
ningún correo se envió desde esta etapa.

El JSON de respaldo mantiene los XML originales y campos documentales,
**sin bytes de PDF o imágenes**. Descargar esos originales por separado o usar
un respaldo completo de PostgreSQL que incluya `app_document_files`.
Una restauración JSON no equivale a recuperar la base, las cuentas o las sesiones.

## Checkpoint anterior — verificado localmente el 8 de octubre

- `npm run check`: lint, TypeScript, **193 pruebas** y build de producción pasan.
- `npm audit`: cero vulnerabilidades conocidas reportadas, incluidas dependencias
  de desarrollo, en la consulta de esta fecha.
- XML originales, CSV con centavos/fechas reales, perfil, gastos provisionales,
  conciliación, ambigüedades, desvinculación y reanudación de búsqueda.
- BetterAuth con cookies firmadas y SQL ejecutado en PostgreSQL embebido PGlite:
  dos cuentas, aislamiento, identidad de sesión, CSRF, duplicados, rollback,
  cuotas, cierre de sesión y rechazo de cuerpos inválidos o demasiado grandes.
- SQL por lotes para movimientos; índices, restricciones de propietario y
  vínculos únicos. Importaciones repetidas conservan el estado del usuario.
- Demo y espacio autenticado tienen almacenamientos distintos; el espacio
  personal no carga las muestras de demostración.
- Exportación JSON v1 autenticada con XML originales propios, snapshot consistente
  sin escrituras, descarga de hasta 25 MiB y CSV protegido frente a fórmulas.
- Servidor local de producción con PostgreSQL 18: dos cuentas sintéticas, cookies,
  origen, identidad, XML/CSV, duplicados, conciliación, exportación y logout.
  El script `scripts/verify-workspace-http.mjs` permite repetir el flujo por HTTP.
- Cluster local conservado en `.facturia-local/postgres`, fuera de `node_modules`
  e ignorado por Git. Las mismas cuentas y registros pasaron la verificación HTTP
  tras mover el cluster y reiniciar la aplicación; `.env.local` no cambió.
- Una regresión de 101 CFDI candidatos confirma que contratos y exportaciones
  admiten ambigüedades dentro del límite acumulado de documentos.
- Restauración JSON v1 con vista previa y confirmación, perfil del mismo RFC y
  espacio vacío. Se reparsan XML, recalculan importes y conciliaciones, preservan
  pausas/alertas y descartan credenciales. La cuenta actual conserva su perfil.
- Guardado de restauración atómico con bloqueo por cuenta y una entrada de
  auditoría. Pruebas SQL verifican que un conflicto tardío revierta documentos,
  movimientos y auditoría, y que otra importación posterior a la vista previa
  impida sobrescribir datos. Los IDs CSV reconocidos conservan deduplicación
  al migrar a otra cuenta del mismo RFC, incluidas filas repetidas legítimas.
- PostgreSQL local: **13 comprobaciones HTTP de restauración** y **cuatro tras
  reiniciar la aplicación**. La vista previa no escribe; dos solicitudes
  simultáneas guardan una sola copia. Reimportar el CSV conserva IDs, vínculos y
  pausas. Nuevas sesiones después del reinicio recuperan el XML original y los
  registros restaurados. El script `scripts/verify-restore-http.mjs` repite este
  ensayo con cuentas sintéticas y estado privado ignorado por Git.

## Checkpoint anterior — verificado en Railway

- [Demo](https://web-staging-b090.up.railway.app/demo) y
  [espacio personal](https://web-staging-b090.up.railway.app/workspace) disponibles
  en el proyecto `facturia-staging`, entorno `staging`.
- Deployment exacto `201f3e6b-e8ae-41ad-965e-3865a5c13813`: **SUCCESS**, fijado al
  commit `2916f18f2ae014e3ebac3d1b368db90d1b8869f4` de `sprint-1`. Su
  [CI en GitHub](https://github.com/itnelimipi-rgb/FacturIA/actions/runs/37875161206)
  pasó. Predeploy ejecutó `db:migrate` con el esquema ya aplicado;
  `/api/health` respondió HTTP 200 en modo `workspace`.
- **15 comprobaciones HTTP externas de la primera versión**: 11 del flujo
  inicial y cuatro después de reiniciar el servicio web. Se verificaron cookies `Secure`, `HttpOnly` y
  `SameSite`, dos cuentas aisladas, origen/CSRF, identidad de sesión,
  pertenencia del XML, duplicados XML/CSV, conciliación y desvinculación,
  gastos provisionales, exportación propia con XML originales y logout.
- **Cuatro comprobaciones de las cuentas anteriores tras actualizar staging**:
  nuevas sesiones recuperan los perfiles, documentos, movimientos y XML privados.
- **13 comprobaciones HTTPS de restauración y cuatro tras reiniciar web**:
  respaldos de cuenta y RFC válidos, sesión/origen, vista previa sin escritura,
  rechazo de destino ocupado y XML corrupto, guardado único ante dos solicitudes
  simultáneas, documentos propios, XML original exportable, vínculo y pausa
  preservados, CSV reimportado sin duplicar y logout. Esto suma **36 comprobaciones
  externas de los scripts**, incluidas las 15 de la primera versión.
- Reinicio de este deployment observado a `2026-10-09T02:56:13Z`, sin reiniciar
  PostgreSQL. Los registros restaurados persistieron con nuevas sesiones. La
  prueba acredita recuperación JSON de documentos/movimientos y persistencia de
  la aplicación; no acredita recuperación completa de la base PostgreSQL.
- `/demo` y `/workspace` respondieron HTTP 200/HTML. La demo no incorpora los
  controles de restauración del espacio personal; esto no sustituye revisión visual.
- Una instancia web con 500 MB RAM/0.5 CPU y suspensión automática; PostgreSQL
  privado con 250 MB RAM/0.25 CPU y volumen persistente de 5000 MB, sin TCP público.

Publicar nuevos puntos de guardado en `sprint-1` no actualiza automáticamente
staging: el servicio está fijado al SHA anterior. Para probar otro commit,
revisar checks, actualizar el pin sólo en staging y comprobar ese deployment.

## Pendiente antes de main

- Confirmar CI en GitHub para el commit final que se proponga promover a main.
- Ensayar recuperación en el destino definitivo, definir retención y copia
  cifrada fuera de la PC y medir carga HTTP antes de admitir datos reales.
  El ensayo local completo y la concurrencia de dos restauraciones JSON pasaron.
- Ampliar las pruebas visuales a los navegadores y dispositivos objetivo. La
  revisión de staging cubrió PDF/OCR, error de total, formulario móvil, login,
  detalles privados, consulta SAT y respuesta por reglas; no acredita toda la app.
- Configurar y verificar entrega de correo, dominio/remitente autorizado e
  invitaciones antes de ampliar el piloto. Las cuotas compartidas ya están
  implementadas; su evidencia en la versión nueva se registrará tras las pruebas.
- Ampliar las pruebas de inferencia, calidad y fallos/cancelación de WebLLM a los
  navegadores y dispositivos objetivo. La prueba real en este navegador no acredita
  rendimiento o compatibilidad general; el modelo pequeño continúa experimental.
- Revisar limitaciones y obtener aprobación del usuario para promover a main.

OCR/PDF, consulta SAT e IA local tienen implementación en este incremento;
su alcance y validación final se distinguen de los resultados anteriores.
Bancos, WhatsApp, complementos y reglas fiscales permanecen en el
[plan de avance](PLAN_AVANCE.md). No hay documentos fiscales reales,
secretos ni credenciales SAT incluidos en este punto de avance.

Para continuar, leer el [entorno de staging](STAGING.md) y las
[notas de coordinación](COORDINACION.md). GitHub CI y las pruebas locales no
sustituyen los requisitos pendientes para producción.
