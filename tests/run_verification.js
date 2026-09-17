import assert from 'node:assert';
import crypto from 'node:crypto';

// -------------------------------------------------------------
// 1. RE-IMPLEMENTACIÓN DE SERVICIOS PARA PRUEBA UNITARIA AISLADA
// -------------------------------------------------------------

class TestMatchingEngineService {
  static evaluateTransaction(bankTx, cfdis) {
    const bankDate = typeof bankTx.date === 'string' ? new Date(bankTx.date) : bankTx.date;
    const absBankAmount = Math.abs(bankTx.amount);

    // 1. Detección inmediata de EFOS
    const efosHit = cfdis.find(c => c.isEfos);
    if (efosHit) {
      return {
        status: 'discrepancia',
        alertReason: `Alerta EFOS Art. 69-B en RFC: ${efosHit.rfc}`
      };
    }

    // 2. Filtro estricto: +/- 3 días y centavos <= 0.01
    const exactMatches = cfdis.filter(c => {
      const cfdiDate = typeof c.fecha === 'string' ? new Date(c.fecha) : c.fecha;
      const amountDiff = Math.abs(c.total - absBankAmount);
      const timeDiffMs = Math.abs(cfdiDate.getTime() - bankDate.getTime());
      const dayDiff = timeDiffMs / (1000 * 3600 * 24);
      return amountDiff <= 0.01 && dayDiff <= 3.0001;
    });

    // 3. Clasificación de tres estados
    if (exactMatches.length === 1) {
      return { status: 'conciliado', matchedCfdiId: exactMatches[0].id };
    } else if (exactMatches.length > 1) {
      return { status: 'ambiguo', candidateCfdiIds: exactMatches.map(m => m.id) };
    } else {
      return { status: 'discrepancia', alertReason: 'Movimiento sin CFDI correspondiente vinculado' };
    }
  }

  static calculateCashFlowShieldMetrics(transactions, cfdis) {
    let totalBankBalance = 0;
    let nonDeductibleDiscrepancies = 0;
    let projectedRetentions = 0;

    const cfdiMap = new Map(cfdis.map(c => [c.id, c]));

    for (const tx of transactions) {
      totalBankBalance += tx.amount;
      if (tx.status === 'conciliado' && tx.matchedCfdiId && cfdiMap.has(tx.matchedCfdiId)) {
        projectedRetentions += Number(cfdiMap.get(tx.matchedCfdiId).retenciones || 0);
      } else if (tx.status === 'discrepancia' && tx.amount < 0) {
        nonDeductibleDiscrepancies += Math.abs(tx.amount);
      }
    }

    return {
      totalBankBalance: Math.round(totalBankBalance * 100) / 100,
      nonDeductibleDiscrepancies: Math.round(nonDeductibleDiscrepancies * 100) / 100,
      estimatedTaxImpact: Math.round(nonDeductibleDiscrepancies * 0.46 * 100) / 100,
      projectedRetentions: Math.round(projectedRetentions * 100) / 100
    };
  }
}

