# Entorno de pruebas en Railway

El usuario autorizó staging y un límite duro de USD 10 para recursos de todo el
workspace. El límite quedó aplicado y comprobado el 8 de octubre de 2026. Al
alcanzarlo Railway detiene los servicios del workspace, incluidos otros proyectos.
Railway Agent e impuestos tienen tratamiento independiente: no ejecutar Agent
ni contratar integraciones adicionales sin revisar el presupuesto.
También hay PostgreSQL local aislado para desarrollar sin depender de staging.

- Workspace: Danipb15's Projects.
- Proyecto nuevo: `facturia-staging`.
- Entorno: `staging` (aislado de cualquier proyecto y servicio existente).
- Servicio aplicación: `web`, una instancia Node 22, fuente `sprint-1` fijada al
  commit `2916f18f2ae014e3ebac3d1b368db90d1b8869f4`, límite 500 MB RAM y 0.5 CPU,
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

## Despliegue y evidencia

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
producción. Falta revisar la interfaz, probar carga y ensayar backup/restore
completo de PostgreSQL. La restauración JSON sólo admite un espacio vacío con
perfil del mismo RFC, respaldos de cuenta y XML originales o documentos manuales.
El proveedor de IA/OCR, SMTP, WhatsApp, bancos y SAT aún no está conectado.
La primera etapa no calcula deducciones ni emite CFDI. El rate limit de
autenticación en memoria requiere una sola instancia; configurar almacenamiento
compartido antes de escalar y habilitar correo/invitaciones antes de ampliar el piloto.
El piloto limita cada cuenta a 5,000 movimientos y 2,000 documentos acumulados;
cada XML/CSV admite hasta 2 MB y cada descarga hasta 25 MiB. Ampliar estos límites
requiere medir el rendimiento. El registro abierto es temporal para estas pruebas.
No admitir documentos ni usuarios reales hasta completar los requisitos del piloto.

Configuración contrastada con la [referencia oficial de Railway](https://docs.railway.com/config-as-code/reference)
y la [configuración Node.js de Railpack](https://railpack.com/languages/node/).
