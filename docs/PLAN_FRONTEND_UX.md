# Plan de frontend y experiencia de usuario de FacturIA

Fecha: 12 de octubre de 2026. Rama: `sprint-1`.
Estado: plan preparado; las mejoras descritas todavía no están implementadas.
Base revisada: código de `8997e09`, demo desplegada y recorridos del frontend.

## Objetivo y criterio principal

Una persona sin experiencia financiera debe poder usar FacturIA sin explicaciones
del desarrollador ni del asistente. En cada pantalla debe poder responder:

1. ¿Qué estoy viendo y de dónde salió?
2. ¿Qué significa para mí?
3. ¿Qué necesita mi atención?
4. ¿Qué puedo hacer ahora y qué ocurrirá al hacerlo?
5. ¿Se guardó el cambio? ¿Cómo lo corrijo si me equivoqué?

El criterio de aprobación del dueño es usar el producto sin recibir contexto de
Codex. Una interfaz más bonita, una suite aprobada o un recorrido hecho por quien
programó la pantalla no sustituyen esa prueba de comprensión.

## Modelo que debe enseñar el producto

FacturIA permite juntar movimientos del banco con los documentos que podrían
explicarlos. Hay tres cosas distintas: movimientos cargados, documentos cargados
y relaciones entre ambos. Importar un archivo no mueve dinero ni conecta el banco.

Una relación encontrada no significa que una persona la haya revisado ni que el
SAT haya confirmado la factura. El estado de la relación y la respuesta del SAT
se mostrarán por separado, con su fuente y fecha cuando estén disponibles.

El dinero que entró o salió se obtiene de los movimientos cargados. La diferencia
entre ambos no representa el saldo disponible en el banco. Una factura recibida
puede documentar una compra aunque su código fiscal sea de ingreso (I): la
orientación emitida/recibida depende del RFC del usuario, no sólo de ese código.

## Problemas observados que guían las prioridades

- La cabecera habla de tokens, OCR, reglas y conciliación determinista antes de
  decir para qué sirve la pantalla.
- `Registrar Factura` abre un gasto provisional. `Vincular CFDI` sólo desplaza la
  página a la carga de archivos, sin conservar el movimiento que se quiere resolver.
- `Conciliado`, `Ambiguo` y `Discrepancia` requieren conocimiento previo. El rojo
  puede hacer parecer que un documento pendiente implica un problema fiscal.
- La ambigüedad también puede ser una factura que coincide con dos movimientos.
  No siempre significa que hay varias facturas para elegir.
- El panel presenta exportaciones y respaldos antes del primer paso. Algunas
  revisiones son avisos generales en lugar de tareas concretas.
- El total de XML I reúne documentos emitidos y recibidos. Cambiar ese título a
  “mis ingresos” produciría una interpretación incorrecta.
- El perfil preselecciona RESICO. La carga bancaria exige conocer columnas,
  signos, fechas y UTF-8 antes de comenzar.
- El detalle de pagos destaca campos técnicos como cero/XXX y saldo insoluto.
  La landing todavía describe como futuras algunas capacidades ya implementadas.
- Hay textos de 10–12 px y acciones sólo con iconos. El modal de coincidencias
  requiere revisar semántica de diálogo, foco y uso con teclado.

Fuentes del diagnóstico: `FacturiaDashboard`, `TreasuryInbox`, `WorkspaceGate`,
`FiscalDashboardPanel`, `CashFlowShield`, `LandingHero`, `BankCsvImport`,
`UnifiedDropzone`, `AmbiguousResolverModal`, `CfdiDetailModal`, `AssistantChat` y
controles de exportación/restauración, dentro de `src/components`.
Son observaciones de código y demo; falta validarlas con usuarios nuevos.

## Entrega 1 — Lenguaje y acciones que cumplan lo que prometen

