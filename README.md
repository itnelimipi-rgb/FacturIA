# FacturIA - Plataforma de Tesorería Automatizada & CFO Virtual 🇲🇽

> **MVP Funcional para PyMEs y Comercios Independientes en México (RESICO / Actividad Empresarial)**

---

## 🏛️ 1. Arquitectura y Reglas Críticas (No Negociables)

1. **Separación Estricta Agéntica vs. Determinista**:
   - **IA Agéntica / Multimodal**: Exclusivamente empleada para la extracción y parsing semántico de comprobantes no estructurados (tickets físicos, fotografías comprimidas en cliente, PDFs escaneados) y explicaciones en lenguaje natural.
   - **Motor Determinista Puro**: CERO operaciones matemáticas delegadas a LLMs. El cálculo de subtotales, desglose de IVA (16%), retenciones (1.25% RESICO / 10% honorarios), balance bancario y el motor de matching corren en funciones deterministas puras en TypeScript (`MatchingEngineService.ts`).
2. **Control de COGS y Optimización de Tokens**:
   - Insumo XML: Parser sintáctico nativo (`fast-xml-parser`). Consumo de LLM = **0 tokens**.
   - Insumo PDF vectorial: Extracción sintáctica y expresiones regulares. Fallback a modelo de texto si es necesario.
   - Insumo Ticket Físico / Imagen: Compresión en cliente antes del envío y extracción semántica estructurada con JSON Schema.
3. **Seguridad y Cumplimiento Fiscal**:
   - Cifrado en reposo **AES-256-GCM** para credenciales sensibles del SAT (CIEC y Certificados de Sello Digital CSD).
   - Aislamiento multi-tenant con **Row Level Security (RLS)** en Supabase/PostgreSQL.
   - Detección inmediata de Empresas que Facturan Operaciones Simuladas (**EFOS - Artículo 69-B del CFF**).

---

## 📂 2. Estructura del Proyecto

```
facturia/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── ingest/route.ts      # Endpoint de ingesta XML (0 tokens) / PDF / Imágenes
│   │   │   ├── matching/route.ts    # Endpoint de conciliación determinista
│   │   │   └── efos/route.ts        # Endpoint de consulta a lista negra Art. 69-B
│   │   ├── globals.css              # Estilos base Tailwind y animaciones
│   │   ├── layout.tsx               # Root layout mobile-first con metadatos
│   │   └── page.tsx                 # Dashboard unificado de FacturIA
│   ├── components/
│   │   ├── CashFlowShield.tsx       # Escudo de Flujo de Caja (3 KPIs directos)
│   │   ├── UnifiedDropzone.tsx      # Ingesta multi-formato (.xml, .pdf, .jpg/png)
│   │   ├── TreasuryInbox.tsx        # Inbox clasificado en 3 pestañas dinámicas
│   │   ├── AmbiguousResolverModal.tsx # Selector interactivo 1-clic para ambiguos
│   │   └── CfdiDetailModal.tsx      # Visor detallado de CFDI timbrado SAT
│   └── lib/
│       ├── MatchingEngineService.ts # Motor determinista (+/- 3 días, centavos <= 0.01)
│       ├── xmlParser.ts             # Parser nativo CFDI 4.0 / 3.3 (0 tokens)
│       ├── efosService.ts           # Servicio y mock de lista negra SAT Art. 69-B
│       ├── crypto.ts                # Cifrado AES-256-GCM de CIEC y CSD
│       ├── mockStore.ts             # Almacén reactivo y persistencia local
│       ├── seed.ts                  # Datos de prueba requeridos por especificación
│       └── types.ts                 # Interfaces TypeScript del sistema
├── supabase/
│   └── migrations/
│       └── 20260910000001_facturia_schema.sql # Esquema SQL, triggers y políticas RLS
├── tests/
│   ├── run_verification.js          # Suite de verificación unitaria
│   └── run_verification.py          # Script de validación automatizada
├── package.json
├── tsconfig.json
└── tailwind.config.js
```

---

## ⚡ 3. Motor Determinista de Conciliación (`MatchingEngineService`)

El motor evalúa cada movimiento bancario bajo 3 reglas jerárquicas estrictas:

