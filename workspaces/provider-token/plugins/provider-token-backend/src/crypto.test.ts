/*
 * Copyright Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import {
  createTokenCipher,
  secretAssociatedData,
  TokenCipherError,
} from './crypto';

const v1Key = Buffer.alloc(32, 1).toString('base64');
const v2Key = Buffer.alloc(32, 2).toString('base64');

describe('provider-token secret encryption', () => {
  it('encrypts and decrypts refresh material bound to its owner and provider', () => {
    const cipher = createTokenCipher({
      activeKey: v1Key,
      activeKeyVersion: 'v1',
    });
    const aad = secretAssociatedData(
      'user:default/alice',
      'github',
      'refresh-token',
    );
    const encrypted = cipher.encrypt('sensitive-refresh-material', aad);

    expect(encrypted.ciphertext).not.toContain('sensitive-refresh-material');
    expect(cipher.decrypt(encrypted, aad)).toBe('sensitive-refresh-material');
    expect(() =>
      cipher.decrypt(
        encrypted,
        secretAssociatedData('user:default/bob', 'github', 'refresh-token'),
      ),
    ).toThrow(TokenCipherError);
    expect(() =>
      cipher.decrypt(
        encrypted,
        secretAssociatedData(
          'user:default/alice',
          'microsoft',
          'refresh-token',
        ),
      ),
    ).toThrow(TokenCipherError);
  });

  it('decrypts with a previous key while writing with the active key', () => {
    const originalCipher = createTokenCipher({
      activeKey: v1Key,
      activeKeyVersion: 'v1',
    });
    const aad = secretAssociatedData(
      'user:default/alice',
      'microsoft',
      'connect-verifier',
    );
    const oldRecord = originalCipher.encrypt('pkce-verifier', aad);
    const rotatedCipher = createTokenCipher({
      activeKey: v2Key,
      activeKeyVersion: 'v2',
      previousKeys: { v1: v1Key },
    });

    expect(rotatedCipher.decrypt(oldRecord, aad)).toBe('pkce-verifier');
    expect(rotatedCipher.encrypt('new-refresh-token', aad).keyVersion).toBe(
      'v2',
    );
  });

  it('rejects ciphertext whose authentication tag was modified', () => {
    const cipher = createTokenCipher({
      activeKey: v1Key,
      activeKeyVersion: 'v1',
    });
    const encrypted = cipher.encrypt(
      'sensitive-refresh-material',
      'owner/provider/refresh-token',
    );
    const tag = Buffer.from(encrypted.authTag, 'base64');
    tag[0] = tag[0]! ^ 0xff;

    expect(() =>
      cipher.decrypt(
        { ...encrypted, authTag: tag.toString('base64') },
        'owner/provider/refresh-token',
      ),
    ).toThrow('integrity or format validation');
  });

  it('rejects malformed and conflicting key configuration', () => {
    expect(() =>
      createTokenCipher({
        activeKey: Buffer.alloc(16).toString('base64'),
        activeKeyVersion: 'v1',
      }),
    ).toThrow('exactly 32 bytes');
    expect(() =>
      createTokenCipher({
        activeKey: v1Key,
        activeKeyVersion: 'v1',
        previousKeys: { v1: v2Key },
      }),
    ).toThrow('must not also appear');
  });
});
