/*
 * Copyright Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import type {
  BackstageCredentials,
  BackstageServicePrincipal,
  BackstageUserPrincipal,
  HttpAuthService,
  PermissionsService,
} from '@backstage/backend-plugin-api';
import { AuthorizeResult } from '@backstage/plugin-permission-common';
import express from 'express';
import Router from 'express-promise-router';
import {
  ProviderTokenError,
  providerTokenErrorCodes,
  providerTokenConnectPermission,
  providerTokenGrantReadPermission,
  providerTokenGrantRevokePermission,
  providerTokenProviderDisconnectPermission,
  providerTokenTokenIssuePermission,
} from '@red-hat-developer-hub/backstage-plugin-provider-token-common';
import type { ProviderTokenOperations } from '@red-hat-developer-hub/backstage-plugin-provider-token-node';

function errorStatus(code: string): number {
  switch (code) {
    case providerTokenErrorCodes.authenticationRequired:
      return 401;
    case providerTokenErrorCodes.invalidRequest:
    case providerTokenErrorCodes.invalidOAuthState:
      return 400;
    case providerTokenErrorCodes.grantNotFound:
    case providerTokenErrorCodes.consentRequired:
    case providerTokenErrorCodes.connectionNotFound:
      return 404;
    case providerTokenErrorCodes.grantExpired:
    case providerTokenErrorCodes.grantRevoked:
    case providerTokenErrorCodes.callerNotAuthorized:
    case providerTokenErrorCodes.permissionDenied:
      return 403;
    case providerTokenErrorCodes.tokenRefreshRejected:
    case providerTokenErrorCodes.connectSessionConsumed:
      return 409;
    case providerTokenErrorCodes.connectSessionExpired:
      return 410;
    case providerTokenErrorCodes.providerNotConfigured:
    case providerTokenErrorCodes.providerUnavailable:
    case providerTokenErrorCodes.storageError:
      return 503;
    case providerTokenErrorCodes.invalidProviderResponse:
      return 502;
    default:
      return 500;
  }
}

function sendSafeError(response: express.Response, error: unknown): void {
  if (error instanceof ProviderTokenError) {
    response.status(errorStatus(error.code)).json({
      error: {
        name: error.name,
        code: error.code,
        retryable: error.retryable,
      },
    });
    return;
  }
  response.status(500).json({
    error: {
      name: 'ProviderTokenError',
      code: 'internal-error',
      retryable: true,
    },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isGrantId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function isUserEntityRef(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 512 &&
    /^user:[^/\s]+\/[^/\s]+$/i.test(value) &&
    !Array.from(value).some(character => {
      const codePoint = character.codePointAt(0)!;
      return codePoint <= 0x20 || codePoint === 0x7f;
    })
  );
}

function isProviderId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value);
}

function isConnectSessionId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

async function requireCredentials(
  httpAuth: HttpAuthService,
  request: express.Request,
  allow: Array<'user' | 'service'>,
): Promise<
  | BackstageCredentials<BackstageUserPrincipal>
  | BackstageCredentials<BackstageServicePrincipal>
> {
  try {
    return (await httpAuth.credentials(request, {
      allow,
    })) as
      | BackstageCredentials<BackstageUserPrincipal>
      | BackstageCredentials<BackstageServicePrincipal>;
  } catch {
    throw new ProviderTokenError(
      providerTokenErrorCodes.authenticationRequired,
      'A verified caller credential is required.',
    );
  }
}

async function requirePermission(
  permissions: PermissionsService,
  permission: typeof providerTokenGrantReadPermission,
  credentials: BackstageCredentials,
): Promise<void>;
async function requirePermission(
  permissions: PermissionsService,
  permission: typeof providerTokenGrantRevokePermission,
  credentials: BackstageCredentials,
): Promise<void>;
async function requirePermission(
  permissions: PermissionsService,
  permission: typeof providerTokenConnectPermission,
  credentials: BackstageCredentials,
): Promise<void>;
async function requirePermission(
  permissions: PermissionsService,
  permission: typeof providerTokenProviderDisconnectPermission,
  credentials: BackstageCredentials,
): Promise<void>;
async function requirePermission(
  permissions: PermissionsService,
  permission: typeof providerTokenTokenIssuePermission,
  credentials: BackstageCredentials,
): Promise<void>;
async function requirePermission(
  permissions: PermissionsService,
  permission:
    | typeof providerTokenGrantReadPermission
    | typeof providerTokenGrantRevokePermission
    | typeof providerTokenConnectPermission
    | typeof providerTokenProviderDisconnectPermission
    | typeof providerTokenTokenIssuePermission,
  credentials: BackstageCredentials,
): Promise<void> {
  const [decision] = await permissions.authorize([{ permission }], {
    credentials,
  });
  if (decision?.result !== AuthorizeResult.ALLOW) {
    throw new ProviderTokenError(
      providerTokenErrorCodes.permissionDenied,
      'The caller is not permitted to perform this operation.',
    );
  }
}

/** Creates the checked handlers shared by the HTTP router and policy tests. */
export function createHandlers(options: {
  httpAuth: HttpAuthService;
  permissions: PermissionsService;
  service: ProviderTokenOperations;
}) {
  return {
    listGrants: (async (request, response) => {
      try {
        const credentials = await requireCredentials(
          options.httpAuth,
          request,
          ['user'],
        );
        if (credentials.principal.type !== 'user') {
          throw new ProviderTokenError(
            providerTokenErrorCodes.authenticationRequired,
            'A verified user credential is required.',
          );
        }
        await requirePermission(
          options.permissions,
          providerTokenGrantReadPermission,
          credentials,
        );
        response.json(
          await options.service.listGrants(credentials.principal.userEntityRef),
        );
      } catch (error) {
        sendSafeError(response, error);
      }
    }) satisfies express.RequestHandler,

    listConnections: (async (request, response) => {
      try {
        const credentials = await requireCredentials(
          options.httpAuth,
          request,
          ['user'],
        );
        if (credentials.principal.type !== 'user') {
          throw new ProviderTokenError(
            providerTokenErrorCodes.authenticationRequired,
            'A verified user credential is required.',
          );
        }
        await requirePermission(
          options.permissions,
          providerTokenGrantReadPermission,
          credentials,
        );
        response.json(
          await options.service.listConnections(
            credentials.principal.userEntityRef,
          ),
        );
      } catch (error) {
        sendSafeError(response, error);
      }
    }) satisfies express.RequestHandler,

    getConnectOptions: (async (request, response) => {
      try {
        const credentials = await requireCredentials(
          options.httpAuth,
          request,
          ['user'],
        );
        if (credentials.principal.type !== 'user') {
          throw new ProviderTokenError(
            providerTokenErrorCodes.authenticationRequired,
            'A verified user credential is required.',
          );
        }
        await requirePermission(
          options.permissions,
          providerTokenGrantReadPermission,
          credentials,
        );
        response.json(options.service.getConnectOptions());
      } catch (error) {
        sendSafeError(response, error);
      }
    }) satisfies express.RequestHandler,

    startConnect: (async (request, response) => {
      try {
        const credentials = await requireCredentials(
          options.httpAuth,
          request,
          ['user'],
        );
        const body = request.body;
        if (
          credentials.principal.type !== 'user' ||
          !isRecord(body) ||
          !isProviderId(body.provider) ||
          !isProviderId(body.clientId) ||
          typeof body.returnUrl !== 'string' ||
          body.returnUrl.length > 2048 ||
          Object.keys(body).some(
            key => !['provider', 'clientId', 'returnUrl'].includes(key),
          )
        ) {
          throw new ProviderTokenError(
            credentials.principal.type === 'user'
              ? providerTokenErrorCodes.invalidRequest
              : providerTokenErrorCodes.authenticationRequired,
            'The provider connection request is invalid.',
          );
        }
        await requirePermission(
          options.permissions,
          providerTokenConnectPermission,
          credentials,
        );
        response.status(201).json(
          await options.service.startConnect({
            userEntityRef: credentials.principal.userEntityRef,
            provider: body.provider,
            clientId: body.clientId,
            returnUrl: body.returnUrl,
          }),
        );
      } catch (error) {
        sendSafeError(response, error);
      }
    }) satisfies express.RequestHandler,

    getConnectSession: (async (request, response) => {
      try {
        const credentials = await requireCredentials(
          options.httpAuth,
          request,
          ['user'],
        );
        if (
          credentials.principal.type !== 'user' ||
          !isConnectSessionId(request.params.sessionId)
        ) {
          throw new ProviderTokenError(
            credentials.principal.type === 'user'
              ? providerTokenErrorCodes.invalidRequest
              : providerTokenErrorCodes.authenticationRequired,
            'A verified user and valid connection session are required.',
          );
        }
        await requirePermission(
          options.permissions,
          providerTokenGrantReadPermission,
          credentials,
        );
        response.json(
          await options.service.getConnectSession(
            request.params.sessionId,
            credentials.principal.userEntityRef,
          ),
        );
      } catch (error) {
        sendSafeError(response, error);
      }
    }) satisfies express.RequestHandler,

    decideConnectSession: (async (request, response) => {
      try {
        const credentials = await requireCredentials(
          options.httpAuth,
          request,
          ['user'],
        );
        const body = request.body;
        if (
          credentials.principal.type !== 'user' ||
          !isConnectSessionId(request.params.sessionId) ||
          !isRecord(body) ||
          (body.decision !== 'approve' && body.decision !== 'deny') ||
          Object.keys(body).some(key => key !== 'decision')
        ) {
          throw new ProviderTokenError(
            credentials.principal.type === 'user'
              ? providerTokenErrorCodes.invalidRequest
              : providerTokenErrorCodes.authenticationRequired,
            'The provider consent decision is invalid.',
          );
        }
        await requirePermission(
          options.permissions,
          providerTokenConnectPermission,
          credentials,
        );
        response.json(
          await options.service.decideConnectSession({
            sessionId: request.params.sessionId,
            userEntityRef: credentials.principal.userEntityRef,
            decision: body.decision,
          }),
        );
      } catch (error) {
        sendSafeError(response, error);
      }
    }) satisfies express.RequestHandler,

    connectCallback: (async (request, response) => {
      try {
        const { state, code, error: providerError } = request.query;
        if (
          typeof state !== 'string' ||
          (code !== undefined && typeof code !== 'string') ||
          (providerError !== undefined && typeof providerError !== 'string')
        ) {
          throw new ProviderTokenError(
            providerTokenErrorCodes.invalidOAuthState,
            'The provider callback is invalid.',
          );
        }
        const result = await options.service.completeConnectCallback({
          state,
          code,
          providerError,
        });
        response.redirect(303, result.redirectUrl);
      } catch (error) {
        sendSafeError(response, error);
      }
    }) satisfies express.RequestHandler,

    revokeGrant: (async (request, response) => {
      try {
        const credentials = await requireCredentials(
          options.httpAuth,
          request,
          ['user'],
        );
        if (
          credentials.principal.type !== 'user' ||
          !isGrantId(request.params.grantId)
        ) {
          throw new ProviderTokenError(
            credentials.principal.type === 'user'
              ? providerTokenErrorCodes.invalidRequest
              : providerTokenErrorCodes.authenticationRequired,
            'A verified user and valid grant ID are required.',
          );
        }
        await requirePermission(
          options.permissions,
          providerTokenGrantRevokePermission,
          credentials,
        );
        await options.service.revokeGrant(
          request.params.grantId,
          credentials.principal.userEntityRef,
        );
        response.status(204).end();
      } catch (error) {
        sendSafeError(response, error);
      }
    }) satisfies express.RequestHandler,

    disconnectProvider: (async (request, response) => {
      try {
        const credentials = await requireCredentials(
          options.httpAuth,
          request,
          ['user'],
        );
        if (
          credentials.principal.type !== 'user' ||
          !isProviderId(request.params.providerId)
        ) {
          throw new ProviderTokenError(
            credentials.principal.type === 'user'
              ? providerTokenErrorCodes.invalidRequest
              : providerTokenErrorCodes.authenticationRequired,
            'A verified user and valid provider are required.',
          );
        }
        await requirePermission(
          options.permissions,
          providerTokenProviderDisconnectPermission,
          credentials,
        );
        await options.service.disconnectProvider(
          credentials.principal.userEntityRef,
          request.params.providerId,
        );
        response.status(204).end();
      } catch (error) {
        sendSafeError(response, error);
      }
    }) satisfies express.RequestHandler,

    resolveProviderTokenGrant: (async (request, response) => {
      try {
        const credentials = await requireCredentials(
          options.httpAuth,
          request,
          ['service'],
        );
        if (credentials.principal.type !== 'service') {
          throw new ProviderTokenError(
            providerTokenErrorCodes.authenticationRequired,
            'A verified service credential is required.',
          );
        }
        const body = request.body;
        if (
          !isRecord(body) ||
          !isUserEntityRef(body.userEntityRef) ||
          (body.provider !== undefined && !isProviderId(body.provider)) ||
          Object.keys(body).some(
            key => !['userEntityRef', 'provider'].includes(key),
          )
        ) {
          throw new ProviderTokenError(
            providerTokenErrorCodes.invalidRequest,
            'The grant-resolution request is invalid.',
          );
        }
        await requirePermission(
          options.permissions,
          providerTokenGrantReadPermission,
          credentials,
        );

        let grants = (
          await options.service.listGrants(body.userEntityRef)
        ).filter(
          grant => !grant.revokedAt && grant.expiresAt.getTime() > Date.now(),
        );
        if (body.provider) {
          grants = grants.filter(grant => grant.provider === body.provider);
        } else {
          const providers = new Set(grants.map(grant => grant.provider));
          if (providers.size !== 1) grants = [];
        }
        const callerSubjects = new Set(
          grants.map(grant => grant.callerSubject),
        );
        if (callerSubjects.size > 1) grants = [];

        const grant = grants[0];
        response.setHeader('Cache-Control', 'no-store');
        response.json({
          grant: grant
            ? { grantId: grant.grantId, provider: grant.provider }
            : null,
        });
      } catch (error) {
        sendSafeError(response, error);
      }
    }) satisfies express.RequestHandler,

    issueAccessToken: (async (request, response) => {
      try {
        const credentials = await requireCredentials(
          options.httpAuth,
          request,
          ['service'],
        );
        if (credentials.principal.type !== 'service') {
          throw new ProviderTokenError(
            providerTokenErrorCodes.authenticationRequired,
            'A verified service credential is required.',
          );
        }
        const body = request.body;
        if (
          !isRecord(body) ||
          !isGrantId(body.grantId) ||
          (body.provider !== undefined && !isProviderId(body.provider)) ||
          (body.context !== undefined &&
            (typeof body.context !== 'string' || body.context.length > 512)) ||
          Object.keys(body).some(
            key => !['grantId', 'provider', 'context'].includes(key),
          )
        ) {
          throw new ProviderTokenError(
            providerTokenErrorCodes.invalidRequest,
            'The token request is invalid.',
          );
        }
        await requirePermission(
          options.permissions,
          providerTokenTokenIssuePermission,
          credentials,
        );
        const result = await options.service.issueAccessToken({
          grantId: body.grantId,
          callerSubject: credentials.principal.subject,
          provider: body.provider as string | undefined,
          context: body.context as string | undefined,
        });
        response.json({
          accessToken: result.token,
          expiresAt: result.expiresAt,
          scopes: result.scopes,
        });
      } catch (error) {
        sendSafeError(response, error);
      }
    }) satisfies express.RequestHandler,
  };
}