Prioridad máxima. Antes de cambiar la distribución, acordar un vocabulario común
y aplicarlo a navegación, botones, estados, notificaciones y ayuda.

- `Facturas & Tesorería` → `Movimientos y documentos` como transición.
- `Panel` → `Inicio`; `Landing` → `Acerca de FacturIA`;
  `Reset demo` → `Reiniciar ejemplos`.
- `Registrar Factura` → `Anotar un gasto sin factura`.
- `Conciliado` → `Con documento vinculado`. No usar “verificado” o “revisado”
  para afirmar algo que el sistema no registra.
- `Ambiguo` → `Revisar coincidencia`. Explicación específica: varias facturas
  posibles o una factura que coincide con más de un movimiento.
- `Discrepancia` → `Sin documento vinculado`, acompañado de la causa disponible.
  No afirmar siempre “falta una factura”: puede existir pero no cumplir las reglas.
- `Búsqueda automática pausada` → conservar ese significado y ofrecer
  `Volver a buscar`, distinto de los pendientes sin pausa.
- `UUID` → `Identificador del documento` en la vista principal; nombre original
  disponible en los datos técnicos.
- `Ingresos/Egresos` bancarios → `Dinero que entró/Dinero que salió`.
  Mostrar moneda, fuente y rango de fechas de los datos, sin inventar un periodo.
- `Saldo insoluto` → `Pendiente después de este pago, según el documento`.
- `Respaldo JSON` → `Copia para recuperar mis registros`;
  `CSV` → `Archivo para hoja de cálculo`, indicando extensión al descargar.

Corregir también mensajes del asistente y la landing; retirar del recorrido
principal nombres de modelos, tokens y detalles del algoritmo. Los avisos sobre
descarga, privacidad y límites de IA seguirán visibles antes de activarla.

Para un movimiento sin documento, el botón dirá `Agregar comprobante`. Abrirá
la carga con ese movimiento visible; al terminar indicará si se encontró una
relación o qué sigue pendiente. Nunca anunciará un vínculo que no se guardó.
El diálogo de coincidencias mostrará diferencias reales de fecha/importe, sin
prometer igualdad exacta cuando el motor admite tolerancia.

Criterio de salida: el mismo concepto tiene el mismo nombre en toda la app;
cada botón describe su efecto real. Se conservan los estados internos y reglas
del motor; este cambio no habilita emisión de facturas ni conciliación parcial.

## Entrega 2 — Inicio, navegación y primer uso

La navegación objetivo será `Inicio`, `Movimientos`, `Documentos` y `Ayuda`.
Acciones de cuenta, descargas y respaldos tendrán una zona secundaria accesible.
Se mantendrá la identidad visual, con mayor legibilidad y jerarquía.

El inicio responderá primero “qué debo hacer”. Para una cuenta vacía mostrará
`Agrega tus documentos` y `Agrega los movimientos de tu banco`, con una explicación
breve de qué archivos necesita cada tarea. No se exigirá un orden artificial:
ambas cargas sirven por separado; relacionarlas requiere tener ambas.

Con datos, mostrará cuántos movimientos tienen documento y cuáles necesitan
revisión. Cada pendiente llevará a la lista o al registro correspondiente, con
el filtro aplicado. “Sin resultados en esta búsqueda”, “aún no cargaste datos”
y “no hay pendientes en este filtro” tendrán mensajes y acciones diferentes.

Los importes bancarios estarán separados de los documentos. Las facturas
emitidas y recibidas se distinguirán usando el RFC del perfil; los casos que
no puedan clasificarse con certeza se explicarán sin atribuirles ingresos propios.
Retenciones y otros campos fiscales quedarán en una vista secundaria explicada.
Si se añade filtro de fechas/moneda, todas las cifras y listas del mismo contexto
deberán respetarlo y mostrar si se consultan todos los datos o un subconjunto.