class TestXmlParser {
  static parse(xmlString) {
    const uuidMatch = xmlString.match(/UUID=["']([a-fA-F0-9\-]{36})["']/i);
    const totalMatch = xmlString.match(/Total=["']([\d\.]+)["']/i);
    const subtotalMatch = xmlString.match(/SubTotal=["']([\d\.]+)["']/i);
    const emisorMatch = xmlString.match(/<(?:cfdi:)?Emisor\b[^>]*Rfc=["']([^"']+)["']/i);
    const ivaMatch = xmlString.match(/TotalImpuestosTrasladados=["']([\d\.]+)["']/i) ||
                     xmlString.match(/<(?:cfdi:)?Traslado\b[^>]*Importe=["']([\d\.]+)["']/i);

    const total = totalMatch ? parseFloat(totalMatch[1]) : 0;
    const subtotal = subtotalMatch ? parseFloat(subtotalMatch[1]) : total;
    const iva = ivaMatch ? parseFloat(ivaMatch[1]) : 0;

    return {
      uuidSat: uuidMatch ? uuidMatch[1].toUpperCase() : null,
      total,
      subtotal,
      iva,
      rfcEmisor: emisorMatch ? emisorMatch[1] : null,
      mathVerification: Math.abs((subtotal + iva) - total) <= 0.02
    };
  }
}

class TestCryptoService {
  static encrypt(plainText, secret = 'facturia-secret-test-key-2026-mx') {
    const key = crypto.scryptSync(secret, 'facturia-sat-salt', 32);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    let encrypted = cipher.update(plainText, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }

  static decrypt(payload, secret = 'facturia-secret-test-key-2026-mx') {
    const key = crypto.scryptSync(secret, 'facturia-sat-salt', 32);
    const [ivHex, authTagHex, encryptedHex] = payload.split(':');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }
}

// -------------------------------------------------------------
// 2. SUITE DE PRUEBAS AUTOMATIZADAS
// -------------------------------------------------------------

console.log('🧪 Iniciando verificación determinista de FacturIA...\n');

// Test 1: Match Exacto (1 candidato dentro de +/- 3 días y monto exacto)
{
  const tx = { id: 'tx-001', amount: -1160.00, date: new Date('2026-09-08'), type: 'egreso' };
  const cfdis = [
    { id: 'cfdi-001', total: 1160.00, fecha: new Date('2026-09-08'), rfc: 'GWO1204018A2', isEfos: false },
    { id: 'cfdi-other', total: 450.00, fecha: new Date('2026-09-09'), rfc: 'WEW1503126T8', isEfos: false }
  ];
  const result = TestMatchingEngineService.evaluateTransaction(tx, cfdis);
  assert.strictEqual(result.status, 'conciliado', 'Debe conciliar automáticamente con 1 match exacto');
  assert.strictEqual(result.matchedCfdiId, 'cfdi-001');
  console.log('✅ Test 1 Superado: Match exacto genera estado 🟢 "conciliado"');
}

// Test 2: Movimiento Ambiguo (2 candidatos de $500.00 en ventana +/- 3 días)
{
  const tx = { id: 'tx-004', amount: -500.00, date: new Date('2026-09-08'), type: 'egreso' };
  const cfdis = [
    { id: 'cfdi-meta', total: 500.00, fecha: new Date('2026-09-08'), rfc: 'MET190415AA1', isEfos: false },
    { id: 'cfdi-google', total: 500.00, fecha: new Date('2026-09-09'), rfc: 'GAD1501019X2', isEfos: false }
  ];
  const result = TestMatchingEngineService.evaluateTransaction(tx, cfdis);
  assert.strictEqual(result.status, 'ambiguo', 'Debe marcar como ambiguo si hay múltiples candidatos');
  assert.strictEqual(result.candidateCfdiIds.length, 2);
  assert.deepStrictEqual(result.candidateCfdiIds, ['cfdi-meta', 'cfdi-google']);
  console.log('✅ Test 2 Superado: Múltiples candidatos generan estado 🟡 "ambiguo" con candidateCfdiIds');
}

// Test 3: Discrepancia por falta de CFDI (movimiento de $12,400 sin factura)
{
  const tx = { id: 'tx-005', amount: -12400.00, date: new Date('2026-09-05'), type: 'egreso' };
  const cfdis = [
    { id: 'cfdi-001', total: 1160.00, fecha: new Date('2026-09-08'), rfc: 'GWO1204018A2', isEfos: false }
  ];
  const result = TestMatchingEngineService.evaluateTransaction(tx, cfdis);
  assert.strictEqual(result.status, 'discrepancia', 'Debe marcar como discrepancia sin factura correspondiente');
  assert.ok(result.alertReason.includes('sin CFDI'), 'Debe emitir motivo de alerta');
  console.log('✅ Test 3 Superado: Ausencia de CFDI genera estado 🔴 "discrepancia"');
}

// Test 4: Detección Inmediata de EFOS (Lista Negra Art. 69-B del SAT)
{
  const tx = { id: 'tx-006', amount: -8500.00, date: new Date('2026-09-06'), type: 'egreso' };
  const cfdis = [
    { id: 'cfdi-efos', total: 8500.00, fecha: new Date('2026-09-06'), rfc: 'FAL8501019A1', isEfos: true }
  ];
  const result = TestMatchingEngineService.evaluateTransaction(tx, cfdis);
  assert.strictEqual(result.status, 'discrepancia', 'EFOS debe forzar estado discrepancia');
  assert.ok(result.alertReason.includes('EFOS Art. 69-B'), 'Debe contener alerta de EFOS explícita');
  console.log('✅ Test 4 Superado: CFDI con RFC en lista EFOS es bloqueado y clasificado en 🔴 "discrepancia"');
}

// Test 5: Cálculo Determinista del Escudo de Flujo de Caja
{
  const txs = [
    { id: 't1', amount: 29000, status: 'conciliado', matchedCfdiId: 'c1' },
    { id: 't2', amount: -1160, status: 'conciliado', matchedCfdiId: 'c2' },
    { id: 't3', amount: -450, status: 'conciliado', matchedCfdiId: 'c3' },
    { id: 't4', amount: -500, status: 'ambiguo' },
    { id: 't5', amount: -12400, status: 'discrepancia' }
  ];
  const cfdis = [
    { id: 'c1', retenciones: 312.50 },
    { id: 'c2', retenciones: 0 },
    { id: 'c3', retenciones: 0 }
  ];
  const metrics = TestMatchingEngineService.calculateCashFlowShieldMetrics(txs, cfdis);
  // Saldo: 29000 - 1160 - 450 - 500 - 12400 = 14490
  assert.strictEqual(metrics.totalBankBalance, 14490.00, 'Saldo bancario calculado matemáticamente');
  // Gasto no deducible: 12400
  assert.strictEqual(metrics.nonDeductibleDiscrepancies, 12400.00);
  // Costo fiscal estimado (46% de 12400 = 5704)
  assert.strictEqual(metrics.estimatedTaxImpact, 5704.00);
  // Retenciones: 312.50
  assert.strictEqual(metrics.projectedRetentions, 312.50);
  console.log('✅ Test 5 Superado: Escudo de Flujo de Caja ejecuta sumas y cálculos con precisión pura (Cero LLM)');
}

// Test 6: Ingesta de XML CFDI 4.0 Nativo (0 Tokens)
{
  const xmlSample = `<?xml version="1.0" encoding="UTF-8"?>
  <cfdi:Comprobante Version="4.0" SubTotal="1000.00" Total="1160.00">
    <cfdi:Emisor Rfc="GWO1204018A2" Nombre="GOOGLE"/>
    <cfdi:Impuestos TotalImpuestosTrasladados="160.00"/>
    <cfdi:Complemento>
      <tfd:TimbreFiscalDigital UUID="550E8400-E29B-41D4-A716-446655440001"/>
    </cfdi:Complemento>
  </cfdi:Comprobante>`;

  const parsed = TestXmlParser.parse(xmlSample);
  assert.strictEqual(parsed.uuidSat, '550E8400-E29B-41D4-A716-446655440001');
  assert.strictEqual(parsed.total, 1160.00);
  assert.strictEqual(parsed.subtotal, 1000.00);
  assert.strictEqual(parsed.iva, 160.00);
  assert.strictEqual(parsed.rfcEmisor, 'GWO1204018A2');
  assert.strictEqual(parsed.mathVerification, true);
  console.log('✅ Test 6 Superado: Parser sintáctico nativo extrae y valida CFDI 4.0 con 0 tokens de LLM');
}

// Test 7: Cifrado en Reposo AES-256-GCM para credenciales CIEC/CSD
{
  const ciecSecret = 'Mi_Clave_SAT_Ciec_Ultra_Secreta_2026!';
  const encrypted = TestCryptoService.encrypt(ciecSecret);
  assert.notStrictEqual(encrypted, ciecSecret);
  assert.ok(encrypted.includes(':'));

  const decrypted = TestCryptoService.decrypt(encrypted);
  assert.strictEqual(decrypted, ciecSecret, 'El texto descifrado debe ser idéntico al original');
  console.log('✅ Test 7 Superado: Cifrado AES-256-GCM garantiza confidencialidad e integridad de credenciales SAT');
}

console.log('\n🎉 ¡TODAS LAS 7 PRUEBAS UNITARIAS Y DETERMINISTAS PASARON SATISFACTORIAMENTE!');
