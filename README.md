# FacturIA

Conciliación documental de movimientos bancarios y CFDI. Desarrollo en `sprint-1`;
la promoción a `main` requiere pruebas en staging y aprobación del usuario.

## Modos

- `/` y `/demo`: demostración con datos sintéticos y almacenamiento local del
  navegador. Funciona sin base de datos; **Reset demo** restablece los ejemplos.
- `/workspace`: cuentas, sesiones, perfil y registros persistentes en PostgreSQL.
  Requiere configurar la base y autenticación; comienza vacío por usuario.

## Funciones implementadas

- Importación XML CFDI 3.3/4.0: estructura, namespace, UUID, RFC, fechas, importes,
  descuentos e impuestos. Revalidación en servidor para el espacio persistente.
- CSV bancario con vista previa, errores por fila e importación idempotente.
- Conciliación por propietario, dirección, moneda, importe y ±3 días calendario.
  Un documento se vincula a un movimiento; resolución manual de ambigüedades,
  desvinculación y reanudación de búsqueda.
- Gastos manuales provisionales, sin inventar UUID ni timbre.
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

## Próximo avance

Leer [plan de avance](docs/PLAN_AVANCE.md), [propuesta de staging](docs/STAGING.md)
y [coordinación con Claude Code](docs/COORDINACION.md). `railway.json` prepara
build, migración y healthcheck; **todavía no hay un despliegue autorizado ni
verificado en Railway**. No incluir secretos ni documentos reales en Git.