La demo tendrá identificación permanente y un recorrido opcional con ejemplos.
El espacio personal dirá que guarda los registros de la cuenta. La bienvenida
podrá omitirse y reabrirse desde ayuda; usar el producto no dependerá de un tour.

Crear cuenta y completar perfil estarán claramente separados. El RFC explicará
para qué se solicita y dónde copiarlo. El régimen no se asignará por defecto:
primero se pedirá una elección explícita con ayuda para identificarlo. Permitir
continuar con “No lo sé” requiere definir y probar un perfil incompleto en backend;
no se guardará un régimen ficticio para sortear ese paso.

Criterio de salida: alguien nuevo reconoce dónde está y llega a una carga o a un
pendiente sin conocer términos fiscales; sabe si trabaja con ejemplos o sus datos.

## Entrega 3 — Cargas guiadas y resultados claros

Documentos: ofrecer `Tengo una factura XML` y `Tengo un PDF o una foto` con una
explicación de la diferencia antes de elegir archivo. Mostrar los límites del
formato elegido y cómo conseguir el XML de quien emitió la factura.

XML: comunicar lectura, guardado y resultado real. Al terminar, ofrecer
`Ver documento` y la revisión que corresponda. Importar no se presentará como
confirmación del SAT. Los comprobantes repetidos se reconocerán y permitirán
abrir el registro existente cuando el servidor pueda identificarlo.

PDF/foto: mostrar datos detectados como sugerencias editables. Distinguir lo
encontrado de lo que falta; no llenar impuestos ni cifras desconocidas con ceros
que parezcan confirmados. Antes de guardar, explicar “Este será un registro
provisional del gasto; no se está emitiendo una factura”. Confirmar también si
se guardó el original: en demo no se conserva; en cuenta se guarda al confirmar.

Captura manual: aplicar también la regla de no asumir impuestos desconocidos
como cero. Si faltan RFC o desglose, explicar qué dato se necesita y cómo obtenerlo;
no pedir a la persona que lo invente. Permitir una anotación simplificada con datos
desconocidos requerirá definir y validar ese contrato en servidor, diferenciándola
de un documento listo para comparar. No anunciar que cualquier gasto se puede
guardar hasta resolver esa dependencia y probar los casos incompletos.

Movimientos: ofrecer una plantilla descargable compatible con el parser actual,
con ejemplos de dinero recibido y pagado. Después, permitir mapear columnas de
archivos compatibles y revisar signos/fechas; ese paso requerirá validación de
datos, no sólo una pantalla nueva. No prometer importar cualquier banco ni PDF
bancario. Explicar que la carga no conecta una cuenta bancaria.

Todos los flujos tendrán vista previa cuando corresponde, acción explícita de
guardado, espera visible, protección frente a doble clic y resultado cerca de
la acción. El CSV con filas inválidas explicará qué filas corregir y que no se
agregó ningún movimiento. Los mensajes distinguirán lo leído de lo realmente añadido;
conteos nuevos/repetidos sólo se mostrarán si se obtienen de un resultado fiable.

Errores: decir qué ocurrió, qué datos se conservaron y qué puede hacer la persona.
Conservar campos corregidos al fallar el guardado. Para una sesión expirada,
explicar cómo volver a entrar; para cuotas, cuándo reintentar si se conoce.
No inventar porcentajes de progreso: usar fases cuando no exista progreso medible.

Criterio de salida: la persona sabe qué eligió, qué se guardó y qué hacer después;
puede corregir un fallo sin perder lo que ya revisó.

## Entrega 4 — Revisión, documentos y ayuda dentro del contexto

El movimiento mostrará descripción, fecha, importe, dirección y documento asociado
o causa del pendiente. El usuario comparará documento y movimiento juntos. Para
decidir, priorizar proveedor, concepto, fecha e importe antes del identificador largo.
Las causas deben salir de datos o reglas reales, sin deducir motivos inexistentes.

