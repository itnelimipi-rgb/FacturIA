# FacturIA

Conciliación documental de movimientos bancarios y CFDI. Desarrollo en `sprint-1`;
la promoción a `main` requiere pruebas en staging y aprobación del usuario.
Los avances se publican como puntos de guardado en esa rama del repositorio
público, con la cuenta `d1512pb` y sin coautores de IA. `main` continúa intacto.

## Modos

- `/` y `/demo`: demostración con datos sintéticos y almacenamiento local del
  navegador. Funciona sin base de datos; **Reset demo** restablece los ejemplos.
- `/workspace`: cuentas, sesiones, perfil y registros persistentes en PostgreSQL.
  Requiere configurar la base y autenticación; comienza vacío por usuario.

El staging está activo con datos sintéticos: [demo](https://web-staging-b090.up.railway.app/demo)
y [espacio personal](https://web-staging-b090.up.railway.app/workspace).

## Funciones implementadas

- Importación XML CFDI 3.3/4.0: estructura, namespace, UUID, RFC, fechas, importes,
  descuentos e impuestos. Revalidación en servidor para el espacio persistente.
- CSV bancario con vista previa, errores por fila e importación idempotente.
- Conciliación por propietario, dirección, moneda, importe y ±3 días calendario.
  Un documento se vincula a un movimiento; resolución manual de ambigüedades,
  desvinculación y reanudación de búsqueda.
- Gastos manuales provisionales, sin inventar UUID ni timbre.
- Descarga de respaldo JSON propio con XML originales y reporte CSV de movimientos.
- Restauración JSON v1 con vista previa, mismo RFC y espacio vacío; XML revalidado,
  perfil conservado y guardado completo en una transacción.
- Indicadores derivados de registros, separados por moneda, y asistente por
  reglas que resume los datos disponibles.
- Autenticación, aislamiento por usuario, restricciones SQL, transacciones y
  auditoría de cambios. Pruebas del SQL y autenticación con PostgreSQL embebido.

## Pendiente

Consulta oficial de vigencia SAT/EFOS, validación de sellos/XSD, OCR/PDF, proveedor
de IA, bancos y WhatsApp. El XML importado se etiqueta **SAT no verificado**.
Conciliar no demuestra autenticidad ni deducibilidad. No se calculan ahorros
fiscales ni se emiten CFDI; no se capturan credenciales CIEC/CSD.
Complementos, impuestos locales y conversiones de moneda necesitan ampliación.

## Desarrollo local

Node.js 22.14 o superior.

```sh
npm ci
npm run dev
```

Abrir `http://localhost:3000/demo`. Para habilitar cuentas, copiar `.env.example`
a `.env.local`, configurar un PostgreSQL **de pruebas**, URL de la aplicación y
un secreto aleatorio de al menos 32 caracteres. Activar `ALLOW_SIGNUP=true` sólo
durante el piloto supervisado. Después ejecutar:

```sh
npm run db:migrate
```

Las migraciones actuales viven en `db/migrations`. `supabase/migrations` conserva
el diseño inicial como referencia y no se aplica a este backend.

## Verificación

```sh
npm run check
npm audit
npm start
```

`check` ejecuta lint, TypeScript, pruebas del código real y compilación de
producción. Los scripts históricos de `tests/run_verification` delegan en la
misma suite. Los fixtures son sintéticos y no tienen validez fiscal.

## Estado y próximo avance

Pasaron **193 pruebas locales**, lint, TypeScript y build. El staging ejecuta el
commit `9d77aed58919e59366b9e742cdac5f3868635448`: migración aplicada, healthcheck
funcional y **15 comprobaciones HTTP externas** aprobadas, incluidas cuatro
después de reiniciar el servicio web para verificar persistencia. Su
[CI en GitHub](https://github.com/itnelimipi-rgb/FacturIA/actions/runs/37864970640)
también pasó. La restauración JSON ya tiene pruebas de validación, aislamiento y
rollback; falta completar su verificación externa, la revisión visual y la
recuperación completa de PostgreSQL desde un respaldo.

Leer [estado del sprint](docs/ESTADO_SPRINT_1.md), [plan de avance](docs/PLAN_AVANCE.md),
[staging](docs/STAGING.md) y [coordinación con Claude Code](docs/COORDINACION.md).
`railway.json` configura build, migración y healthcheck. Railway mantiene un
límite duro de USD 10 para recursos de todo el workspace. El servicio está
fijado al commit probado; publicar nuevos puntos de guardado no lo redespliega
automáticamente. El [entorno PostgreSQL local](docs/DESARROLLO_LOCAL.md) permite
desarrollar en la PC. La restauración acepta respaldos de cuentas, con XML
originales y documentos manuales; no importa respaldos de la demostración.
No incluir secretos ni documentos reales en Git ni admitir datos reales en este piloto.
