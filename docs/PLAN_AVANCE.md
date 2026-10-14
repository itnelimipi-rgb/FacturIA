# Plan de avance de FacturIA

Actualizado: 13 de octubre de 2026. Rama de trabajo y pruebas: `sprint-1`.
La rama continuará separada de `main` hasta autorización explícita del usuario.
Priorizar herramientas open source y APIs gratuitas; conservar el límite duro
de USD 10 de recursos para el conjunto del workspace Railway.

## Prioridad actual — frontend y comprensión

El siguiente bloque se centra en que una persona sin conocimientos financieros
pueda entender y usar el producto sin contexto del desarrollador. Seguir el
[plan de frontend y UX](PLAN_FRONTEND_UX.md): lenguaje y acciones, primer uso,
cargas guiadas, revisión contextual, accesibilidad y prueba de comprensión.
La primera iteración de lenguaje e Inicio guiado está publicada y comprobada en
staging; su evidencia se registra en el estado del sprint. El plan completo y la
prueba de comprensión con el dueño siguen pendientes. Los pendientes de
integración permanecen en este documento para retomarlos después.

## Resultado que buscamos

Un usuario inicia sesión, configura su RFC, importa XML originales, PDF/imágenes
con revisión humana y movimientos bancarios CSV. Revisa documentos, resuelve
conciliaciones y puede consultar SAT para sus XML o activar un asistente local.
Sus datos sobreviven
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
  provisionales sin inventar timbre. PDF/OCR se integra en la etapa 3 con revisión
  de campos antes de registrar cualquier gasto.
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
- Restaurar respaldos JSON v1 en un espacio vacío del mismo RFC: vista previa,
  validación servidor, XML original y guardado atómico. Conservar decisiones
  válidas y pausas sin permitir sobrescritura ni confundirlo con recuperación
  completa de la base PostgreSQL.

Criterio de salida: dos cuentas aisladas, reinicio conserva registros,
importación/resolución/desvinculación funcionan, sesión inválida recibe 401,
comprobantes repetidos reciben 409 y rollback conserva integridad. Ejecutar
pruebas de cookies y proxy en Railway, además de las pruebas locales PostgreSQL.

## Etapa 3 — Documentos no estructurados e IA

- Implementado en código el 11 de octubre: PDF.js para texto PDF y Tesseract.js
  para OCR español, con workers/WASM/idioma servidos por la app. Procesamiento
  en el navegador, sin API OCR de pago. Límite de 5 MiB, 5 millones de píxeles,
  PDF de 10 páginas con texto o 3 escaneadas y lectura de 60 segundos cancelable.
- Campos sugeridos editables y confirmación humana: RFC, proveedor, fecha, MXN,
  subtotal, IVA, retenciones y total recalculado. Los datos no encontrados
  permanecen vacíos; un ticket sigue siendo un gasto provisional sin UUID.
- Originales privados en PostgreSQL después de confirmar: hasta 20 archivos y
  25 MiB por cuenta, dentro del límite de 5 MiB por original. Descarga autenticada,
  hash de contenido e idempotencia para reintentos sin documentos duplicados.
- IA local opcional y experimental con WebLLM y Qwen2.5 0.5B: WebGPU, descarga
  aproximada de 320 MB desde Hugging Face/MLC y activación explícita. Sin clave
  de API ni servidor GPU; sólo presencia de estados y monedas como contexto.
  Los resúmenes y cifras se responden con reglas, incluso con el modelo activo.
  Un resultado local rechazado vuelve a las reglas, salvo cancelación del usuario.
- Verificar visualmente carga, lectura, cancelación, errores y revisión antes
  de guardar; probar inferencia real y dispositivos con/sin WebGPU. Si hace falta
  una API o modelo distinto, definir proveedor y cuotas gratuitas con el usuario
  antes de activar cargos o enviar documentación a un tercero.

Criterio de salida: archivos sintéticos representativos y datos reales de prueba
autorizados, errores controlados, costes medidos y ninguna creación de UUID,
sello o cifras fiscales inventadas. La presencia del código no sustituye pruebas
en navegador ni acredita calidad de la respuesta de IA.

## Etapa 4 — Datos fiscales y bancarios oficiales

- Implementado en código el 11 de octubre: consulta SOAP al servicio oficial SAT
  de un XML propio, con resultado fechado, vigencia y EFOS si la respuesta lo
  proporciona. XML no encontrado y fallo del servicio conservan `no_verificado`.
  Cuotas compartidas: seis solicitudes por cuenta/minuto y una por documento/minuto.
