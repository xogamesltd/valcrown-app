'use strict';
/**
 * ValCrown Client Encryption
 * Used in Electron app (Node.js environment)
 * Encrypts sensitive data stored locally
 */

const crypto = require('crypto');

class ValCrownCrypto {
  constructor(machineKey) {
    // Derive a 32-byte key from the machine identifier
    this.key = crypto.createHash('sha256')
      .update(machineKey + 'valcrown-salt-2026')
      .digest();
  }

  // Encrypt string → encrypted string (for storing tokens, keys locally)
  encrypt(text) {
    const iv      = crypto.randomBytes(16);
    const cipher  = crypto.createCipheriv('aes-256-cbc', this.key, iv);
    const enc     = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    return iv.toString('base64') + '.' + enc.toString('base64');
  }

  // Decrypt encrypted string → original string
  decrypt(encText) {
    try {
      const [ivB64, dataB64] = encText.split('.');
      const decipher = crypto.createDecipheriv('aes-256-cbc', this.key, Buffer.from(ivB64, 'base64'));
      const dec      = Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]);
      return dec.toString('utf8');
    } catch(e) {
      return null;
    }
  }

  // Sign a request payload (for API calls from Electron)
  signPayload(method, path, body) {
    const ts      = Date.now().toString();
    const payload = `${method}:${path}:${ts}:${JSON.stringify(body || {})}`;
    const sig     = crypto.createHmac('sha256', this.key).update(payload).digest('hex');
    return { 'X-Request-Time': ts, 'X-Request-Sig': sig };
  }

  // Generate machine fingerprint
  static getMachineId() {
    const os  = require('os');
    const raw = [
      os.hostname(),
      os.platform(),
      os.arch(),
      os.cpus()[0]?.model || 'unknown',
      os.totalmem().toString()
    ].join('|');
    return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 32);
  }
}

module.exports = ValCrownCrypto;
