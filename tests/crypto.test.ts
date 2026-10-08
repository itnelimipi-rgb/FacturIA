import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { CredentialCryptoService } from '../src/lib/crypto';

test('credential encryption fails closed without a sufficiently strong configured secret', () => {
  const previous = process.env.FACTURIA_ENCRYPTION_SECRET;
  try {
    delete process.env.FACTURIA_ENCRYPTION_SECRET;
    assert.throws(() => CredentialCryptoService.encrypt('synthetic'), /clave/);
    process.env.FACTURIA_ENCRYPTION_SECRET = 'short';
    assert.throws(() => CredentialCryptoService.encrypt('synthetic'), /clave/);
  } finally { if (previous === undefined) delete process.env.FACTURIA_ENCRYPTION_SECRET; else process.env.FACTURIA_ENCRYPTION_SECRET = previous; }
});
test('AES-GCM uses distinct IVs, round trips and rejects tampering', () => {
  const previous = process.env.FACTURIA_ENCRYPTION_SECRET;
  try {
    process.env.FACTURIA_ENCRYPTION_SECRET = randomBytes(32).toString('base64');
    const first = CredentialCryptoService.encrypt('synthetic credential');
    const second = CredentialCryptoService.encrypt('synthetic credential');
    assert.notEqual(first, second);
    assert.equal(CredentialCryptoService.decrypt(first), 'synthetic credential');
    const parts = first.split(':');
    parts[1] = (parts[1][0] === '0' ? '1' : '0') + parts[1].slice(1);
    assert.throws(() => CredentialCryptoService.decrypt(parts.join(':')));
  } finally { if (previous === undefined) delete process.env.FACTURIA_ENCRYPTION_SECRET; else process.env.FACTURIA_ENCRYPTION_SECRET = previous; }
});
