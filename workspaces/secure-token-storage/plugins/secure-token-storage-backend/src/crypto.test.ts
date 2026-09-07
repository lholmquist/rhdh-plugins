/*
 * Copyright Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import { createTokenCipher, TokenCipherError } from './crypto';

const oldKey = Buffer.alloc(32, 1).toString('base64');
const activeKey = Buffer.alloc(32, 2).toString('base64');

describe('TokenCipher', () => {
  it('encrypts and decrypts with authenticated associated data', () => {
    const cipher = createTokenCipher({
      activeKey,
      activeKeyVersion: 'v2',
    });
    const encrypted = cipher.encrypt('access-token', 'user/provider/1');

    expect(encrypted.ciphertext).not.toBe('access-token');
    expect(cipher.decrypt(encrypted, 'user/provider/1')).toBe('access-token');
    expect(() => cipher.decrypt(encrypted, 'different-record')).toThrow(
      TokenCipherError,
    );
  });

  it('decrypts records written with a previous key version', () => {
    const oldCipher = createTokenCipher({
      activeKey: oldKey,
      activeKeyVersion: 'v1',
    });
    const encrypted = oldCipher.encrypt('refresh-token', 'connection/refresh');
    const rotatedCipher = createTokenCipher({
      activeKey,
      activeKeyVersion: 'v2',
      previousKeys: { v1: oldKey },
    });

    expect(rotatedCipher.decrypt(encrypted, 'connection/refresh')).toBe(
      'refresh-token',
    );
  });

  it('rejects keys that are not 32 bytes', () => {
    expect(() =>
      createTokenCipher({
        activeKey: Buffer.alloc(16).toString('base64'),
        activeKeyVersion: 'v1',
      }),
    ).toThrow('must decode to 32 bytes');
  });
});
