/*
 * Copyright Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import {
  coreServices,
  createServiceFactory,
  type RootConfigService,
  type LoggerService,
} from '@backstage/backend-plugin-api';
import {
  ProviderTokenError,
  providerTokenErrorCodes,
  type ProviderTokenClientConfig,
} from '@red-hat-developer-hub/backstage-plugin-provider-token-common';
import { providerTokenOperationsRef } from '@red-hat-developer-hub/backstage-plugin-provider-token-node';
import { providerTokenAdapters } from './adapters';
import { createTokenCipher } from './crypto';
import { migrate } from './database/migration';
import { ProviderTokenRepository } from './database/repository';
import { ProviderTokenService } from './token-service';

const disabledError = () =>
  new ProviderTokenError(
    providerTokenErrorCodes.providerNotConfigured,
    'Provider-token is disabled.',
  );

const disabledService = {
  assertProviderConfigured() {
    throw disabledError();
  },
  async listGrants() {
    throw disabledError();
  },
  async revokeGrant() {
    throw disabledError();
  },
  async listConnections() {
    throw disabledError();
  },
  getConnectOptions() {
    throw disabledError();
  },
  async startConnect() {
    throw disabledError();
  },
  async completeConnectCallback() {
    throw disabledError();
  },
  async getConnectSession() {
    throw disabledError();
  },
  async decideConnectSession() {
    throw disabledError();
  },
  async disconnectProvider() {
    throw disabledError();
  },
  async issueAccessToken() {
    throw disabledError();
  },
  invalidate() {},
};

function readClients(
  config: RootConfigService,
): ReadonlyMap<string, ProviderTokenClientConfig> {
  const configuredClients =
    config.getOptionalConfigArray('providerToken.clients') ?? [];
  const clients = new Map<string, ProviderTokenClientConfig>();
  for (const clientConfig of configuredClients) {
    const id = clientConfig.getString('id');
    const title = clientConfig.getString('title');
    const purpose = clientConfig.getOptionalString('purpose');
    const allowedSubjects = clientConfig.getStringArray('allowedSubjects');
    const providerScopes =
      clientConfig.getOptional<Record<string, string[]>>('providerScopes') ??
      {};
    const hasValidProviderScopes =
      Object.keys(providerScopes).length > 0 &&
      Object.entries(providerScopes).every(
        ([provider, scopes]) =>
          /^[a-z][a-z0-9-]{0,63}$/.test(provider) &&
          Array.isArray(scopes) &&
          scopes.length > 0 &&
          scopes.length <= 64 &&
          new Set(scopes).size === scopes.length &&
          scopes.every(
            scope =>
              typeof scope === 'string' &&
              !!scope.trim() &&
              scope.length <= 256 &&
              scope !== 'offline_access' &&
              !Array.from(scope).some(character => {
                const codePoint = character.codePointAt(0)!;
                return codePoint <= 0x20 || codePoint === 0x7f;
              }),
          ),
      );
    if (
      !/^[a-z][a-z0-9-]{0,63}$/.test(id) ||
      !title.trim() ||
      allowedSubjects.length === 0 ||
      allowedSubjects.some(subject => !subject.trim()) ||
      !hasValidProviderScopes ||
      clients.has(id)
    ) {
      throw new Error(
        'providerToken.clients must have unique valid IDs, titles, non-empty allowedSubjects, and providerScopes with valid non-empty scope lists',
      );
    }
    clients.set(id, {
      id,
      title,
      purpose,
      allowedSubjects,
      providerScopes,
    });
  }
  if (clients.size === 0) {
    throw new Error(
      'providerToken.clients must contain at least one client when provider-token is enabled',
    );
  }
  return clients;
}

/**
 * Root-scoped factory for encrypted provider-token refresh operations.
 *
 * @public
 */
export const providerTokenOperationsFactory = createServiceFactory({
  service: providerTokenOperationsRef,
  deps: {
    config: coreServices.rootConfig,
    database: coreServices.database,
    logger: coreServices.logger,
    lifecycle: coreServices.lifecycle,
  },
  async factory({ config, database, logger, lifecycle }) {
    await migrate(database);
    const enabled = config.getOptionalBoolean('providerToken.enabled') ?? false;
    if (!enabled) return disabledService;

    const encryption = config.getOptionalConfig('providerToken.encryption');
    const activeKey = encryption?.getOptionalString('activeKey');
    if (!activeKey) {
      throw new Error(
        'providerToken.encryption.activeKey is required when provider-token is enabled',
      );
    }
    const cipher = createTokenCipher({
      activeKey,
      activeKeyVersion:
        encryption?.getOptionalString('activeKeyVersion') ?? 'v1',
      previousKeys:
        encryption?.getOptional<Record<string, string>>('previousKeys'),
    });
    const grantTtlDays = config.getOptionalNumber('providerToken.grantTtlDays');
    if (
      grantTtlDays !== undefined &&
      (!Number.isInteger(grantTtlDays) ||
        grantTtlDays < 1 ||
        grantTtlDays > 365)
    ) {
      throw new Error(
        'providerToken.grantTtlDays must be an integer between 1 and 365',
      );
    }
    const returnUrlAllowlist =
      config
        .getOptionalConfigArray('providerToken.returnUrlAllowlist')
        ?.map(entry => ({
          origin: entry.getString('origin'),
          pathPrefix: entry.getString('pathPrefix'),
        })) ?? [];
    const callbackUrl = new URL(
      '/api/provider-token/v1/connect/callback',
      config.getString('backend.baseUrl'),
    ).toString();
    const repository = new ProviderTokenRepository(await database.getClient());
    const cleanupTimer = setInterval(() => {
      repository.cleanupExpiredConnectSessions(new Date()).catch(() => {
        logger.warn('Provider-token connect-session cleanup failed');
      });
    }, 60_000);
    cleanupTimer.unref();
    lifecycle.addShutdownHook(() => clearInterval(cleanupTimer));
    return new ProviderTokenService({
      repository,
      cipher,
      adapters: providerTokenAdapters,
      clients: readClients(config),
      callbackUrl,
      returnUrlAllowlist,
      grantTtlMs: (grantTtlDays ?? 30) * 24 * 60 * 60 * 1000,
      logger: logger as LoggerService,
    });
  },
});