```typescript
// 1. Detección inmediata de EFOS Art. 69-B
const efosHit = cfdis.find(c => c.isEfos);
if (efosHit) {
  return { status: 'discrepancia', alertReason: `Alerta EFOS Art. 69-B en RFC: ${efosHit.rfc}` };
}

// 2. Filtro estricto: Tolerancia +/- 3 días naturales y diferencia <= 0.01
const exactMatches = cfdis.filter(c => {
  const amountDiff = Math.abs(c.total - Math.abs(bankTx.amount));
  const dayDiff = Math.abs((c.fecha.getTime() - bankTx.date.getTime()) / (1000 * 3600 * 24));
  return amountDiff <= 0.01 && dayDiff <= 3;
});

// 3. Clasificación de tres estados
if (exactMatches.length === 1) {
  return { status: 'conciliado', matchedCfdiId: exactMatches[0].id };
} else if (exactMatches.length > 1) {
  return { status: 'ambiguo', candidateCfdiIds: exactMatches.map(m => m.id) };
} else {
  return { status: 'discrepancia', alertReason: 'Movimiento sin CFDI correspondiente vinculado' };
}
```

---

## 📊 4. Escudo de Flujo de Caja (3 KPIs Directos)

1. **Saldo en Bancos**: Saldo neto consolidado disponible proveniente de la integración con Open Banking (`$14,490.00 MXN`).
2. **Gasto No Deducible Detectado (Discrepancias)**: Monto de salidas bancarias sin CFDI o con RFC en EFOS (`$12,400.00 MXN`), con cálculo del **costo fiscal en riesgo** (`$5,704.00 MXN`, que corresponde al 30% de ISR no deducible + 16% de IVA no acreditable).
3. **Retenciones Proyectadas**: Acumulado de retenciones en comprobantes timbrados (`$312.50 MXN` de retención 1.25% RESICO).

---

## 🧪 5. Datos de Prueba Estructurados (`seed.ts`)

- **1 Usuario Emprendedor**:
  - RFC: `GARM900101XYZ`
  - Razón Social: `GARCÍA MARTÍNEZ TECH & CONSULTING`
  - Régimen: `626 - Régimen Simplificado de Confianza (RESICO)`
- **5 Transacciones Bancarias Representativas**:
  1. `tx-001`: Pago proveedor Cloud (`-$1,160.00 MXN`) ➡️ 🟢 **Concilia automáticamente** con CFDI de Google Cloud.
  2. `tx-002`: Cobro cliente consultoría (`+$29,000.00 MXN`) ➡️ 🟢 **Concilia automáticamente** con CFDI de Ingreso.
  3. `tx-003`: Pago día coworking Reforma (`-$450.00 MXN`) ➡️ 🟢 **Concilia automáticamente** con CFDI de WeWork.
  4. `tx-004`: Cargo publicidad digital (`-$500.00 MXN`) ➡️ 🟡 **Ambiguo** (2 facturas candidatas válidas en ventana $\pm 3$ días: Meta Ads y Google Ads de $500.00). Incluye selector interactivo para resolver en 1 clic.
  5. `tx-005`: Retiro o transferencia en ventanilla (`-$12,400.00 MXN`) ➡️ 🔴 **Discrepancia** (gasto sin factura vinculada, riesgo de no deducibilidad). Al subir el XML correspondiente mediante el dropzone, se concilia automáticamente en tiempo real.

---

## 🛡️ 6. Esquema SQL Supabase & RLS

El archivo [`supabase/migrations/20260910000001_facturia_schema.sql`](./supabase/migrations/20260910000001_facturia_schema.sql) incluye:
- Tablas `profiles`, `bank_transactions`, `cfdi_records`, y `efos_blacklist`.
- Validación estricta con RegEx SAT Anexo 20: `CHECK (rfc ~ '^[A-Z&Ñ]{3,4}[0-9]{6}[A-Z0-9]{3}$')`.
- Trigger `trg_check_cfdi_efos` para validación automática de RFCs contra el Artículo 69-B.
- Políticas RLS por tenant vinculadas a `auth.uid() = user_id`.

---

## 🚀 7. Ejecución y Pruebas

Para validar la lógica matemática y determinista:
```bash
python tests/run_verification.py
```
*Resultado: 7 pruebas automatizadas superadas con 100% de éxito.*