Quitar una relación explicará su efecto y permitirá volver a buscar; no borrará
el movimiento ni la factura. Si un documento compite entre movimientos, el diálogo
explicará el conflicto y evitará ofrecer relaciones que el servidor rechazará.

El detalle de documento tendrá este orden: qué documento es, quién lo emitió,
para quién es, fecha, importe, relación con movimientos y tareas disponibles.
Los campos fiscales y del XML irán en un apartado desplegable, siempre accesible.

Pagos: destacar el monto declarado del pago y la factura referenciada. Ejemplo
sintético: “Según este documento quedaban 116 pesos; registra un pago de 58 y
quedaban 58 después”. Mostrar fecha, moneda y que no se calcula el saldo actual.
El cero/XXX del XML tendrá explicación secundaria y no encabezará la tarjeta.
No sumar ni convertir saldos de monedas distintas automáticamente.

Notas de crédito: explicar qué factura relacionan y el ajuste que declara el
documento. No anunciar una devolución bancaria ni descontar dinero del resumen
por importar esa nota. Facturas sin el documento relacionado cargado ofrecerán
la tarea de agregarlo; no mostrarán una relación interna inexistente.

SAT: `Consultar estado de la factura en el SAT`, con respuesta, fecha y fuente.
“No encontrado”, “sin consultar” y “no pudimos obtener una respuesta” serán
estados distintos. Vigente no se presentará como permiso para deducir ni como
validación integral. Las alertas de ejemplo y oficiales se distinguirán claramente.

Ayuda: explicaciones cortas junto al concepto y preguntas como `¿Qué necesita
mi atención?`. Se reutilizarán las guías fiables; ninguna tarea dependerá del chat
ni de descargar el modelo local. Activación y configuración de IA serán secundarias.

Respaldos: distinguir reporte para una hoja de cálculo de copia de recuperación.
Antes de descargar/restaurar explicar qué incluye y que PDF/fotos se descargan
por separado. La restauración conserva la exigencia de espacio vacío y mismo RFC;
no proponer borrar datos para quitar esa restricción.

Criterio de salida: el usuario entiende por qué debe decidir y el efecto de cada
decisión; diferencia datos guardados, relaciones encontradas y respuesta del SAT.

## Entrega 5 — Legibilidad, móvil y accesibilidad

