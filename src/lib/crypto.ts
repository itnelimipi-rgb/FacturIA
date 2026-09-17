import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // Recomendado para GCM
const AUTH_TAG_LENGTH = 16;

/**
 * Servicio de seguridad para cifrado en reposo de credenciales altamente sensibles del SAT:
 * - Contraseña CIEC (Clave de Identificación Electrónica Confidencial)
 * - Certificados de Sello Digital (CSD / Archivos .key y contraseñas)
 *
 * Emplea AES-256-GCM con autenticación criptográfica contra manipulaciones.
 */
export class CredentialCryptoService {
  private static masterKey: Buffer = crypto.scryptSync(
    process.env.FACTURIA_ENCRYPTION_SECRET || 'facturia-secret-salt-default-key-2026-mx',
    'facturia-sat-salt',
    32
  );

  /**
   * Cifra un texto plano o buffer devolviendo una cadena con IV + Tag + Ciphertext en Base64
   */
  static encrypt(plainText: string): string {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, this.masterKey, iv, {
      authTagLength: AUTH_TAG_LENGTH
    });

    let encrypted = cipher.update(plainText, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();

    // Estructura serializada: iv:authTag:encrypted
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }

  /**
   * Descifra una cadena previamente cifrada asegurando integridad mediante tag de autenticación
   */
  static decrypt(payload: string): string {
    const parts = payload.split(':');
    if (parts.length !== 3) {
      throw new Error('Formato de carga cifrada inválido. Se esperaba iv:authTag:ciphertext');
    }

    const [ivHex, authTagHex, encryptedHex] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');

    const decipher = crypto.createDecipheriv(ALGORITHM, this.masterKey, iv, {
      authTagLength: AUTH_TAG_LENGTH
    });
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }
}
