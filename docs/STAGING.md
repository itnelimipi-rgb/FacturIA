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
- Servicio aplicación: `web`, una instancia Node 22, fuente `sprint-1`.
- Servicio datos: PostgreSQL con volumen persistente y red privada.
- Dominio: subdominio gratuito generado por Railway para `web`.
- La demo continúa en `/demo`; las cuentas y registros viven en `/workspace`.
- Empezar con documentos y cuentas sintéticos; confirmar presupuesto/consumo antes
  de ampliar OCR, IA, proveedores bancarios o usuarios reales.

Proyecto y configuración creados el 8 de octubre de 2026. Dominio asignado:
`https://web-staging-b090.up.railway.app`. La URL no implica que el despliegue o
la validación funcional estén terminados; consultar [estado del sprint](ESTADO_SPRINT_1.md).

## Configuración preparada

`railway.json` define build, migración previa y healthcheck. Variables servidor:

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

1. Confirmar IDs del proyecto y entorno nuevos. Provisionar Postgres y `web`.
2. Instalar variables por referencia, secretos generados y URL del servicio.
3. Ejecutar build y `npm run db:migrate` sobre la base nueva.
4. Observar SUCCESS del deployment exacto y `/api/health` indicando `workspace`.
5. Crear dos cuentas sintéticas con correos distintos; darles perfiles propios.
6. Importar `tests/fixtures/sample-cfdi40.xml` con el RFC de receptor de la muestra
   en la cuenta de pruebas. Este XML tiene sellos sintéticos y no es fiscalmente válido.
7. Importar `tests/fixtures/sample-bank.csv`; comprobar vínculo y repetir importación
   para probar idempotencia. Probar XML repetido, error de filas y manual sin UUID.
8. Probar aislamiento, logout, credenciales equivocadas, reinicio y persistencia.
9. Comprobar exportación JSON con XML propios. La restauración está pendiente y
   debe ensayarse antes de admitir datos reales. Documentar
   hallazgos y gastos observados; no promover automáticamente.

La migración `db/migrations` es para PostgreSQL independiente. El esquema antiguo
`supabase/migrations` queda como referencia histórica; no se aplica en Railway.

## Límites actuales

Las pruebas locales no equivalen a completar pruebas en Railway. El proveedor
de IA/OCR, SMTP, WhatsApp, bancos y SAT aún no está conectado. La primera etapa
no calcula deducciones ni emite CFDI. El rate limit de autenticación en memoria
requiere una sola instancia; configurar almacenamiento compartido antes de escalar.
El piloto limita cada cuenta a 5,000 movimientos y 2,000 documentos acumulados;
cada XML/CSV admite hasta 2 MB y cada descarga hasta 25 MiB. Ampliar estos límites
requiere medir el rendimiento. El registro abierto es temporal para estas pruebas.

Configuración contrastada con la [referencia oficial de Railway](https://docs.railway.com/config-as-code/reference)
y la [configuración Node.js de Railpack](https://railpack.com/languages/node/).
