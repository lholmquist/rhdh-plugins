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

export class TokenCipherError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TokenCipherError';
  }
}

/**
 * Encrypts provider secrets with AES-256-GCM and supports decrypting records
 * written with previous key versions during a rotation window.
 *
 * @internal
 */
export class TokenCipher {
  private readonly keys: Map<string, Buffer>;

  constructor(
    private readonly activeKeyVersion: string,
    keys: Map<string, Buffer>,
  ) {
    if (!keys.has(activeKeyVersion)) {
      throw new TokenCipherError(
        `Active encryption key ${activeKeyVersion} is not configured`,
      );
    }
    this.keys = keys;
  }

  encrypt(secret: string, associatedData: string): EncryptedSecret {
    const iv = randomBytes(12);
    const cipher = createCipheriv(
      'aes-256-gcm',
      this.keys.get(this.activeKeyVersion)!,
      iv,
    );
    cipher.setAAD(Buffer.from(associatedData, 'utf8'));
    const ciphertext = Buffer.concat([
      cipher.update(secret, 'utf8'),
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
    const key = this.keys.get(value.keyVersion);
    if (!key) {
      throw new TokenCipherError(
        `Encryption key ${value.keyVersion} is not available`,
      );
    }

    try {
      const decipher = createDecipheriv(
        'aes-256-gcm',
        key,
        Buffer.from(value.iv, 'base64'),
      );
      decipher.setAAD(Buffer.from(associatedData, 'utf8'));
      decipher.setAuthTag(Buffer.from(value.authTag, 'base64'));
      return Buffer.concat([
        decipher.update(Buffer.from(value.ciphertext, 'base64')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw new TokenCipherError('Encrypted token failed integrity validation');
    }
  }
}

export function createTokenCipher(options: {
  activeKey: string;
  activeKeyVersion: string;
  previousKeys?: Record<string, string>;
}): TokenCipher {
  const keys = new Map<string, Buffer>();
  const configuredKeys = {
    ...options.previousKeys,
    [options.activeKeyVersion]: options.activeKey,
  };

  for (const [version, encodedKey] of Object.entries(configuredKeys)) {
    const key = Buffer.from(encodedKey, 'base64');
    if (key.length !== 32) {
      throw new TokenCipherError(
        `Encryption key ${version} must decode to 32 bytes`,
      );
    }
    keys.set(version, key);
  }

  return new TokenCipher(options.activeKeyVersion, keys);
}
