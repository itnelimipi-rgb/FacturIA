# Punto de avance — 8 de octubre de 2026

Trabajo publicado en `sprint-1` del repositorio público, con autoría de la cuenta
GitHub `d1512pb` del usuario y sin coautores de IA. `main` permanece intacto;
no se creó PR ni se hizo merge. PostgreSQL local está habilitado y migrado.
Railway staging está activo con datos sintéticos y límite duro de USD 10
para recursos de todo el workspace.

## Verificado localmente

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

## Verificado en Railway

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
- Ensayar backup/restore completo de PostgreSQL y medir carga antes de admitir
  datos reales. La concurrencia de dos restauraciones ya quedó comprobada.
- Prueba visual completa de demo y espacio autenticado. El control del navegador
  local fue bloqueado por su política de acceso y el controlador de staging
  falló al inicializar sus recursos; no se da por comprobada.
- Configurar SMTP/invitaciones para ampliar el piloto; almacenar el rate limit
  compartido antes de escalar a varias instancias.
- Revisar limitaciones y obtener aprobación del usuario para promover a main.

OCR/PDF, proveedor de IA, SAT/EFOS oficial, bancos, WhatsApp y reglas fiscales
siguen en el [plan de avance](PLAN_AVANCE.md). No hay documentos fiscales reales,
secretos ni credenciales SAT incluidos en este punto de avance.

Para continuar, leer el [entorno de staging](STAGING.md) y las
[notas de coordinación](COORDINACION.md). GitHub CI y las pruebas locales no
sustituyen los requisitos pendientes para producción.