- Verificar transporte oficial y UI; ampliar a sincronización de una lista EFOS
  completa sólo con fuentes oficiales, procedencia y fecha de actualización.
  La lista de ejemplo de `/demo` continúa siendo explícitamente demostrativa.
- Validar sellos/XSD/timbre y definir integración de emisión con PAC antes de
  ofrecer timbrado. La consulta de estado no sustituye estas verificaciones.
- Reglas fiscales versionadas por régimen, periodo, moneda y tipo de
  comprobante, contrastadas con fuentes oficiales y revisión contable.
- Lectura documental de notas de crédito E con UUID relacionados, PUE/PPD y
  Pagos 2.0 en CFDI 4.0 implementada el 12 de octubre: pagos, parcialidades,
  saldos y monedas declaradas, cálculo exacto de saldos y total de pagos MXN.
  El panel separa I/E/P; el CSV de comprobantes conserva esa distinción.
  Respaldos preservan metadatos y restauración vuelve a interpretar el XML.
  Pendiente: conciliación de parcialidades bancarias, impuestos del complemento,
  pagos 1.0 históricos, impuestos locales, nómina y conversión de MonedaDR.
  E/P siguen fuera de la conciliación automática; EquivalenciaDR se conserva
  como dato declarado y no determina el saldo global de una factura.
- Elegir proveedor bancario; sandbox primero, conciliación idempotente,
  webhooks firmados, reintentos y consentimiento de acceso.

Criterio de salida: pruebas contra sandbox/proveedor, contabilidad trazable y
reglas revisadas. No almacenar CIEC/CSD hasta definir su flujo y gestión de claves.

## Etapa 5 — WhatsApp y preparación de producción

Correo, dominio/remitente y WhatsApp están pospuestos por instrucción del usuario;
continuar primero con los pendientes que no dependan de estas integraciones.

- Cuenta y número Meta/WhatsApp Business, webhooks verificados y usuarios
  vinculados a cuentas autenticadas. Nunca inferir identidad sólo por texto.
- Verificación de correo y recuperación de contraseña implementadas, pendientes
  de configurar y probar entrega: priorizar Resend HTTPS con remitente/dominio
  autorizado y cuotas gratuitas. SMTP con TLS sólo donde esté permitido; Railway
  Hobby no permite SMTP saliente. Mantener el correo desactivado hasta validarlo.
- Cuotas distribuidas mediante PostgreSQL ya implementadas. Revisar permisos,
  invitaciones, privacidad, retención, eliminación y exportación antes de ampliar
  el piloto. Los envíos de correo tienen una cuota diaria global configurable.
- Copias de seguridad y restauración ensayadas, observabilidad, gestión de
  incidentes, coste mensual revisado y piloto con usuarios autorizados.
- El respaldo JSON incluye XML y campos, sin bytes de PDF/imágenes ni cuentas o
  sesiones. Descargar originales por separado o recuperar PostgreSQL completo,
  incluyendo `app_document_files`. Registrar el ensayo y sus verificaciones
  antes de atribuir capacidad de recuperación de la base.
- Proteger `main` y exigir CI y revisión. Abrir PR desde `sprint-1`, comparar demo
  y espacio funcional y obtener aprobación del usuario antes de promover.

## Puerta para main

1. `npm run check` y auditoría de dependencias satisfactoria.
2. Pruebas funcionales en staging, incluidos aislamiento y persistencia.
3. Evidencia de demo preservada y ausencia de secretos en cambios/logs.
4. Cambios, limitaciones y rollback documentados en el PR.
5. Aprobación del usuario para la promoción. Un despliegue de pruebas no autoriza
   cambios en producción ni en el dominio personal.

El incremento documental del 12 de octubre aprobó 373 pruebas, lint, tipos, build
y CI, con 22 comprobaciones HTTPS propias y revisión de interfaz en staging.
Consultar `docs/ESTADO_SPRINT_1.md` para distinguir estas evidencias de las
pruebas y ensayos de recuperación de los checkpoints anteriores.

## Coordinación con Claude Code

Leer este plan y `docs/COORDINACION.md`. Usar commits pequeños y asignar archivos
antes de editar simultáneamente. El repositorio y sus pruebas son el punto común;
la comunicación entre herramientas la habilitará el usuario.
