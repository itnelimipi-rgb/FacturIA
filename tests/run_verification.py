import re
import sys
from datetime import datetime, timedelta

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

print("🧪 Iniciando suite de validación determinista de FacturIA...")

# -------------------------------------------------------------
# 1. MOTOR DETERMINISTA DE CONCILIACIÓN
# -------------------------------------------------------------
class MatchingEngineService:
    @staticmethod
    def evaluate_transaction(bank_tx, cfdis):
        bank_date = bank_tx['date']
        bank_amount = abs(bank_tx['amount'])

        # 1. Detección inmediata de EFOS Art. 69-B
        efos_hit = next((c for c in cfdis if c.get('is_efos')), None)
        if efos_hit:
            return {
                'status': 'discrepancia',
                'alertReason': f"Alerta EFOS Art. 69-B en RFC: {efos_hit['rfc']} (Operaciones Simuladas)"
            }

        # 2. Tolerancia estricta: +/- 3 días naturales y diferencia <= 0.01
        exact_matches = []
        for c in cfdis:
            amount_diff = abs(c['total'] - bank_amount)
            day_diff = abs((c['fecha'] - bank_date).total_seconds()) / (24 * 3600)
            if amount_diff <= 0.01 and day_diff <= 3.0001:
                exact_matches.append(c)

        # 3. Clasificación determinista de tres estados
        if len(exact_matches) == 1:
            return {'status': 'conciliado', 'matched_cfdi_id': exact_matches[0]['id']}
        elif len(exact_matches) > 1:
            return {'status': 'ambiguo', 'candidate_cfdi_ids': [m['id'] for m in exact_matches]}
        else:
            return {'status': 'discrepancia', 'alertReason': 'Movimiento sin CFDI correspondiente vinculado'}

    @staticmethod
    def calculate_cash_flow_shield(transactions, cfdis):
        total_balance = sum(tx['amount'] for tx in transactions)
        non_deductible = sum(abs(tx['amount']) for tx in transactions if tx['status'] == 'discrepancia' and tx['amount'] < 0)
        tax_cost_risk = round(non_deductible * 0.46, 2) # 30% ISR + 16% IVA no acreditable

        cfdi_map = {c['id']: c for c in cfdis}
        projected_retentions = sum(
            cfdi_map[tx['matched_cfdi_id']].get('retenciones', 0)
            for tx in transactions
            if tx['status'] == 'conciliado' and tx.get('matched_cfdi_id') in cfdi_map
        )

        return {
            'total_balance': round(total_balance, 2),
            'non_deductible': round(non_deductible, 2),
            'tax_cost_risk': tax_cost_risk,
            'projected_retentions': round(projected_retentions, 2)
        }

# -------------------------------------------------------------
# PRUEBA 1: Match Exacto (Google Workspace $1,160.00)
# -------------------------------------------------------------
tx1 = {'id': 'tx-001', 'amount': -1160.00, 'date': datetime(2026, 9, 8), 'type': 'egreso'}
cfdis_tx1 = [
    {'id': 'cfdi-001', 'total': 1160.00, 'fecha': datetime(2026, 9, 8, 10, 15), 'rfc': 'GWO1204018A2', 'is_efos': False},
    {'id': 'cfdi-003', 'total': 450.00, 'fecha': datetime(2026, 9, 9, 9, 30), 'rfc': 'WEW1503126T8', 'is_efos': False}
]
res1 = MatchingEngineService.evaluate_transaction(tx1, cfdis_tx1)
assert res1['status'] == 'conciliado', "Error en Test 1"
assert res1['matched_cfdi_id'] == 'cfdi-001'
print("✅ Test 1 Superado: Match exacto genera estado 🟢 'conciliado' con UUID de CFDI")

# -------------------------------------------------------------
# PRUEBA 2: Movimiento Ambiguo (Campaña Digital $500.00 Meta vs Google)
# -------------------------------------------------------------
tx2 = {'id': 'tx-004', 'amount': -500.00, 'date': datetime(2026, 9, 8), 'type': 'egreso'}
cfdis_tx2 = [
    {'id': 'cfdi-004a', 'total': 500.00, 'fecha': datetime(2026, 9, 8, 18, 20), 'rfc': 'MET190415AA1', 'is_efos': False},
    {'id': 'cfdi-004b', 'total': 500.00, 'fecha': datetime(2026, 9, 9, 11, 10), 'rfc': 'GAD1501019X2', 'is_efos': False}
]
res2 = MatchingEngineService.evaluate_transaction(tx2, cfdis_tx2)
assert res2['status'] == 'ambiguo', "Error en Test 2"
assert len(res2['candidate_cfdi_ids']) == 2
print("✅ Test 2 Superado: Múltiples comprobantes en rango generan estado 🟡 'ambiguo' con lista de candidatos")

# -------------------------------------------------------------
# PRUEBA 3: Discrepancia por falta de CFDI ($12,400 sin factura)
# -------------------------------------------------------------
tx3 = {'id': 'tx-005', 'amount': -12400.00, 'date': datetime(2026, 9, 5), 'type': 'egreso'}
res3 = MatchingEngineService.evaluate_transaction(tx3, cfdis_tx1)
assert res3['status'] == 'discrepancia', "Error en Test 3"
assert 'sin CFDI' in res3['alertReason']
print("✅ Test 3 Superado: Salida no comprobada clasificada en 🔴 'discrepancia' (Gasto no deducible)")

