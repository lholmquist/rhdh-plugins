/*
 * Copyright Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export interface EncryptedSecret {
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: string;
}

export type SecretPurpose =
  | 'refresh-token'
  | 'connect-verifier'
  | 'pending-refresh-token';

export class TokenCipherError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TokenCipherError';
  }
}

const decodeBase64 = (value: string, fieldName: string): Buffer => {
  if (
    !value ||
    value.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(value)
  ) {
    throw new TokenCipherError(`${fieldName} must be canonical base64`);
  }
  const decoded = Buffer.from(value, 'base64');
  if (decoded.toString('base64') !== value) {
    throw new TokenCipherError(`${fieldName} must be canonical base64`);
  }
  return decoded;
};

const validateKeyVersion = (version: string): void => {
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(version)) {
    throw new TokenCipherError(
      'Encryption key versions must be 1-64 URL-safe characters',
    );
  }
};

/**
 * Encrypts provider secrets with AES-256-GCM. The key version travels with the
 * ciphertext so records written before a rotation remain decryptable while
 * their old key is configured.
 *
 * @internal
 */
export class TokenCipher {
  private readonly keys: ReadonlyMap<string, Buffer>;

  constructor(activeKeyVersion: string, keys: ReadonlyMap<string, Buffer>) {
    validateKeyVersion(activeKeyVersion);
    if (!keys.has(activeKeyVersion)) {
      throw new TokenCipherError(
        `Active encryption key version ${activeKeyVersion} is not configured`,
      );
    }
    for (const [version, key] of keys) {
      validateKeyVersion(version);
      if (key.length !== 32) {
        throw new TokenCipherError(
          `Encryption key ${version} must contain exactly 32 bytes`,
        );
      }
    }
    this.activeKeyVersion = activeKeyVersion;
    this.keys = new Map(keys);
  }

  private readonly activeKeyVersion: string;

  encrypt(plaintext: string, associatedData: string): EncryptedSecret {
    if (!plaintext) {
      throw new TokenCipherError('Cannot encrypt an empty secret');
    }
    if (!associatedData) {
      throw new TokenCipherError('Encryption associated data is required');
    }

    const iv = randomBytes(12);
    const cipher = createCipheriv(
      'aes-256-gcm',
      this.keys.get(this.activeKeyVersion)!,
      iv,
    );
    cipher.setAAD(Buffer.from(associatedData, 'utf8'));
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);

    return {
      ciphertext: ciphertext.toString('base64'),
      iv: iv.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
      keyVersion: this.activeKeyVersion,
    };
  }

  decrypt(value: EncryptedSecret, associatedData: string): string {
    try {
      if (!associatedData) {
        throw new TokenCipherError('Encryption associated data is required');
      }
      validateKeyVersion(value.keyVersion);
      const key = this.keys.get(value.keyVersion);
      if (!key) {
        throw new TokenCipherError(
          `Encryption key version ${value.keyVersion} is not configured`,
        );
      }
      const iv = decodeBase64(value.iv, 'Encryption IV');
      const authTag = decodeBase64(value.authTag, 'Encryption auth tag');
      const ciphertext = decodeBase64(value.ciphertext, 'Ciphertext');
      if (
        iv.length !== 12 ||
        authTag.length !== 16 ||
        ciphertext.length === 0
      ) {
        throw new TokenCipherError('Encrypted secret has an invalid structure');
      }

      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAAD(Buffer.from(associatedData, 'utf8'));
      decipher.setAuthTag(authTag);
      return Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw new TokenCipherError(
        'Encrypted secret failed integrity or format validation',
      );
    }
  }
}

export function createTokenCipher(options: {
  activeKey: string;
  activeKeyVersion: string;
  previousKeys?: Record<string, string>;
}): TokenCipher {
  validateKeyVersion(options.activeKeyVersion);
  const keys = new Map<string, Buffer>();
  for (const [version, encodedKey] of Object.entries(
    options.previousKeys ?? {},
  )) {
    validateKeyVersion(version);
    if (version === options.activeKeyVersion) {
      throw new TokenCipherError(
        'The active encryption key version must not also appear in previousKeys',
      );
    }
    const key = decodeBase64(encodedKey, `Encryption key ${version}`);
    if (key.length !== 32) {
      throw new TokenCipherError(
        `Encryption key ${version} must decode to exactly 32 bytes`,
      );
    }
    keys.set(version, key);
  }

  const activeKey = decodeBase64(options.activeKey, 'Active encryption key');
  if (activeKey.length !== 32) {
    throw new TokenCipherError(
      'Active encryption key must decode to exactly 32 bytes',
    );
  }
  keys.set(options.activeKeyVersion, activeKey);

  return new TokenCipher(options.activeKeyVersion, keys);
}

/**
 * Generates unambiguous AES-GCM additional authenticated data bound to the
 * owning Backstage user, provider, and the kind of secret being encrypted.
 *
 * @internal
 */
export function secretAssociatedData(
  userEntityRef: string,
  provider: string,
  purpose: SecretPurpose,
): string {
  if (!userEntityRef || !provider) {
    throw new TokenCipherError(
      'A user entity reference and provider are required for secret encryption',
    );
  }
  return JSON.stringify([
    'provider-token',
    1,
    userEntityRef,
    provider,
    purpose,
  ]);
}