/** Registers the versioned grant and token-issuance API. */
export function createRouter(options: Parameters<typeof createHandlers>[0]) {
  const router = Router();
  const handlers = createHandlers(options);
  router.use(express.json({ limit: '16kb' }));
  router.use('/v1/connect', (_request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    next();
  });
  router.get('/v1/connections', handlers.listConnections);
  router.get('/v1/connect/options', handlers.getConnectOptions);
  router.get('/v1/grants', handlers.listGrants);
  router.post('/v1/grants/resolve', handlers.resolveProviderTokenGrant);
  router.delete('/v1/grants/:grantId', handlers.revokeGrant);
  router.post('/v1/connect/sessions', handlers.startConnect);
  router.get('/v1/connect/sessions/:sessionId', handlers.getConnectSession);
  router.post(
    '/v1/connect/sessions/:sessionId/decision',
    handlers.decideConnectSession,
  );
  router.get('/v1/connect/callback', handlers.connectCallback);
  router.delete('/v1/providers/:providerId', handlers.disconnectProvider);
  router.post(
    '/v1/access-tokens',
    (_request, response, next) => {
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('Pragma', 'no-cache');
      next();
    },
    handlers.issueAccessToken,
  );

  router.use(
    (
      error: Error & { type?: string },
      _request: express.Request,
      response: express.Response,
      next: express.NextFunction,
    ) => {
      if (error.type === 'entity.parse.failed') {
        sendSafeError(
          response,
          new ProviderTokenError(
            providerTokenErrorCodes.invalidRequest,
            'The request body is invalid.',
          ),
        );
        return;
      }
      next(error);
    },
  );

  return router;
}
