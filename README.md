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

El incremento del **11 de octubre de 2026** está implementado en código; su
validación completa y deployment se registrarán cuando terminen. Las pruebas
del checkpoint anterior se distinguen al final de este documento.

- Importación XML CFDI 3.3/4.0: estructura, namespace, UUID, RFC, fechas, importes,
  descuentos e impuestos. Revalidación en servidor para el espacio persistente.
- CSV bancario con vista previa, errores por fila e importación idempotente.
- Conciliación por propietario, dirección, moneda, importe y ±3 días calendario.
  Un documento se vincula a un movimiento; resolución manual de ambigüedades,
  desvinculación y reanudación de búsqueda.
- Gastos manuales provisionales, sin inventar UUID ni timbre.
- Lectura local de PDF con PDF.js y OCR en español con Tesseract.js, ambos open
  source. Los campos son sugerencias editables: el usuario revisa RFC, proveedor,
  fecha, moneda, subtotal, IVA y retenciones antes de confirmar. No se calcula
  un IVA supuesto ni se convierte una imagen en un CFDI timbrado.
- Originales PDF/PNG/JPEG/WebP privados en PostgreSQL, sólo después de confirmar:
  hasta **5 MiB por archivo, 20 originales y 25 MiB por cuenta**. Descarga
  autenticada como adjunto, hash SHA-256 e idempotencia para reintentos.
- Descarga de respaldo JSON propio con XML originales y reporte CSV de movimientos.
- Restauración JSON v1 con vista previa, mismo RFC y espacio vacío; XML revalidado,
  perfil conservado y guardado completo en una transacción.
- Indicadores derivados de registros, separados por moneda, y asistente por
  reglas que resume los datos disponibles.
- Asistente de IA local **opcional y experimental** con WebLLM y Qwen2.5 0.5B.
  Requiere WebGPU y descarga aproximadamente 320 MB de modelo desde Hugging Face
  y MLC. Explica estados con contexto cualitativo en el dispositivo; no recibe
  importes, fechas, conteos ni referencias de registros. Las preguntas sobre cifras
  y resúmenes usan reglas verificadas, incluso con el modelo activo. No requiere
  clave de API ni servidor GPU. Las respuestas locales que no pasan los controles
  se descartan y se intenta responder con reglas. Las guías de revisión e
  importación también están disponibles por reglas, sin activar la IA.
- Consulta SOAP al servicio oficial SAT para un XML propio: vigencia, resultado,
  fecha y EFOS cuando la respuesta lo proporciona. Un documento no encontrado o
  una falla del servicio conserva `no_verificado`; una consulta no valida sellos.
- Verificación de correo y recuperación de contraseña implementadas, desactivadas
  mientras falta configurar entrega. Adaptadores Resend HTTPS y SMTP con TLS;
  cuota diaria global y límites por cuenta almacenados en PostgreSQL.
- Autenticación, aislamiento por usuario, restricciones SQL, transacciones y
  auditoría de cambios. Pruebas del SQL y autenticación con PostgreSQL embebido.

PDF/OCR admite archivos de 5 MiB, imágenes de hasta 5 millones de píxeles,
PDF de hasta 10 páginas con texto o 3 escaneadas y lectura de hasta 60 segundos,
con cancelación. La demo conserva únicamente campos confirmados; los originales
privados pertenecen al espacio con cuenta.

**El respaldo JSON no incluye los bytes de PDF o imágenes.** Descarga esos
originales por separado; la recuperación completa de PostgreSQL debe incluir
`app_document_files`. Restaurar JSON no recupera cuentas, sesiones ni originales
de esos formatos.

## Pendiente

Validación de sellos/XSD/timbre, emisión y timbrado mediante PAC, reglas fiscales
revisadas, complementos, impuestos locales, bancos y WhatsApp. No hay descarga
masiva de CFDI ni lista EFOS completa sincronizada. La consulta implementada
informa únicamente lo que devuelve SAT para el comprobante seleccionado.
Conciliar no demuestra autenticidad ni deducibilidad. No se calculan ahorros
fiscales ni se capturan credenciales CIEC/CSD.

Falta activar y probar correo con una cuenta y remitente autorizados, revisar
visualmente todos los flujos, probar WebGPU/inferencia real en los dispositivos
objetivo, medir carga y registrar un ensayo completo de recuperación PostgreSQL.
Los resultados de validación del incremento se documentarán al concluirlos.

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

`predev` y `prebuild` preparan workers, WASM y datos de idioma desde paquetes npm
en `public/document-tools`, ignorado por Git. Los documentos no se envían a una
API OCR; se procesan en el navegador. El guardado confirmado envía el original
únicamente al backend de esta aplicación.

Para correo, priorizar `MAIL_PROVIDER=resend`, `RESEND_API_KEY` y `EMAIL_FROM`
con remitente autorizado y un plan gratuito dentro de sus cuotas. No activar un
plan pago sin autorización. Railway Free/Trial/Hobby requiere correo por HTTPS:
[SMTP saliente sólo está disponible en Pro o superior](https://docs.railway.com/networking/outbound-networking).
`REQUIRE_EMAIL_VERIFICATION` permanece desactivado hasta verificar el envío real.

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

El incremento del 11 de octubre y sus mejoras del asistente pasaron **281 pruebas**, lint, TypeScript y build, con
auditoría npm completa sin vulnerabilidades conocidas. Los motores PDF/OCR
leyeron fixtures sintéticos y hubo **14 comprobaciones HTTP locales** con
PostgreSQL, descarga privada y respuesta SAT N602. La recuperación completa
local coincidió en 11 tablas e incluyó el PDF original; también pasó una
comprobación breve de carga en el clon. CI aprobó y el incremento está desplegado
en staging, con **43 comprobaciones HTTPS**, incluida persistencia después de
reiniciar web. PDF/OCR, login, consulta SAT y revisión móvil se probaron en la
interfaz. WebLLM cargó y generó texto en el navegador. La revisión encontró un
resumen inventado: por ello el modelo quedó limitado a explicaciones cualitativas,
con pruebas de regresión y respuestas de cifras por reglas. Las guías de revisión
tienen una respuesta determinista útil. La interfaz confirmó esa guía sin IA y
el resumen calculado con IA activa. La evidencia está en [staging](docs/STAGING.md).
El checkpoint anterior tuvo **36 comprobaciones HTTPS** de sus flujos y
restauración JSON; se conserva su evidencia en el estado del sprint.

Dominio/remitente y correo real quedan pospuestos por indicación del usuario.
El proveedor de correo permanece desactivado.

Leer [estado del sprint](docs/ESTADO_SPRINT_1.md), [plan de avance](docs/PLAN_AVANCE.md),
[staging](docs/STAGING.md) y [coordinación con Claude Code](docs/COORDINACION.md).
`railway.json` configura build, migración y healthcheck. Railway mantiene un
límite duro de USD 10 para recursos de todo el workspace. El servicio está
fijado al commit probado; publicar nuevos puntos de guardado no lo redespliega
automáticamente. El [entorno PostgreSQL local](docs/DESARROLLO_LOCAL.md) permite
desarrollar en la PC. La restauración acepta respaldos de cuentas, con XML
originales y documentos manuales; no importa respaldos de la demostración.
No incluir secretos ni documentos reales en Git ni admitir datos reales en este piloto.
