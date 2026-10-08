# Punto de avance — 8 de octubre de 2026

Trabajo publicado en `sprint-1`, con autoría de la cuenta GitHub del usuario.
PostgreSQL local está habilitado y migrado. Railway staging está autorizado y en
preparación, con límite duro de USD 10 aplicado al workspace.

## Verificado localmente

- `npm run check`: lint, TypeScript, **166 pruebas** y build de producción pasan.
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
- Una regresión de 101 CFDI candidatos confirma que contratos y exportaciones
  admiten ambigüedades dentro del límite acumulado de documentos.

## Pendiente antes de main

- Confirmar CI en GitHub para el commit final que se proponga promover a main.
- Crear y validar Railway staging con PostgreSQL externo: TLS/proxy, cookies
  HTTPS, concurrencia, reinicio, persistencia y restauración.
- Prueba visual completa de demo y espacio autenticado. El control del navegador
  local fue bloqueado por su política de acceso; no se da por comprobada.
- Revisar limitaciones y obtener aprobación del usuario para promover a main.

OCR/PDF, proveedor de IA, SAT/EFOS oficial, bancos, WhatsApp y reglas fiscales
siguen en el [plan de avance](PLAN_AVANCE.md). No hay documentos fiscales reales,
secretos ni credenciales SAT incluidos en este punto de avance.

Para continuar, leer la [propuesta de staging](STAGING.md) y las
[notas de coordinación](COORDINACION.md). GitHub CI y las pruebas locales no
sustituyen la validación del entorno externo.
