# Plan de avance de FacturIA

Fecha: 8 de octubre de 2026. Rama de trabajo: `sprint-1`.

## Resultado que buscamos

Un usuario inicia sesión, configura su RFC, importa un XML original y movimientos
bancarios CSV, revisa los documentos y resuelve conciliaciones. Sus datos sobreviven
al cierre del navegador y sólo son accesibles desde su cuenta. La demostración
permanece disponible en `/demo`, con almacenamiento local y datos sintéticos.

El primer producto funcional realiza **conciliación documental**. Verificar que
un monto coincide con un CFDI no demuestra vigencia SAT, autenticidad del sello,
deducibilidad, pago de impuestos ni consulta oficial EFOS.

## Etapa 1 — Fundamentos y demo segura

- Actualizar Next.js, React, parser, estilos y herramientas; revisar auditoría npm.
- Ejecutar pruebas del código real, TypeScript, lint y compilación en un único `npm run check`.
- Rechazar XML arbitrario y UUID ficticio; revisar RFC, fecha, moneda, importes,
  descuentos y sumatorias. Etiquetar `no_verificado` hasta consultar SAT.
- Conciliar por dueño, dirección, moneda, centavos y día calendario. Evitar
  comprobantes cancelados, EFOS ajenos y uso del mismo UUID en dos movimientos.
- CSV con vista previa, errores por fila y deduplicación. Gastos manuales
  provisionales sin inventar timbre. PDF e imágenes muestran capacidad pendiente.
- Mantener escenario demo de 3 conciliados, 1 ambiguo y 1 discrepancia.

Criterio de salida: suite real y compilación pasan; no se inventan resultados ni
se suman monedas distintas. Flujo visual demo revisado.

## Etapa 2 — Cuentas y persistencia en staging

- `/workspace`: autenticación por correo y contraseña, sesiones y perfil fiscal.
- PostgreSQL separado de los proyectos existentes; migraciones versionadas,
  transacciones, restricciones por propietario y UUID y auditoría de cambios.
- Revalidación de XML en servidor. Identidad siempre obtenida de la sesión,
  nunca del `userId` enviado por el navegador. Escrituras restringidas al origen.
- Desplegar aplicación + PostgreSQL en proyecto `facturia-staging`, entorno
  `staging`, dominio automático Railway. Autorizado el 8 de octubre de 2026 con
  límite duro de USD 10 para recursos del workspace.
- Usar exclusivamente datos sintéticos en el primer despliegue.

Criterio de salida: dos cuentas aisladas, reinicio conserva registros,
importación/resolución/desvinculación funcionan, sesión inválida recibe 401,
comprobantes repetidos reciben 409 y rollback conserva integridad. Ejecutar
pruebas de cookies y proxy en Railway, además de las pruebas locales PostgreSQL.

## Etapa 3 — Documentos no estructurados e IA

- Elegir proveedor, modelo y límite de gasto con el usuario; claves sólo en
  variables del servidor. Añadir extracción PDF y OCR de imágenes.
- Guardar originales en almacenamiento privado y procesar con límite de tamaño,
  tiempo, páginas, permisos, reintentos y estado visible.
- Salida estructurada validada y revisión humana. Un ticket no se transforma
  en un CFDI timbrado. Los importes siempre se recalculan determinísticamente.
- Asistente con contexto de la cuenta autenticada, referencias a documentos y
  respuesta explícita cuando falta evidencia. Resúmenes locales por reglas
  siguen disponibles mientras no haya proveedor de IA.

Criterio de salida: archivos reales de prueba, errores controlados, costes
medidos y ninguna creación de UUID, sello o cifras inventadas.

## Etapa 4 — Datos fiscales y bancarios oficiales

- Consulta de estado CFDI y lista EFOS oficial, con procedencia, fecha de
  actualización y estados de fallo. No considerar el mock una lista SAT real.
- Reglas fiscales versionadas por régimen, periodo, moneda y tipo de
  comprobante, contrastadas con fuentes oficiales y revisión contable.
- Ampliar tipos y complementos CFDI: P/pagos parciales, notas de crédito,
  impuestos locales, nómina y conversión de monedas según especificaciones.
- Elegir proveedor bancario; sandbox primero, conciliación idempotente,
  webhooks firmados, reintentos y consentimiento de acceso.

Criterio de salida: pruebas contra sandbox/proveedor, contabilidad trazable y
reglas revisadas. No almacenar CIEC/CSD hasta definir su flujo y gestión de claves.

## Etapa 5 — WhatsApp y preparación de producción

- Cuenta y número Meta/WhatsApp Business, webhooks verificados y usuarios
  vinculados a cuentas autenticadas. Nunca inferir identidad sólo por texto.
- Verificación de correo o invitaciones, recuperación de cuenta, permisos,
  límites distribuidos, privacidad, retención, eliminación y exportación.
- Copias de seguridad y restauración ensayadas, observabilidad, gestión de
  incidentes, coste mensual revisado y piloto con usuarios autorizados.
- Proteger `main` y exigir CI y revisión. Abrir PR desde `sprint-1`, comparar demo
  y espacio funcional y obtener aprobación del usuario antes de promover.

## Puerta para main

1. `npm run check` y auditoría de dependencias satisfactoria.
2. Pruebas funcionales en staging, incluidos aislamiento y persistencia.
3. Evidencia de demo preservada y ausencia de secretos en cambios/logs.
4. Cambios, limitaciones y rollback documentados en el PR.
5. Aprobación del usuario para la promoción. Un despliegue de pruebas no autoriza
   cambios en producción ni en el dominio personal.

## Coordinación con Claude Code

Leer este plan y `docs/COORDINACION.md`. Usar commits pequeños y asignar archivos
antes de editar simultáneamente. El repositorio y sus pruebas son el punto común;
la comunicación entre herramientas la habilitará el usuario.
