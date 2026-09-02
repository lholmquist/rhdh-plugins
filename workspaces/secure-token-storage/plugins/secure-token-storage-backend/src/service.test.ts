/*
 * Copyright Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import { DefaultSecureTokenStorageService } from './service';

describe('DefaultSecureTokenStorageService', () => {
  it('returns the disabled foundation status', async () => {
    await expect(
      new DefaultSecureTokenStorageService(false).getStatus(),
    ).resolves.toEqual({ enabled: false });
  });

  it('returns the explicitly enabled foundation status', async () => {
    await expect(
      new DefaultSecureTokenStorageService(true).getStatus(),
    ).resolves.toEqual({ enabled: true });
  });
});
