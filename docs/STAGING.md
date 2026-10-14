# Entorno de pruebas en Railway

El usuario autorizó staging y un límite duro de USD 10 para recursos de todo el
workspace. El límite quedó aplicado y comprobado el 8 de octubre de 2026. Al
alcanzarlo Railway detiene los servicios del workspace, incluidos otros proyectos.
Railway Agent e impuestos tienen tratamiento independiente: no ejecutar Agent
ni contratar integraciones adicionales sin revisar el presupuesto.
También hay PostgreSQL local aislado para desarrollar sin depender de staging.

## Primer uso y revisión comprensible — 13 de octubre

Código publicado en `sprint-1` como `cf56569d88c19be18d845b700666557966a60f28`,
con autoría y committer de Danipb15, sin coautores. Pasaron **407/407 pruebas**,
lint, TypeScript y compilación; auditoría npm completa sin vulnerabilidades.
[CI aprobado para ese commit](https://github.com/itnelimipi-rgb/FacturIA/actions/runs/38497611693).
Inicio propone acciones según los registros; estados, importes y guías usan los
controles reales. Los pagos, facturas y movimientos bancarios quedan distinguidos.
CSV ofrece una plantilla y confirma antes de guardar; captura provisional deja
impuestos desconocidos vacíos. Los respaldos y datos técnicos quedan secundarios.

Recorrido local: filtros desde Inicio, comparar candidatos, vincular/quitar/volver
a buscar, XML con contexto y apertura del documento guardado, teclado/Escape,
plantilla con dos movimientos y reinicio a seis documentos/cinco movimientos,
con tres vinculados/uno por revisar/uno sin documento. A 320 px se comprobó
ausencia de desbordamiento horizontal y aviso/foco visibles después de una acción.
La comprobación móvil adicional se hizo a 390 px; no sustituye una auditoría
completa de dispositivos, zoom o accesibilidad ni la prueba de comprensión del dueño.

Sólo se cambió el SHA de fuente de web en staging; no hay migraciones nuevas,
dependencias, servicios ni proveedores externos adicionales. Se revisó el patch
antes de aplicarlo: un cambio de web, sin variables o recursos ajenos.
Deployment `bdd26a3a-2f57-4176-be95-2800b827ce5c`: **SUCCESS**, fijado al SHA
publicado. Pasaron ocho comprobaciones HTTPS de persistencia de documentos,
originales, metadatos, aislamiento, exportación y cierre de sesiones anteriores.
Cinco preguntas de ayuda pasaron por reglas, incluidas las preguntas mixtas
fiscales; documentos, movimientos y perfil quedaron intactos al preguntar.
Una cuenta sintética nueva empezó sin perfil ni registros. El recorrido de
interfaz detectó que, al pasar de acceso a perfil, React reutilizaba el input del
correo en el RFC. La corrección separa el ciclo de vida de los formularios y
volvió a pasar 407 pruebas, lint, tipos y build local. Publicada como
`860974488a41017cd4d9b3f14a50cdac76b9d6bf`, con
[CI aprobado](https://github.com/itnelimipi-rgb/FacturIA/actions/runs/38500342854).
Deployment `62ca96bd-0b66-4921-bf51-b882cad71706`: **SUCCESS**, fijado a ese
commit. Se repitió el acceso de la cuenta sin perfil en la versión desplegada:
RFC/nombre vacíos, régimen requerido sin preselección y campo de código cuando
se elige «Mi régimen no aparece». Guardar un perfil sintético abrió un Inicio
sin documentos ni movimientos; recargar conservó el perfil y cerrar sesión
regresó al acceso. Se dejó la demo intacta con seis documentos/cinco movimientos
y distribución tres vinculados/uno por revisar/uno sin documento. Capturas reales
de Inicio y cuenta vacía guardadas como artefactos del chat. Credenciales sólo en
caché ignorada; no se añadieron archivos privados al repositorio.

Consumo del workspace leído el 13 de octubre a las 20:42 (Ciudad de México):
**USD 0.0654**, límite duro **USD 10** activo, `isOverLimit: false`.
Nuevo ciclo: 13 de octubre → 13 de noviembre a las 13:13. La lectura histórica
de USD 6.60 corresponde al ciclo anterior. Correos, remitente/dominio y WhatsApp
siguen pospuestos por el usuario.

## Documentos relacionados y Pagos 2.0 — 12 de octubre

Publicado en `sprint-1` como `561566cc8f71de6d46546fd9d8a601910f78cab0`, con
[CI aprobado](https://github.com/itnelimipi-rgb/FacturIA/actions/runs/38338464649).
Pasaron 373 pruebas, lint, tipos y build; auditoría npm completa sin vulnerabilidades.
Lectura de relaciones, método PUE/PPD y pagos/parcialidades declaradas. El detalle
separa XML P cero/XXX del monto pagado; panel separa I y E, y CSV de comprobantes
conserva esas columnas. Respaldos revalidan el XML al restaurar los metadatos.
No requiere una migración SQL, proveedor externo ni nuevos servicios.
Se mantienen conciliación automática exclusivamente I y saldos entre distintas
MonedaDR como datos declarados, sin validar su conversión. No acredita XSD completo,
sellos, impuestos del complemento ni emisión de CFDI.
Deployment `568ff73d-a31f-4ef1-a88a-adfac19fa25a`: **SUCCESS**, fijado al SHA
publicado. La suspensión automática posterior (`SLEEPING`) conserva ese deployment.
Pasaron **22 comprobaciones HTTPS de este incremento**: 14 con dos cuentas
sintéticas nuevas, cuatro de persistencia tras reiniciar sólo web y cuatro con
cuentas anteriores. Se verificaron importación I/E/P, XML originales, metadatos,
aislamiento, restauración desde XML, idempotencia y conciliación sólo de I.
PostgreSQL no se reinició.

La revisión de interfaz confirmó total P cero/XXX separado de 58 MXN de pago,
parcialidad 1 y saldos declarados 116/58/58, así como referencias al documento I
de la misma cuenta. La nota E mostró sus UUID relacionados y el panel mantuvo
importes bancarios separados. La descarga real de CSV conservó nueve registros
de prueba y columnas distintas para total XML y monto del pago.
Tras revisar los tres XML sintéticos añadidos, se restableció la demo: seis
comprobantes, cinco movimientos, tres conciliados y neto bancario 14,490 MXN.
Estos resultados no equivalen a una revisión de todos los dispositivos.
Correos, dominio/remitente y WhatsApp siguen pospuestos por instrucción del usuario.
Consumo de recursos de todo el workspace comprobado el 12 de octubre a las
21:36 (Ciudad de México): **USD 6.60**. Límite duro **USD 10** activo,
`isOverLimit: false`; no se contrataron proveedores ni se añadieron servicios.

## Corrección del asistente — 12 de octubre

Se añadió ayuda funcional por reglas para revisar candidatos, explicar estados e
importar XML/CSV/PDF/imágenes, con preguntas mixtas y fiscales protegidas. La IA
recibe una guía de esos procedimientos y se rechaza la explicación circular que
se observó en la prueba real. La suite ampliada pasó 281 pruebas, lint, tipos y build.
El código `7c3fb8eba0a21cf806e8412f34fa2444c648bf61` pasó
[CI](https://github.com/itnelimipi-rgb/FacturIA/actions/runs/38220560236) y está
fijado al deployment `93a418c7-e6d1-4790-b979-ae0ab78a3f04`: **SUCCESS**.
Nueve comprobaciones HTTPS de esta versión pasaron: cinco del asistente y cuatro
de cuentas anteriores. Son 43 acumuladas en el incremento actual. La interfaz
mostró la guía sin IA y el resumen 3/1/1 por reglas con el modelo activo. Una
explicación local rechazada recuperó la guía automáticamente; cancelar detuvo
el modelo y volvió a reglas sin iniciar otra respuesta. WebLLM continúa
experimental y falta ampliar pruebas de calidad y compatibilidad.

El checkpoint `98b135f` pasó CI y Railway confirmó SUCCESS del deployment
`8136e018-7442-4b58-bd51-d4522b453d6c`. Cuatro comprobaciones HTTPS de
persistencia adicionales pasaron: 30 acumuladas para el incremento actual.
WebLLM cargó y realizó inferencia real, pero produjo un listado de seis movimientos
donde la demo contiene cinco. No se acepta ese resultado.

La corrección pasa resúmenes/cifras y presencia de registros a reglas, admite sólo
preguntas claras de ayuda o significado de estados y limita la IA a contexto cualitativo,
sin conteos, fechas, importes o referencias de registros. Rechaza cifras incluso
cuando coinciden con datos reales; intenta reglas ante una respuesta inválida y
respeta cancelación explícita. Fallos del worker y timeout permiten recuperación.
Pasaron 276 pruebas, lint, tipos y build. La auditoría completa npm del 12 de octubre
reportó cero vulnerabilidades conocidas. Publicado como
`b252d045ba40a2247630503e1bc7d97afcdac61f`, con
[CI aprobado](https://github.com/itnelimipi-rgb/FacturIA/actions/runs/38217311426).
Deployment exacto `0049720b-2832-4f7b-80b9-a0cea3c0c759`: **SUCCESS**,
fijado a ese commit sólo en staging. Las cuatro comprobaciones HTTPS de las cuentas
anteriores pasaron: 34 acumuladas en este incremento. La interfaz confirmó IA
activa con resumen 3/1/1 por reglas y límite fiscal sin impuesto inventado.
Una respuesta local rechazada recuperó las reglas automáticamente. La explicación
del modelo sobre un movimiento ambiguo resultó circular; se añadió una guía real
al prompt y ayuda determinista para los mismos procedimientos. Esta mejora quedó
desplegada en `7c3fb8e`, con la evidencia registrada arriba.
Consumo comprobado de recursos del workspace: USD 6.43, límite duro USD 10 activo.

## Evidencia del incremento del 11 de octubre

- Workspace: Danipb15's Projects.
- Proyecto nuevo: `facturia-staging`.
- Entorno: `staging` (aislado de cualquier proyecto y servicio existente).
- Servicio aplicación: `web`, una instancia Node 22, fuente `sprint-1` fijada al
  commit indicado en la corrección más reciente, límite 500 MB RAM y 0.5 CPU,
  con suspensión automática habilitada.
- Servicio datos: PostgreSQL 18, una instancia, límite 250 MB RAM y 0.25 CPU,
  volumen persistente de 5000 MB y red privada, sin proxy TCP público.
- Dominio: subdominio gratuito generado por Railway para `web`.
- La demo continúa en `/demo`; las cuentas y registros viven en `/workspace`.
- Empezar con documentos y cuentas sintéticos; confirmar presupuesto/consumo antes
  de ampliar OCR, IA, proveedores bancarios o usuarios reales.

Proyecto y configuración creados el 8 de octubre de 2026. Dominio asignado:
`https://web-staging-b090.up.railway.app`. Staging está activo: [demo](https://web-staging-b090.up.railway.app/demo)
y [espacio personal](https://web-staging-b090.up.railway.app/workspace). Consultar
[estado del sprint](ESTADO_SPRINT_1.md) para el alcance de la verificación.

## Incremento del 11 de octubre

El código se publicó como `4b092620c74ccc8ab058ea9b24013c2f21458279` en
`sprint-1`, con autor y committer de la cuenta del usuario y sin coautores de IA.
El [CI de ese commit](https://github.com/itnelimipi-rgb/FacturIA/actions/runs/38184805806)
aprobó. Deployment `4e2c291e-456d-4407-a5e1-e6b1016ef9a8`: **SUCCESS**.
Sólo se cambió el SHA del servicio web de staging; el predeploy aplicó las
migraciones nuevas, sin reemplazar la base ni modificar otros proyectos.

La versión agrega PDF/OCR local en español con revisión, originales privados
y reintentos idempotentes, consulta SOAP oficial SAT de XML propios, asistente
WebLLM opcional y cuotas compartidas en PostgreSQL. PDF/OCR e IA local usan el
dispositivo del usuario, sin servidores GPU ni API de IA de pago. El dominio y
correo real quedan pospuestos por indicación del usuario; no se configuran
claves de correo ni se exige verificación mientras el proveedor esté desactivado.

Pasaron 262 pruebas locales, lint, TypeScript y build. La auditoría npm completa
reportó cero vulnerabilidades conocidas. Hubo 14 comprobaciones HTTP locales y
tres posteriores al reinicio: PDF/hash, consulta SAT, propietarios y sesiones
persistieron. El SAT respondió N602 al XML sintético, que conservó `no_verificado`.
La ventana de cuota SAT había vencido antes de esta prueba de reinicio; no se
atribuye a ella una comprobación de rechazo dentro de la ventana.

El [ensayo de recuperación completa local](RECUPERACION_POSTGRES.md) comparó
las 11 tablas e incluyó el archivo PDF privado. Esto es independiente de la
restauración JSON de negocio: el JSON no incorpora los bytes de PDF/imágenes.
En el clon local pasó una comprobación de 200 documentos y 200 movimientos;
no acredita capacidad ni recuperación completa de Railway.

## Verificación HTTPS e interfaz del incremento

- 14 comprobaciones iniciales y cuatro tras reiniciar únicamente web: originales
  privados, MIME/tamaño, propietario, idempotencia, cookies, sesión/origen y
  consulta SAT. Se conservaron el PDF y su SHA-256, XML y consulta fechada.
  La cuota SAT siguió rechazando el mismo XML dentro del minuto tras el reinicio.
- Ocho comprobaciones adicionales reutilizaron cuentas sintéticas del checkpoint
  anterior: perfiles, XML, movimientos, vínculos, pausas, exportaciones y nuevas
  sesiones persistieron. Son **26 comprobaciones HTTPS de este incremento**,
  independientes de las 36 del checkpoint anterior.
- La interfaz leyó el PDF sintético y reconoció importes de una imagen mediante
  OCR en español. Un subtotal incompatible con el total se rechazó antes de
  guardar. El RFC no reconocido por OCR quedó vacío para revisión, sin inventarlo.
- Se revisó el formulario a 390 × 844 y no hubo desbordamiento horizontal.
  Los documentos de lectura se descartaron; la demo conservó seis comprobantes
  y cinco movimientos con tres conciliados, uno ambiguo y una discrepancia.
- Inicio de sesión visual en la cuenta sintética: detalle del original PDF y su
  enlace privado; consulta SAT desde el botón del XML actualizó fecha y resultado
  «comprobante no encontrado». No se usaron documentos ni credenciales fiscales reales.
- WebLLM no logró preparar el modelo en este navegador de prueba. Se comprobó
  el retorno a reglas y el resumen 3/1/1. Esto no acredita inferencia ni permite
  atribuir el fallo a GPU o red. La revisión detectó que el SDK devuelve errores
  del worker como texto; su clasificación segura ya quedó implementada en el
  siguiente punto de guardado, con 271 pruebas y build aprobados. Registra sólo
  código y fase y distingue cancelación de timeout, sin imprimir mensajes crudos,
  URLs, claves, preguntas ni datos financieros.

En staging, Better Auth no resolvió una IP confiable del proxy y usa un bucket
compartido por ruta. Las cuotas se conservan en PostgreSQL. Las pruebas respetan
`Retry-After`; revisar el encabezado confiable de la plataforma antes de ampliar
el piloto, sin confiar indiscriminadamente en cabeceras enviadas por el cliente.

## Checkpoint anterior: despliegue y evidencia del 8 de octubre

- Deployment `201f3e6b-e8ae-41ad-965e-3865a5c13813`: **SUCCESS**, commit
  `2916f18f2ae014e3ebac3d1b368db90d1b8869f4` de `sprint-1`, creado con la cuenta
  asociada del usuario. La [ejecución de CI](https://github.com/itnelimipi-rgb/FacturIA/actions/runs/37875161206)
  de ese commit terminó correctamente.
- Predeploy ejecutó `db:migrate` sobre el esquema ya aplicado. `/api/health`
  responde HTTP 200 con `{"status":"ok","mode":"workspace"}`.
- **11 comprobaciones HTTP iniciales**: acceso autenticado, registro de dos
  cuentas, contraseña incorrecta, cookies HTTPS `Secure`/`HttpOnly`/`SameSite`,
  origen ajeno rechazado, identidad tomada de la sesión, pertenencia del XML,
  duplicados XML/CSV, conciliación, aislamiento, gastos provisionales,
  exportación privada con XML originales y cierre de sesión.
- **Cuatro comprobaciones HTTP posteriores al reinicio del servicio web**:
  salud, registros/exportación propios, persistencia con nuevas sesiones y
  cierre de esas sesiones. El reinicio se observó a
  `2026-10-09T01:05:06Z`; PostgreSQL no se reinició. Se conservaron los perfiles,
  XML, movimientos y vínculos. Esto suma **15 comprobaciones externas**.
- Cuatro comprobaciones de las cuentas anteriores tras esta actualización
  confirmaron que los perfiles, documentos, movimientos y exportaciones siguen
  disponibles en sus propias sesiones.
- **13 comprobaciones HTTPS de restauración JSON**, con cuatro cuentas sintéticas:
  RFC, propiedad, sesión/origen, vista previa sin escritura, rechazos sin cambios,
  dos solicitudes concurrentes guardando una sola copia, perfil conservado,
  XML reparsado, vínculos y pausas restaurados y CSV reimportado sin duplicar.
- **Cuatro comprobaciones posteriores al reinicio del nuevo deployment**, cuyo
  arranque se observó a `2026-10-09T02:56:13Z`: XML originales, documentos,
  movimientos, vínculos, pausas y propietarios restaurados persisten. PostgreSQL
  no se reinició. Los scripts suman **36 comprobaciones externas** con las
  15 anteriores. `/demo` y `/workspace` también respondieron HTTP 200/HTML.
- Todas las cuentas y documentos de esta verificación son sintéticos. La revisión
  visual, carga y recuperación completa de PostgreSQL siguen pendientes. La
  restauración JSON recupera registros de negocio, no cuentas, sesiones ni auditoría.

El servicio permanece fijado al SHA probado. Publicar nuevos commits en
`sprint-1` sirve como punto de guardado; no produce despliegues automáticos.
Actualizar el pin sólo en staging, después de revisar el commit y sus checks,
y volver a verificar el deployment exacto. No hay promoción automática a `main`.

## Configuración aplicada

`railway.json` define build, migración previa y healthcheck. La migración previa
usa la lista `preDeployCommand: ["npm run db:migrate"]`; también está configurada
explícitamente en el servicio de staging para evitar omisiones en el arranque.
Railway marca Config as Code como legado: migrar a Infrastructure as Code antes
del 1 de diciembre de 2026, según su [referencia oficial](https://docs.railway.com/config-as-code/reference).
Variables servidor:

- `RAILPACK_NODE_VERSION=22`: usar la misma versión mayor que CI y pruebas locales.
- `DATABASE_URL`: referencia a la base privada del proyecto nuevo.
- `BETTER_AUTH_URL`: URL HTTPS exacta del servicio web.
- `BETTER_AUTH_SECRET`: generar aleatoriamente (mínimo 32 caracteres).
- `ALLOW_SIGNUP=true`: sólo durante pruebas supervisadas; desactivar después.
- `FACTURIA_ENCRYPTION_SECRET`: sólo se necesita cuando se active cifrado de
  credenciales; no se habilita captura de CIEC/CSD en esta etapa.

No pegar secretos en documentos, Git ni mensajes. Copiar `.env.example` a
`.env.local` para una base de pruebas local. La demo funciona sin esas variables.

## Ejecución y verificación

Para repetir el flujo en este entorno, usar `scripts/verify-workspace-http.mjs`
contra el origen HTTPS de staging. El script crea sólo datos sintéticos y guarda
el estado privado de verificación en `node_modules/.cache`, ignorado por Git.
`--verify-only` reutiliza las cuentas de ese estado para comprobar persistencia.

1. Confirmar proyecto `facturia-staging` y entorno `staging`; no modificar otros
   proyectos ni crear otra base para repetir pruebas.
2. Comprobar variables por nombre/referencia, sin mostrar los secretos.
3. En un nuevo despliegue, ejecutar build y `npm run db:migrate` sobre esta base.
   La migración registra las versiones aplicadas y no vuelve a aplicarlas.
4. Observar SUCCESS del deployment exacto y `/api/health` indicando `workspace`.
5. Crear dos cuentas sintéticas con correos distintos; darles perfiles propios.
6. Importar `tests/fixtures/sample-cfdi40.xml` con el RFC de receptor de la muestra
   en la cuenta de pruebas. Este XML tiene sellos sintéticos y no es fiscalmente válido.
7. Importar `tests/fixtures/sample-bank.csv`; comprobar vínculo y repetir importación
   para probar idempotencia. Probar XML repetido, error de filas y manual sin UUID.
8. Probar aislamiento, logout, credenciales equivocadas, reinicio y persistencia.
9. Comprobar exportación JSON con XML propios y ejecutar
   `scripts/verify-restore-http.mjs` con `--base-url` del staging y `--state`
   dentro de `node_modules/.cache`. Hace 13 comprobaciones; tras reiniciar sólo
   web, repetir con `--verify-only` para cuatro comprobaciones de persistencia.
   El script respeta la respuesta 429 y la espera indicada para registrar cuentas,
   sin debilitar el rate limit. Documentar hallazgos; no promover automáticamente.

La migración `db/migrations` es para PostgreSQL independiente. El esquema antiguo
`supabase/migrations` queda como referencia histórica; no se aplica en Railway.

## Límites actuales

La verificación HTTP externa cubre los flujos descritos, no una aprobación para
producción. La recuperación completa y carga breve ya se ensayaron en el cluster
local. Falta ensayar recuperación en el destino definitivo, retención y copia
cifrada fuera de la PC, carga HTTP y revisión visual en dispositivos objetivo.
La restauración JSON sólo admite un espacio vacío con
perfil del mismo RFC, respaldos de cuenta y XML originales o documentos manuales.
PDF/OCR y WebLLM se procesan localmente; SAT se consulta por XML propio. Correo
real, WhatsApp y conexión directa a bancos siguen pendientes. No se calculan
deducciones ni se emiten CFDI. Las cuotas compartidas usan PostgreSQL; medir el
rendimiento y habilitar correo/invitaciones antes de ampliar el piloto.
El piloto limita cada cuenta a 5,000 movimientos y 2,000 documentos acumulados;
cada XML/CSV admite hasta 2 MB y cada descarga JSON hasta 25 MiB. PDF/imágenes:
5 MiB por archivo, 20 originales y 25 MiB acumulados por cuenta. Ampliar estos límites
requiere medir el rendimiento. El registro abierto es temporal para estas pruebas.
No admitir documentos ni usuarios reales hasta completar los requisitos del piloto.

Configuración contrastada con la [referencia oficial de Railway](https://docs.railway.com/config-as-code/reference)
y la [configuración Node.js de Railpack](https://railpack.com/languages/node/).