Aplicar estas reglas desde la primera entrega y comprobarlas de forma completa al
cerrar el bloque. Objetivo: WCAG 2.2 AA para los recorridos modificados, sin
afirmar conformidad antes de evaluarla. Referencia: [WCAG 2.2](https://www.w3.org/TR/WCAG22/).

- Texto principal de 16 px como punto de partida; ayudas de 14 px legibles, con
  espacio y contraste. Es una decisión de diseño del proyecto, no un mínimo WCAG.
- Contraste medido de al menos 4.5:1 para texto normal y 3:1 para texto grande,
  con las excepciones del estándar. Texto e icono acompañan cualquier estado de color.
- Objetivo de controles principales de 44 × 44 px para móvil; verificar al menos
  los requisitos de tamaño/espaciado de WCAG 2.2 AA, sin confundir ambos criterios.
- Etiquetas accesibles incluso si el texto visual se oculta; foco visible,
  navegación con teclado, orden lógico, mensajes de estado anunciables.
- Modales identificados como diálogos, foco dentro, Escape cuando sea seguro,
  cierre con nombre accesible y devolución del foco al control que los abrió.
- Respetar preferencia de movimiento reducido y evitar parpadeo de pendientes.
- Verificar ancho 320, 390, 768 y 1280 px, zoom al 200 %, importes largos y UUID.
  Las decisiones y botones deben poder verse sin depender de desplazamiento
  horizontal; revisar excepciones de tablas cuando haya contenido bidimensional.
- Reservar rojo para fallos o alertas que requieran esa intensidad; pendientes
  normales tendrán una presentación neutral con acción clara.

Criterio de salida: los recorridos críticos pueden completarse en móvil y con
teclado, sin truncar significado, esconder acciones o depender exclusivamente del color.

## Comprobación de comprensión sin contexto

Preparar archivos y cuentas sintéticos. Mostrar la app sin explicar vocabulario ni
dar instrucciones sobre qué botón usar. Pedir al dueño tareas, no un tour guiado:

1. Entrar y explicar si está viendo ejemplos o datos de su cuenta, qué hace
   FacturIA y cuál sería el primer paso.
2. Agregar una factura de proveedor y explicar si representa dinero recibido,
   un documento de compra o una confirmación de pago.
3. Agregar movimientos de un archivo; corregir una fila inválida y entender
   qué se guardó, si se conectó el banco y qué representa el resumen.
4. Encontrar un movimiento pendiente, agregar su documento y explicar si
   quedó relacionado o por qué aún requiere revisión.
5. Revisar coincidencias, incluidas varias facturas y una factura disputada;
   elegir una relación válida y explicar el efecto de quitarla/volver a buscar.
6. Leer una foto/PDF, corregir un campo y guardar entendiendo que es provisional.
7. Abrir un pago parcial y una nota de crédito; distinguir importe del pago,
   saldo indicado en esa fecha y movimientos bancarios que realmente cargó.
8. Distinguir una relación de documentos del estado consultado en el SAT.
9. Descargar un reporte y una copia para recuperación; identificar originales
   excluidos y por qué no se puede restaurar sobre un espacio ocupado.

Registrar tarea completada, dudas, errores, ayudas solicitadas y explicación final.
Meta interna inicial: completar el primer recorrido en cinco minutos y resolver
las tareas principales sin intervención; el tiempo es orientativo, no requisito
normativo. Si el dueño necesita contexto de Codex, esa tarea requiere otra iteración.
Si están disponibles, ampliar después a tres personas nuevas; no atribuir resultados
de esos usuarios a una revisión automatizada o a las opiniones de los desarrolladores.

Bloquean el cierre las confusiones de consecuencias: creer que se emitió una
factura, se movió dinero, se conoce el saldo real, se comprobó una deducción o se
guardó un cambio que falló. La estética se revisa también, después de esas causas.

## Ejecución técnica y puntos de guardado

1. Entrega 1: vocabulario compartido de UI y acciones corregidas, sin cambiar los
   nombres persistidos de los estados ni formatos XML/CSV/JSON.
2. Entrega 2: shell, navegación e inicio; separar movimientos/documentos sin perder
   el estado de cargas abiertas ni confundir demo y cuenta.
3. Entrega 3: componentes de carga y mensajes de resultado. Cualquier cambio de
   contrato necesario para conteos, mapeo o perfil incompleto se prueba también en servidor.
4. Entrega 4: diálogos, detalle, tareas contextuales, ayuda y descargas.
5. Entrega 5: revisión integral móvil/accesibilidad y prueba de comprensión del dueño.

Cada entrega tendrá commit en `sprint-1`, con la cuenta y autoría autorizadas.
Mantener la demo y el aislamiento por cuenta. Ejecutar `npm run check` cuando haya
implementación y pruebas funcionales de los recorridos afectados, con énfasis en
guardado real, fallo/reintento, foco y significado de estados. No añadir pruebas que
sólo repitan textos; preservar regresiones de importación, relaciones, monedas y permisos.

Publicar en staging sólo una implementación probada y guardar evidencia visual.
El plan no modifica el deployment actual. La promoción a `main` sigue requiriendo
autorización explícita. No iniciar correos, dominio/remitente, WhatsApp ni nuevos
proveedores o servicios. Esta fase no necesita otra base de datos ni API de pago;
Railway conserva el límite de USD 10 para recursos del workspace.

Primera implementación prevista: Entrega 1 y el inicio guiado de la Entrega 2;
validar ese recorrido antes de extender la nueva experiencia a toda la app.