# -------------------------------------------------------------
# PRUEBA 4: Alerta Inmediata de EFOS (Lista Negra Art. 69-B del SAT)
# -------------------------------------------------------------
tx_efos = {'id': 'tx-006', 'amount': -8500.00, 'date': datetime(2026, 9, 6), 'type': 'egreso'}
cfdis_efos = [
    {'id': 'cfdi-efos', 'total': 8500.00, 'fecha': datetime(2026, 9, 6), 'rfc': 'FAL8501019A1', 'is_efos': True}
]
res_efos = MatchingEngineService.evaluate_transaction(tx_efos, cfdis_efos)
assert res_efos['status'] == 'discrepancia', "Error en Test 4"
assert 'EFOS Art. 69-B' in res_efos['alertReason']
print("✅ Test 4 Superado: CFDI con RFC en lista negra EFOS bloqueado automáticamente en 🔴 'discrepancia'")

# -------------------------------------------------------------
# PRUEBA 5: Escudo de Flujo de Caja y Métricas Deterministas
# -------------------------------------------------------------
all_txs = [
    {'id': 'tx-001', 'amount': -1160.00, 'status': 'conciliado', 'matched_cfdi_id': 'cfdi-001'},
    {'id': 'tx-002', 'amount': 29000.00, 'status': 'conciliado', 'matched_cfdi_id': 'cfdi-002'},
    {'id': 'tx-003', 'amount': -450.00, 'status': 'conciliado', 'matched_cfdi_id': 'cfdi-003'},
    {'id': 'tx-004', 'amount': -500.00, 'status': 'ambiguo'},
    {'id': 'tx-005', 'amount': -12400.00, 'status': 'discrepancia'}
]
all_cfdis = [
    {'id': 'cfdi-001', 'retenciones': 0.0},
    {'id': 'cfdi-002', 'retenciones': 312.50}, # 1.25% RESICO
    {'id': 'cfdi-003', 'retenciones': 0.0}
]
metrics = MatchingEngineService.calculate_cash_flow_shield(all_txs, all_cfdis)
# Saldo: 29000 - 1160 - 450 - 500 - 12400 = 14,490
assert metrics['total_balance'] == 14490.00, "Saldo incorrecto"
assert metrics['non_deductible'] == 12400.00, "Gasto no deducible incorrecto"
assert metrics['tax_cost_risk'] == 5704.00, "Riesgo fiscal incorrecto"
assert metrics['projected_retentions'] == 312.50, "Retenciones incorrectas"
print("✅ Test 5 Superado: Escudo de Flujo de Caja verificado: Saldo=$14,490 | No Deducible=$12,400 | Riesgo=$5,704 | Retenciones=$312.50")

# -------------------------------------------------------------
# PRUEBA 6: Validación de RFC Mexicano RegEx (Esquema SQL)
# -------------------------------------------------------------
rfc_regex = re.compile(r'^[A-Z&Ñ]{3,4}[0-9]{6}[A-Z0-9]{3}$')
valid_rfcs = ['GARM900101XYZ', 'CLI1806059X1', 'FAL8501019A1', 'GWO1204018A2']
invalid_rfcs = ['INVALID123', '1234567890', 'GARM900101XYZZZ', '']

for rfc in valid_rfcs:
    assert rfc_regex.match(rfc), f"RFC válido rechazado: {rfc}"
for rfc in invalid_rfcs:
    assert not rfc_regex.match(rfc), f"RFC inválido aceptado: {rfc}"
print("✅ Test 6 Superado: RegEx SAT para Persona Física y Moral validado al 100%")

# -------------------------------------------------------------
# PRUEBA 7: Extracción XML CFDI 4.0 Nativo (0 Tokens de LLM)
# -------------------------------------------------------------
xml_sample = """<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0" SubTotal="1000.00" Total="1160.00">
  <cfdi:Emisor Rfc="GWO1204018A2" Nombre="Google Cloud Mexico"/>
  <cfdi:Impuestos TotalImpuestosTrasladados="160.00"/>
  <cfdi:Complemento xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital">
    <tfd:TimbreFiscalDigital UUID="550E8400-E29B-41D4-A716-446655440001"/>
  </cfdi:Complemento>
</cfdi:Comprobante>"""

uuid_match = re.search(r'UUID=["\']([a-fA-F0-9\-]{36})["\']', xml_sample)
subtotal_match = re.search(r'\bSubTotal=["\']([\d\.]+)["\']', xml_sample)
total_match = re.search(r'\bTotal=["\']([\d\.]+)["\']', xml_sample)
iva_match = re.search(r'TotalImpuestosTrasladados=["\']([\d\.]+)["\']', xml_sample)

assert uuid_match.group(1) == "550E8400-E29B-41D4-A716-446655440001"
subtotal = float(subtotal_match.group(1)) if subtotal_match else 0.0
total = float(total_match.group(1)) if total_match else 0.0
iva = float(iva_match.group(1)) if iva_match else 0.0
assert round(subtotal + iva, 2) == total, f"Fallo: {subtotal} + {iva} != {total}"
print("✅ Test 7 Superado: Parser XML determinista extrae UUID SAT, montos y valida matemáticamente con 0 tokens")

print("\n🎉 ¡TODAS LAS VALIDACIONES DETERMINISTAS DE FACTURIA HAN PASADO SATISFACTORIAMENTE!")

