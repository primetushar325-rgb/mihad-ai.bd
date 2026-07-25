import test from 'node:test';
import assert from 'node:assert/strict';
import { encrypt, decrypt } from '../src/services/crypto.service.js';

test('OAuth token vault round-trips without exposing plaintext', () => {
  const secret = 'refresh-token-example';
  const payload = encrypt(secret);
  assert.notEqual(payload, secret);
  assert.equal(payload.split('.').length, 3);
  assert.equal(decrypt(payload), secret);
});

test('OAuth token vault rejects tampered ciphertext', () => {
  const payload = encrypt('sensitive-token');
  const [iv, tag, body] = payload.split('.');
  const tampered = `${iv}.${tag}.${body.slice(0, -1)}${body.endsWith('A') ? 'B' : 'A'}`;
  assert.throws(() => decrypt(tampered));
});
