/*
 * Copyright Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import { type HttpAuthService } from '@backstage/backend-plugin-api';
import express from 'express';
import Router from 'express-promise-router';
import {
  SecureTokenStorageError,
  type SecureTokenStorageService,
} from '@red-hat-developer-hub/backstage-plugin-secure-token-storage-node';

function errorStatus(error: SecureTokenStorageError): number {
  switch (error.code) {
    case 'grant-not-found':
    case 'connection-not-found':
      return 404;
    case 'caller-not-authorized':
    case 'grant-revoked':
    case 'grant-expired':
      return 403;
    case 'provider-refresh-required':
    case 'provider-refresh-failed':
      return 409;
    case 'connect-session-not-found':
      return 404;
    case 'connect-session-expired':
    case 'connect-session-consumed':
      return 410;
    case 'invalid-redirect-uri':
    case 'oauth-consent-denied':
    case 'consent-not-available':
      return 400;
    case 'provider-not-configured':
      return 503;
    case 'oauth-exchange-failed':
      return 502;
    case 'token-integrity-failed':
      return 500;
    case 'not-enabled':
      return 404;
    default:
      return 500;
  }
}

function sendSafeError(response: express.Response, error: unknown): void {
  if (error instanceof SecureTokenStorageError) {
    response.status(errorStatus(error)).json({ error: error.code });
    return;
  }
  response.status(500).json({ error: 'internal-error' });
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every(item => typeof item === 'string' && item.length > 0)
  );
}

function queryString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export async function createRouter(options: {
  httpAuth: HttpAuthService;
  service: SecureTokenStorageService;
}) {
  const router = Router();
  router.use(express.json());

  router.get('/health', async (_request, response) => {
    response.json(await options.service.getStatus());
  });

  router.post('/connections/:provider/start', async (request, response) => {
    try {
      const credentials = await options.httpAuth.credentials(request, {
        allow: ['user', 'service'],
      });
      const { scopes, redirectUri, userEntityRef } = request.body ?? {};
      if (!isStringArray(scopes) || !isNonEmptyString(redirectUri)) {
        response.status(400).json({ error: 'invalid-connect-request' });
        return;
      }

      const principal = credentials.principal;
      const callerSubject =
        principal.type === 'service'
          ? principal.subject
          : principal.actor?.subject;
      const resolvedUserEntityRef =
        principal.type === 'user' ? principal.userEntityRef : userEntityRef;
      if (
        !isNonEmptyString(callerSubject) ||
        !isNonEmptyString(resolvedUserEntityRef)
      ) {
        response.status(400).json({ error: 'service-caller-required' });
        return;
      }

      response.status(201).json(
        await options.service.startProviderConnection({
          userEntityRef: resolvedUserEntityRef,
          provider: request.params.provider,
          scopes,
          redirectUri,
          callerSubject,
        }),
      );
    } catch (error) {
      sendSafeError(response, error);
    }
  });

  router.get('/connections/:provider/callback', async (request, response) => {
    const state = queryString(request.query.state);
    const code = queryString(request.query.code);
    const providerError = queryString(request.query.error);
    if (!state || (!code && !providerError)) {
      response.status(400).json({ error: 'invalid-oauth-callback' });
      return;
    }

    try {
      const connection = await options.service.completeProviderConnection({
        provider: request.params.provider,
        state,
        code,
        providerError: Boolean(providerError),
      });
      response.json({ status: 'connected', ...connection });
    } catch (error) {
      sendSafeError(response, error);
    }
  });

  router.post('/connections/:sessionId/consent', async (request, response) => {
    try {
      const credentials = await options.httpAuth.credentials(request, {
        allow: ['user'],
      });
      const { decision, expiresAt } = request.body ?? {};
      if (decision !== 'approve' && decision !== 'reject') {
        response.status(400).json({ error: 'invalid-consent-decision' });
        return;
      }
      if (decision === 'reject') {
        await options.service.rejectProviderConnection({
          sessionId: request.params.sessionId,
          userEntityRef: credentials.principal.userEntityRef,
        });
        response.status(204).end();
        return;
      }

      let parsedExpiry: Date | undefined;
      if (expiresAt !== undefined) {
        if (!isNonEmptyString(expiresAt)) {
          response.status(400).json({ error: 'invalid-grant-expiry' });
          return;
        }
        parsedExpiry = new Date(expiresAt);
        if (Number.isNaN(parsedExpiry.getTime())) {
          response.status(400).json({ error: 'invalid-grant-expiry' });
          return;
        }
      }

      response.status(201).json(
        await options.service.approveProviderConnection({
          sessionId: request.params.sessionId,
          userEntityRef: credentials.principal.userEntityRef,
          expiresAt: parsedExpiry,
        }),
      );
    } catch (error) {
      sendSafeError(response, error);
    }
  });

  router.post('/grants/:grantId/revoke', async (request, response) => {
    try {
      const credentials = await options.httpAuth.credentials(request, {
        allow: ['user'],
      });
      await options.service.revokeGrant({
        grantId: request.params.grantId,
        userEntityRef: credentials.principal.userEntityRef,
      });
      response.status(204).end();
    } catch (error) {
      sendSafeError(response, error);
    }
  });

  router.post('/token', async (request, response) => {
    try {
      const credentials = await options.httpAuth.credentials(request, {
        allow: ['service'],
      });
      const { grantId, provider } = request.body ?? {};
      if (!isNonEmptyString(grantId) || !isNonEmptyString(provider)) {
        response.status(400).json({ error: 'invalid-token-request' });
        return;
      }
      response.json(
        await options.service.getAccessToken({
          grantId,
          provider,
          caller: credentials,
        }),
      );
    } catch (error) {
      sendSafeError(response, error);
    }
  });

  return router;
}
