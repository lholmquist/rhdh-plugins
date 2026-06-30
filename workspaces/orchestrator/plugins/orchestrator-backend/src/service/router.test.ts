/*
 * Copyright Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
  PermissionsService,
  UserInfoService,
} from '@backstage/backend-plugin-api';
import {
  mockErrorHandler,
  mockServices,
  ServiceMock,
} from '@backstage/backend-test-utils';
import { AuthorizeResult } from '@backstage/plugin-permission-common';

import express from 'express';
import request from 'supertest';

import {
  orchestratorInstanceAdminViewPermission,
  orchestratorWorkflowPermission,
  orchestratorWorkflowSpecificPermission,
  orchestratorWorkflowUsePermission,
  orchestratorWorkflowUseSpecificPermission,
  ProcessInstanceState,
} from '@red-hat-developer-hub/backstage-plugin-orchestrator-common';

import { lokiLogProvider } from '../../__fixtures__/mockProviders';
import { WorkflowLogsProvidersRegistry } from '../providers/WorkflowLogsProvidersRegistry';
import { generateProcessInstance } from './api/test-utils';
import { V2 } from './api/v2';
import { createBackendRouter } from './router';

jest.mock('openapi-backend', () => {
  const actual = jest.requireActual('openapi-backend');
  return {
    ...actual,
    OpenAPIBackend: jest.fn().mockImplementation(
      (options: object) =>
        new actual.OpenAPIBackend({
          ...options,
          quick: true,
          validate: false,
        }),
    ),
  };
});

jest.mock('./Helper', () => ({
  ...jest.requireActual('./Helper'),
  retryAsyncFunction: jest.fn(async ({ asyncFn }: { asyncFn: () => unknown }) =>
    asyncFn(),
  ),
}));

const sonataFlowServiceMock = {
  fetchWorkflowOverviews: jest.fn().mockResolvedValue([]),
  fetchWorkflowOverview: jest.fn(),
  fetchWorkflowSource: jest.fn(),
  fetchWorkflowDefinition: jest.fn(),
  fetchWorkflowInfoOnService: jest.fn(),
  executeWorkflow: jest.fn(),
  executeWorkflowAsCloudEvent: jest.fn(),
  retriggerInstance: jest.fn(),
  abortInstance: jest.fn(),
  pingWorkflowService: jest.fn().mockResolvedValue({
    isAvailable: true,
    statusCode: 200,
    urlToFetch: 'http://localhost/management/processes/test',
    reason: 'OK',
  }),
};

const dataIndexServiceMock = {
  fetchWorkflowServiceUrls: jest.fn().mockResolvedValue({}),
  fetchInstances: jest.fn().mockResolvedValue([]),
  fetchInstance: jest.fn(),
  fetchWorkflowInfo: jest.fn(),
  fetchWorkflowSource: jest.fn(),
  fetchDefinitionIdsFromInstances: jest.fn().mockResolvedValue([]),
  fetchInstanceVariables: jest.fn(),
};

jest.mock('./SonataFlowService', () => ({
  SonataFlowService: jest.fn().mockImplementation(() => sonataFlowServiceMock),
}));

jest.mock('./DataIndexService', () => ({
  DataIndexService: jest.fn().mockImplementation(() => dataIndexServiceMock),
}));

jest.mock('./WorkflowCacheService', () => ({
  WorkflowCacheService: jest.fn().mockImplementation(() => ({
    schedule: jest.fn(),
    definitionIds: ['workflow-1', 'workflow-2'],
    unavailableDefinitionIds: [],
    isAvailable: jest.fn().mockReturnValue(true),
  })),
}));

const BASE_CONFIG = {
  orchestrator: {
    dataIndexService: { url: 'http://data-index.test' },
    contentLengthLimit: '102400',
  },
  backend: {
    baseUrl: 'http://localhost:7007',
  },
};

describe('createBackendRouter', () => {
  let app: express.Express;
  let permissionsMock: ServiceMock<PermissionsService>;
  let userInfoMock: ServiceMock<UserInfoService>;
  let workflowLogsProvidersRegistry: WorkflowLogsProvidersRegistry;

  const createTestApp = async (options?: {
    authorizeResult?: AuthorizeResult;
    authorizeImpl?: PermissionsService['authorize'];
    userEntityRef?: string;
    withLogProvider?: boolean;
    logProvider?: typeof lokiLogProvider;
  }) => {
    const authorizeResult = options?.authorizeResult ?? AuthorizeResult.ALLOW;

    permissionsMock = mockServices.permissions.mock({
      authorize:
        options?.authorizeImpl ??
        jest.fn().mockResolvedValue([{ result: authorizeResult }]),
      authorizeConditional: jest
        .fn()
        .mockResolvedValue([{ result: authorizeResult }]),
    });

    userInfoMock = mockServices.userInfo.mock({
      getUserInfo: jest.fn().mockResolvedValue({
        userEntityRef: options?.userEntityRef ?? 'user:default/test-user',
      }),
    });

    workflowLogsProvidersRegistry = new WorkflowLogsProvidersRegistry();
    if (options?.withLogProvider) {
      workflowLogsProvidersRegistry.register(
        options.logProvider ?? lokiLogProvider,
      );
    }

    const configData = options?.withLogProvider
      ? {
          ...BASE_CONFIG,
          orchestrator: {
            ...BASE_CONFIG.orchestrator,
            workflowLogProvider: { type: 'loki' },
          },
        }
      : BASE_CONFIG;

    const router = await createBackendRouter({
      config: mockServices.rootConfig({ data: configData }),
      logger: mockServices.logger.mock(),
      auditor: mockServices.auditor.mock(),
      discovery: mockServices.discovery.mock(),
      urlReader: mockServices.urlReader.mock(),
      scheduler: mockServices.scheduler.mock(),
      permissions: permissionsMock,
      httpAuth: mockServices.httpAuth.mock(),
      userInfo: userInfoMock,
      workflowLogsProvidersRegistry,
    });

    const testApp = express();
    testApp.use(router);
    testApp.use(mockErrorHandler());
    return testApp;
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    sonataFlowServiceMock.fetchWorkflowOverviews.mockResolvedValue([]);
    sonataFlowServiceMock.pingWorkflowService.mockResolvedValue({
      isAvailable: true,
      statusCode: 200,
      urlToFetch: 'http://localhost/management/processes/test',
      reason: 'OK',
    });
    dataIndexServiceMock.fetchWorkflowServiceUrls.mockResolvedValue({
      'workflow-1': 'http://localhost:8080',
    });
    dataIndexServiceMock.fetchInstances.mockResolvedValue([]);
    app = await createTestApp();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('health and routing', () => {
    it('responds to health check', async () => {
      const response = await request(app).get('/health');
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ status: 'ok' });
    });

    it('returns 404 for unknown paths', async () => {
      const response = await request(app).get('/v2/unknown-path');
      expect(response.status).toBe(404);
    });
  });

  describe('getWorkflowStatuses', () => {
    it('returns all workflow status types without authorization', async () => {
      const response = await request(app).get(
        '/v2/workflows/instances/statuses',
      );
      expect(response.status).toBe(200);
      expect(response.body).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ key: 'Active', value: 'ACTIVE' }),
          expect.objectContaining({ key: 'Completed', value: 'COMPLETED' }),
        ]),
      );
    });

    it('returns 500 when workflow statuses fetch fails', async () => {
      jest
        .spyOn(V2.prototype, 'getWorkflowStatuses')
        .mockRejectedValue(new Error('status fetch failed'));

      const response = await request(app).get(
        '/v2/workflows/instances/statuses',
      );

      expect(response.status).toBe(500);
    });
  });

  describe('getWorkflowsOverview', () => {
    it('returns workflow overviews when authorized', async () => {
      sonataFlowServiceMock.fetchWorkflowOverviews.mockResolvedValue([
        {
          workflowId: 'workflow-1',
          name: 'Test Workflow',
          format: 'yaml',
        },
      ]);

      const response = await request(app)
        .post('/v2/workflows/overview')
        .send({ paginationInfo: { offset: 0, pageSize: 10 } });

      expect(response.status).toBe(200);
      expect(response.body.overviews).toHaveLength(1);
      expect(response.body.overviews[0].workflowId).toBe('workflow-1');
    });

    it('filters overviews when user lacks generic workflow permission', async () => {
      app = await createTestApp({
        authorizeImpl: jest.fn().mockImplementation(async requests => {
          return requests.map((req: { permission: { name?: string } }) => {
            const name = req.permission?.name;
            if (name === orchestratorWorkflowPermission.name) {
              return { result: AuthorizeResult.DENY };
            }
            if (
              name === orchestratorWorkflowSpecificPermission('workflow-1').name
            ) {
              return { result: AuthorizeResult.ALLOW };
            }
            if (
              name === orchestratorWorkflowSpecificPermission('workflow-2').name
            ) {
              return { result: AuthorizeResult.DENY };
            }
            return { result: AuthorizeResult.ALLOW };
          });
        }),
      });

      sonataFlowServiceMock.fetchWorkflowOverviews.mockResolvedValue([
        { workflowId: 'workflow-1', name: 'Allowed', format: 'yaml' },
        { workflowId: 'workflow-2', name: 'Denied', format: 'yaml' },
      ]);

      const response = await request(app)
        .post('/v2/workflows/overview')
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.overviews).toHaveLength(1);
      expect(response.body.overviews[0].workflowId).toBe('workflow-1');
    });

    it('returns overview result unchanged when overviews is undefined', async () => {
      const overviewResult = {
        paginationInfo: { offset: 0, pageSize: 10 },
      };
      jest
        .spyOn(V2.prototype, 'getWorkflowsOverview')
        .mockResolvedValue(
          overviewResult as Awaited<ReturnType<V2['getWorkflowsOverview']>>,
        );

      const response = await request(app)
        .post('/v2/workflows/overview')
        .send({});

      expect(response.status).toBe(200);
      expect(response.body).toEqual(overviewResult);
    });
  });

  describe('getWorkflowsOverviewForEntity', () => {
    it('returns empty overviews when no workflow ids match', async () => {
      const response = await request(app)
        .post('/v2/workflows/overview/entity')
        .send({
          targetEntity: 'component:default/test',
          annotationWorkflowIds: [],
        });

      expect(response.status).toBe(200);
      expect(response.body.overviews).toEqual([]);
    });

    it('returns overviews for annotated workflow ids', async () => {
      sonataFlowServiceMock.fetchWorkflowOverviews.mockResolvedValue([
        { workflowId: 'workflow-1', name: 'Entity Workflow', format: 'yaml' },
      ]);

      const response = await request(app)
        .post('/v2/workflows/overview/entity')
        .send({
          targetEntity: 'component:default/test',
          annotationWorkflowIds: ['workflow-1'],
        });

      expect(response.status).toBe(200);
      expect(response.body.overviews).toHaveLength(1);
    });
  });

  describe('getWorkflowSourceById', () => {
    it('returns workflow source when authorized', async () => {
      dataIndexServiceMock.fetchWorkflowSource.mockResolvedValue(
        'id: test-workflow\nspecVersion: "0.8"',
      );

      const response = await request(app).get(
        '/v2/workflows/workflow-1/source',
      );

      expect(response.status).toBe(200);
      expect(response.text).toContain('test-workflow');
    });

    it('returns unauthorized when permission is denied', async () => {
      app = await createTestApp({ authorizeResult: AuthorizeResult.DENY });

      const response = await request(app).get(
        '/v2/workflows/workflow-1/source',
      );

      expect(response.status).toBe(403);
    });
  });

  describe('getWorkflowOverviewById', () => {
    it('returns workflow overview when authorized', async () => {
      sonataFlowServiceMock.fetchWorkflowOverview.mockResolvedValue({
        workflowId: 'workflow-1',
        name: 'Overview Workflow',
        format: 'yaml',
      });

      const response = await request(app).get(
        '/v2/workflows/workflow-1/overview',
      );

      expect(response.status).toBe(200);
      expect(response.body.workflowId).toBe('workflow-1');
    });
  });

  describe('getInstances', () => {
    it('returns instances list when authorized', async () => {
      const instances = [
        {
          ...generateProcessInstance(1),
          processId: 'workflow-1',
          variables: {
            initiatorEntity: 'user:default/test-user',
          },
        },
      ];
      dataIndexServiceMock.fetchInstances.mockResolvedValue(instances);

      const response = await request(app)
        .post('/v2/workflows/instances')
        .send({ paginationInfo: { offset: 0, pageSize: 10 } });

      expect(response.status).toBe(200);
      expect(response.body.items).toHaveLength(1);
      expect(response.body.totalCount).toBe(1);
    });

    it('returns empty list when no workflows are authorized', async () => {
      app = await createTestApp({
        authorizeImpl: jest
          .fn()
          .mockImplementation(async requests =>
            requests.map(() => ({ result: AuthorizeResult.DENY })),
          ),
      });

      const response = await request(app)
        .post('/v2/workflows/instances')
        .send({});

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    });

    it('allows admin to view all instances without initiator filter', async () => {
      app = await createTestApp({
        authorizeImpl: jest.fn().mockImplementation(async requests => {
          const permission = requests[0]?.permission;
          if (permission === orchestratorInstanceAdminViewPermission) {
            return [{ result: AuthorizeResult.ALLOW }];
          }
          if (permission === orchestratorWorkflowPermission) {
            return [{ result: AuthorizeResult.ALLOW }];
          }
          return [{ result: AuthorizeResult.ALLOW }];
        }),
      });

      dataIndexServiceMock.fetchInstances.mockResolvedValue([
        generateProcessInstance(1),
      ]);

      const response = await request(app)
        .post('/v2/workflows/instances')
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.items).toHaveLength(1);
    });

    it('applies initiator filter only when user is not instance admin', async () => {
      app = await createTestApp({
        authorizeImpl: jest.fn().mockImplementation(async requests => {
          const name = requests[0]?.permission?.name;
          if (name === orchestratorInstanceAdminViewPermission.name) {
            return [{ result: AuthorizeResult.DENY }];
          }
          return [{ result: AuthorizeResult.ALLOW }];
        }),
      });
      dataIndexServiceMock.fetchInstances.mockResolvedValue([
        generateProcessInstance(1),
      ]);

      const response = await request(app)
        .post('/v2/workflows/instances')
        .send({});

      expect(response.status).toBe(200);
      expect(dataIndexServiceMock.fetchInstances).toHaveBeenCalledWith(
        expect.objectContaining({
          filter: {
            field: 'variables',
            nested: {
              field: 'initiatorEntity',
              operator: 'EQ',
              value: 'user:default/test-user',
            },
          },
        }),
      );
    });

    it('returns 500 when instances list fetch fails', async () => {
      dataIndexServiceMock.fetchInstances.mockRejectedValue(
        new Error('list failed'),
      );

      const response = await request(app)
        .post('/v2/workflows/instances')
        .send({});

      expect(response.status).toBe(500);
    });
  });

  describe('getWorkflowInstances', () => {
    it('returns instances for a specific workflow', async () => {
      dataIndexServiceMock.fetchInstances.mockResolvedValue([
        generateProcessInstance(1),
      ]);

      const response = await request(app)
        .post('/v2/workflows/workflow-1/instances')
        .send({ paginationInfo: { offset: 0, pageSize: 5 } });

      expect(response.status).toBe(200);
      expect(response.body.items).toHaveLength(1);
    });
  });

  describe('getInstanceById', () => {
    const createInstanceApp = async () =>
      createTestApp({
        authorizeImpl: jest.fn().mockImplementation(async requests => {
          const name = requests[0]?.permission?.name;
          if (name === orchestratorInstanceAdminViewPermission.name) {
            return [{ result: AuthorizeResult.DENY }];
          }
          return [{ result: AuthorizeResult.ALLOW }];
        }),
      });

    it('returns instance when user owns the run', async () => {
      app = await createInstanceApp();
      const instance = {
        ...generateProcessInstance(1),
        processId: 'workflow-1',
        state: ProcessInstanceState.Completed,
        variables: {
          initiatorEntity: 'user:default/test-user',
        },
      };
      dataIndexServiceMock.fetchInstance.mockResolvedValue(instance);

      const response = await request(app).get(
        `/v2/workflows/instances/${instance.id}`,
      );

      expect(response.status).toBe(200);
      expect(response.body.id).toBe(instance.id);
    });

    it('denies access when initiator does not match', async () => {
      app = await createInstanceApp();
      const instance = {
        ...generateProcessInstance(1),
        processId: 'workflow-1',
        variables: {
          initiatorEntity: 'user:default/other-user',
        },
      };
      dataIndexServiceMock.fetchInstance.mockResolvedValue(instance);

      const response = await request(app).get(
        `/v2/workflows/instances/${instance.id}`,
      );

      expect(response.status).toBe(403);
      expect(response.body.error.message).toContain('Access denied');
    });

    it('denies access when instance has no initiatorEntity recorded', async () => {
      app = await createInstanceApp();
      const instance = {
        ...generateProcessInstance(1),
        processId: 'workflow-1',
        variables: {},
      };
      dataIndexServiceMock.fetchInstance.mockResolvedValue(instance);

      const response = await request(app).get(
        `/v2/workflows/instances/${instance.id}`,
      );

      expect(response.status).toBe(403);
      expect(response.body.error.message).toContain('ownership information');
    });
  });

  describe('getWorkflowInputSchemaById', () => {
    it('returns empty object when workflow has no input schema', async () => {
      dataIndexServiceMock.fetchWorkflowInfo.mockResolvedValue({
        id: 'workflow-1',
        serviceUrl: 'http://localhost:8080',
      });
      sonataFlowServiceMock.fetchWorkflowDefinition.mockResolvedValue({
        id: 'workflow-1',
        specVersion: '0.8',
        states: [],
      });

      const response = await request(app).get(
        '/v2/workflows/workflow-1/inputSchema',
      );

      expect(response.status).toBe(200);
      expect(response.body).toEqual({});
    });

    it('returns input schema and prefilled data from instance variables', async () => {
      dataIndexServiceMock.fetchWorkflowInfo.mockResolvedValue({
        id: 'workflow-1',
        serviceUrl: 'http://localhost:8080',
      });
      sonataFlowServiceMock.fetchWorkflowDefinition.mockResolvedValue({
        id: 'workflow-1',
        specVersion: '0.8',
        dataInputSchema: { type: 'object' },
        states: [],
      });
      dataIndexServiceMock.fetchInstanceVariables.mockResolvedValue({
        workflowdata: { fieldA: 'value-a', fieldB: 'value-b' },
      });
      sonataFlowServiceMock.fetchWorkflowInfoOnService.mockResolvedValue({
        id: 'workflow-1',
        inputSchema: {
          properties: {
            fieldA: { type: 'string' },
            fieldC: { type: 'string' },
          },
        },
      });

      const response = await request(app)
        .get('/v2/workflows/workflow-1/inputSchema')
        .query({ instanceId: 'instance-1' });

      expect(response.status).toBe(200);
      expect(response.body.inputSchema.properties.fieldA).toBeDefined();
      expect(response.body.data).toEqual({ fieldA: 'value-a' });
    });
  });

  describe('pingWorkflowServiceById', () => {
    it('returns true when workflow service is available', async () => {
      dataIndexServiceMock.fetchWorkflowInfo.mockResolvedValue({
        id: 'workflow-1',
        serviceUrl: 'http://localhost:8080',
      });

      const response = await request(app).get(
        '/v2/workflows/workflow-1/pingWorkflowService',
      );

      expect(response.status).toBe(200);
      expect(response.body).toBe(true);
    });

    it('returns error when workflow service is unavailable', async () => {
      dataIndexServiceMock.fetchWorkflowInfo.mockResolvedValue({
        id: 'workflow-1',
        serviceUrl: 'http://localhost:8080',
      });
      sonataFlowServiceMock.pingWorkflowService.mockResolvedValue({
        isAvailable: false,
        statusCode: 503,
        urlToFetch: 'http://localhost:8080/management/processes/workflow-1',
        reason: 'Unavailable',
      });

      const response = await request(app).get(
        '/v2/workflows/workflow-1/pingWorkflowService',
      );

      expect(response.status).toBe(500);
    });
  });

  describe('executeWorkflow', () => {
    it('executes workflow when authorized', async () => {
      app = await createTestApp({
        authorizeImpl: jest.fn().mockImplementation(async requests => {
          const permission = requests[0]?.permission;
          if (
            permission === orchestratorWorkflowUsePermission ||
            permission ===
              orchestratorWorkflowUseSpecificPermission('workflow-1')
          ) {
            return [{ result: AuthorizeResult.ALLOW }];
          }
          return [{ result: AuthorizeResult.ALLOW }];
        }),
      });

      dataIndexServiceMock.fetchWorkflowInfo.mockResolvedValue({
        id: 'workflow-1',
        serviceUrl: 'http://localhost:8080',
      });
      sonataFlowServiceMock.executeWorkflow.mockResolvedValue({
        id: 'new-instance-1',
      });
      dataIndexServiceMock.fetchInstance.mockResolvedValue(
        generateProcessInstance(1),
      );

      const response = await request(app)
        .post('/v2/workflows/workflow-1/execute')
        .set('Authorization', 'Bearer test-token')
        .send({
          inputData: { foo: 'bar' },
          targetEntity: 'component:default/x',
        });

      expect(response.status).toBe(200);
      expect(response.body.id).toBe('new-instance-1');
    });

    it('returns unauthorized when execute permission is denied', async () => {
      app = await createTestApp({
        authorizeImpl: jest
          .fn()
          .mockResolvedValue([{ result: AuthorizeResult.DENY }]),
      });

      const response = await request(app)
        .post('/v2/workflows/workflow-1/execute')
        .send({ inputData: {} });

      expect(response.status).toBe(403);
    });
  });

  describe('retriggerInstance', () => {
    it('retriggers instance when authorized', async () => {
      app = await createTestApp({
        authorizeImpl: jest.fn().mockImplementation(async requests => {
          const permission = requests[0]?.permission;
          if (
            permission === orchestratorWorkflowUsePermission ||
            permission ===
              orchestratorWorkflowUseSpecificPermission('workflow-1')
          ) {
            return [{ result: AuthorizeResult.ALLOW }];
          }
          return [{ result: AuthorizeResult.ALLOW }];
        }),
      });

      dataIndexServiceMock.fetchWorkflowInfo.mockResolvedValue({
        id: 'workflow-1',
        serviceUrl: 'http://localhost:8080',
      });
      sonataFlowServiceMock.retriggerInstance.mockResolvedValue(true);

      const response = await request(app)
        .post('/v2/workflows/workflow-1/instance-1/retrigger')
        .send({ authTokens: [] });

      expect(response.status).toBe(200);
    });
  });

  describe('abortWorkflow', () => {
    it('aborts workflow instance when authorized', async () => {
      app = await createTestApp({
        authorizeImpl: jest.fn().mockImplementation(async requests => {
          const permission = requests[0]?.permission;
          if (
            permission === orchestratorWorkflowUsePermission ||
            permission ===
              orchestratorWorkflowUseSpecificPermission('workflow-1')
          ) {
            return [{ result: AuthorizeResult.ALLOW }];
          }
          return [{ result: AuthorizeResult.ALLOW }];
        }),
      });

      const instance = {
        ...generateProcessInstance(1),
        processId: 'workflow-1',
        variables: { initiatorEntity: 'user:default/test-user' },
      };
      dataIndexServiceMock.fetchInstance.mockResolvedValue(instance);
      dataIndexServiceMock.fetchWorkflowInfo.mockResolvedValue({
        id: 'workflow-1',
        serviceUrl: 'http://localhost:8080',
      });
      sonataFlowServiceMock.abortInstance.mockResolvedValue(undefined);

      const response = await request(app).delete(
        `/v2/workflows/instances/${instance.id}/abort`,
      );

      expect(response.status).toBe(200);
      expect(response.body).toContain('successfully aborted');
    });
  });

  describe('getWorkflowLogById', () => {
    const createLogApp = async (options?: {
      authorizeImpl?: PermissionsService['authorize'];
      withLogProvider?: boolean;
      logProvider?: typeof lokiLogProvider;
    }) =>
      createTestApp({
        withLogProvider: options?.withLogProvider ?? true,
        logProvider: options?.logProvider,
        authorizeImpl:
          options?.authorizeImpl ??
          jest.fn().mockImplementation(async requests => {
            const name = requests[0]?.permission?.name;
            if (name === orchestratorInstanceAdminViewPermission.name) {
              return [{ result: AuthorizeResult.DENY }];
            }
            return [{ result: AuthorizeResult.ALLOW }];
          }),
      });

    it('returns logs when log provider is configured', async () => {
      const mockLogs = {
        instanceId: 'instance-1',
        logs: ['log line 1'],
      };
      const logProvider = {
        getProviderId: () => 'loki',
        getBaseURL: () => 'https://loki',
        fetchWorkflowLogsByInstance: jest.fn().mockResolvedValue(mockLogs),
      };
      app = await createLogApp({
        logProvider: logProvider as typeof lokiLogProvider,
      });

      const instance = {
        ...generateProcessInstance(1),
        processId: 'workflow-1',
        variables: { initiatorEntity: 'user:default/test-user' },
      };
      dataIndexServiceMock.fetchInstance.mockResolvedValue(instance);

      const response = await request(app).get(
        `/v2/workflows/instances/${instance.id}/logs`,
      );

      expect(response.status).toBe(200);
      expect(response.body.logs).toEqual(['log line 1']);
    });

    it('returns error when no log provider is configured', async () => {
      const instance = {
        ...generateProcessInstance(1),
        processId: 'workflow-1',
        variables: { initiatorEntity: 'user:default/test-user' },
      };
      dataIndexServiceMock.fetchInstance.mockResolvedValue(instance);

      const response = await request(app).get(
        `/v2/workflows/instances/${instance.id}/logs`,
      );

      expect(response.status).toBe(500);
      expect(response.body.error.message).toContain('No log provider setup');
    });

    it('returns unauthorized when log read permission is denied', async () => {
      app = await createLogApp({
        authorizeImpl: jest
          .fn()
          .mockResolvedValue([{ result: AuthorizeResult.DENY }]),
      });

      const instance = {
        ...generateProcessInstance(1),
        processId: 'workflow-1',
        variables: { initiatorEntity: 'user:default/test-user' },
      };
      dataIndexServiceMock.fetchInstance.mockResolvedValue(instance);

      const response = await request(app).get(
        `/v2/workflows/instances/${instance.id}/logs`,
      );

      expect(response.status).toBe(403);
    });

    it('denies log access when initiator does not match', async () => {
      app = await createLogApp();

      const instance = {
        ...generateProcessInstance(1),
        processId: 'workflow-1',
        variables: { initiatorEntity: 'user:default/other-user' },
      };
      dataIndexServiceMock.fetchInstance.mockResolvedValue(instance);

      const response = await request(app).get(
        `/v2/workflows/instances/${instance.id}/logs`,
      );

      expect(response.status).toBe(500);
      expect(response.body.error.message).toContain(
        'Unauthorized to access instance',
      );
    });
  });

  describe('error handling and authorization edge cases', () => {
    it('returns 500 when fetching workflow overviews fails', async () => {
      sonataFlowServiceMock.fetchWorkflowOverviews.mockRejectedValue(
        new Error('overview fetch failed'),
      );

      const response = await request(app)
        .post('/v2/workflows/overview')
        .send({});

      expect(response.status).toBe(500);
    });

    it('returns 500 when fetching entity workflow overviews fails', async () => {
      dataIndexServiceMock.fetchDefinitionIdsFromInstances.mockRejectedValue(
        new Error('entity lookup failed'),
      );

      const response = await request(app)
        .post('/v2/workflows/overview/entity')
        .send({
          targetEntity: 'component:default/test',
          annotationWorkflowIds: ['workflow-1'],
        });

      expect(response.status).toBe(500);
    });

    it('returns 500 when workflow source is not found', async () => {
      dataIndexServiceMock.fetchWorkflowSource.mockResolvedValue(undefined);

      const response = await request(app).get(
        '/v2/workflows/workflow-1/source',
      );

      expect(response.status).toBe(500);
    });

    it('returns 500 when execute workflow fails', async () => {
      app = await createTestApp({
        authorizeImpl: jest.fn().mockImplementation(async requests => {
          const name = requests[0]?.permission?.name ?? '';
          if (name.includes('.use')) {
            return [{ result: AuthorizeResult.ALLOW }];
          }
          return [{ result: AuthorizeResult.ALLOW }];
        }),
      });
      dataIndexServiceMock.fetchWorkflowInfo.mockResolvedValue({
        id: 'workflow-1',
        serviceUrl: 'http://localhost:8080',
      });
      sonataFlowServiceMock.executeWorkflow.mockRejectedValue(
        new Error('execute failed'),
      );

      const response = await request(app)
        .post('/v2/workflows/workflow-1/execute')
        .send({ inputData: {} });

      expect(response.status).toBe(500);
    });

    it('returns 403 when retrigger permission is denied', async () => {
      app = await createTestApp({
        authorizeImpl: jest
          .fn()
          .mockResolvedValue([{ result: AuthorizeResult.DENY }]),
      });

      const response = await request(app)
        .post('/v2/workflows/workflow-1/instance-1/retrigger')
        .send({ authTokens: [] });

      expect(response.status).toBe(403);
    });

    it('returns 500 when retrigger fails', async () => {
      app = await createTestApp({
        authorizeImpl: jest.fn().mockImplementation(async requests => {
          const name = requests[0]?.permission?.name ?? '';
          if (name.includes('.use')) {
            return [{ result: AuthorizeResult.ALLOW }];
          }
          return [{ result: AuthorizeResult.ALLOW }];
        }),
      });
      dataIndexServiceMock.fetchWorkflowInfo.mockResolvedValue({
        id: 'workflow-1',
        serviceUrl: 'http://localhost:8080',
      });
      sonataFlowServiceMock.retriggerInstance.mockRejectedValue(
        new Error('retrigger failed'),
      );

      const response = await request(app)
        .post('/v2/workflows/workflow-1/instance-1/retrigger')
        .send({ authTokens: [] });

      expect(response.status).toBe(500);
    });

    it('returns 403 when workflow overview by id permission is denied', async () => {
      app = await createTestApp({ authorizeResult: AuthorizeResult.DENY });

      const response = await request(app).get(
        '/v2/workflows/workflow-1/overview',
      );

      expect(response.status).toBe(403);
    });

    it('returns 500 when workflow overview by id is not found', async () => {
      sonataFlowServiceMock.fetchWorkflowOverview.mockResolvedValue(undefined);

      const response = await request(app).get(
        '/v2/workflows/workflow-1/overview',
      );

      expect(response.status).toBe(500);
    });

    it('returns 403 when input schema permission is denied', async () => {
      app = await createTestApp({ authorizeResult: AuthorizeResult.DENY });

      const response = await request(app).get(
        '/v2/workflows/workflow-1/inputSchema',
      );

      expect(response.status).toBe(403);
    });

    it('returns 500 when workflow info is missing for input schema', async () => {
      dataIndexServiceMock.fetchWorkflowInfo.mockResolvedValue(undefined);

      const response = await request(app).get(
        '/v2/workflows/workflow-1/inputSchema',
      );

      expect(response.status).toBe(500);
      expect(response.body.error.message).toContain(
        'Failed to fetch workflow info',
      );
    });

    it('returns 500 when service URL is missing for input schema', async () => {
      dataIndexServiceMock.fetchWorkflowInfo.mockResolvedValue({
        id: 'workflow-1',
      });

      const response = await request(app).get(
        '/v2/workflows/workflow-1/inputSchema',
      );

      expect(response.status).toBe(500);
      expect(response.body.error.message).toContain(
        'Service URL is not defined',
      );
    });

    it('returns 500 when workflow definition is missing for input schema', async () => {
      dataIndexServiceMock.fetchWorkflowInfo.mockResolvedValue({
        id: 'workflow-1',
        serviceUrl: 'http://localhost:8080',
      });
      sonataFlowServiceMock.fetchWorkflowDefinition.mockResolvedValue(
        undefined,
      );

      const response = await request(app).get(
        '/v2/workflows/workflow-1/inputSchema',
      );

      expect(response.status).toBe(500);
    });

    it('returns empty object when remote input schema has no properties', async () => {
      dataIndexServiceMock.fetchWorkflowInfo.mockResolvedValue({
        id: 'workflow-1',
        serviceUrl: 'http://localhost:8080',
      });
      sonataFlowServiceMock.fetchWorkflowDefinition.mockResolvedValue({
        id: 'workflow-1',
        specVersion: '0.8',
        dataInputSchema: { type: 'object' },
        states: [],
      });
      sonataFlowServiceMock.fetchWorkflowInfoOnService.mockResolvedValue({
        id: 'workflow-1',
        inputSchema: { properties: undefined },
      });

      const response = await request(app).get(
        '/v2/workflows/workflow-1/inputSchema',
      );

      expect(response.status).toBe(200);
      expect(response.body).toEqual({});
    });

    it('skips undefined workflow data fields when prefilling input schema', async () => {
      dataIndexServiceMock.fetchWorkflowInfo.mockResolvedValue({
        id: 'workflow-1',
        serviceUrl: 'http://localhost:8080',
      });
      sonataFlowServiceMock.fetchWorkflowDefinition.mockResolvedValue({
        id: 'workflow-1',
        specVersion: '0.8',
        dataInputSchema: { type: 'object' },
        states: [],
      });
      dataIndexServiceMock.fetchInstanceVariables.mockResolvedValue({
        workflowdata: { fieldA: undefined, fieldB: 'present' },
      });
      sonataFlowServiceMock.fetchWorkflowInfoOnService.mockResolvedValue({
        id: 'workflow-1',
        inputSchema: {
          properties: {
            fieldA: { type: 'string' },
            fieldB: { type: 'string' },
          },
        },
      });

      const response = await request(app)
        .get('/v2/workflows/workflow-1/inputSchema')
        .query({ instanceId: 'instance-1' });

      expect(response.status).toBe(200);
      expect(response.body.data).toEqual({ fieldB: 'present' });
    });

    it('returns 403 when workflow instances permission is denied', async () => {
      app = await createTestApp({ authorizeResult: AuthorizeResult.DENY });

      const response = await request(app)
        .post('/v2/workflows/workflow-1/instances')
        .send({});

      expect(response.status).toBe(403);
    });

    it('returns 500 when workflow instances fetch fails', async () => {
      dataIndexServiceMock.fetchInstances.mockRejectedValue(
        new Error('instances failed'),
      );

      const response = await request(app)
        .post('/v2/workflows/workflow-1/instances')
        .send({});

      expect(response.status).toBe(500);
    });

    it('returns 403 when ping permission is denied', async () => {
      app = await createTestApp({ authorizeResult: AuthorizeResult.DENY });

      const response = await request(app).get(
        '/v2/workflows/workflow-1/pingWorkflowService',
      );

      expect(response.status).toBe(403);
    });

    it('combines request filters with initiator filter for non-admin users', async () => {
      app = await createTestApp({
        authorizeImpl: jest.fn().mockImplementation(async requests => {
          const name = requests[0]?.permission?.name;
          if (name === orchestratorInstanceAdminViewPermission.name) {
            return [{ result: AuthorizeResult.DENY }];
          }
          return [{ result: AuthorizeResult.ALLOW }];
        }),
      });
      dataIndexServiceMock.fetchInstances.mockResolvedValue([
        generateProcessInstance(1),
      ]);

      const response = await request(app)
        .post('/v2/workflows/instances')
        .send({
          filters: {
            field: 'state',
            operator: 'EQ',
            value: 'ACTIVE',
          },
        });

      expect(response.status).toBe(200);
      expect(dataIndexServiceMock.fetchInstances).toHaveBeenCalledWith(
        expect.objectContaining({
          filter: {
            operator: 'AND',
            filters: expect.arrayContaining([
              expect.objectContaining({
                field: 'variables',
                nested: expect.objectContaining({
                  field: 'initiatorEntity',
                  value: 'user:default/test-user',
                }),
              }),
              expect.objectContaining({
                field: 'state',
                operator: 'EQ',
                value: 'ACTIVE',
              }),
            ]),
          },
        }),
      );
    });

    it('denies instance access when workflow read permission is denied', async () => {
      app = await createTestApp({
        authorizeImpl: jest
          .fn()
          .mockResolvedValue([{ result: AuthorizeResult.DENY }]),
      });
      const instance = {
        ...generateProcessInstance(1),
        processId: 'workflow-1',
        variables: { initiatorEntity: 'user:default/test-user' },
      };
      dataIndexServiceMock.fetchInstance.mockResolvedValue(instance);

      const response = await request(app).get(
        `/v2/workflows/instances/${instance.id}`,
      );

      expect(response.status).toBe(403);
    });

    it('allows instance admin to view instances regardless of initiator', async () => {
      app = await createTestApp({
        authorizeImpl: jest.fn().mockImplementation(async requests => {
          const name = requests[0]?.permission?.name;
          if (name === orchestratorInstanceAdminViewPermission.name) {
            return [{ result: AuthorizeResult.ALLOW }];
          }
          return [{ result: AuthorizeResult.ALLOW }];
        }),
      });
      const instance = {
        ...generateProcessInstance(1),
        processId: 'workflow-1',
        variables: { initiatorEntity: 'user:default/other-user' },
      };
      dataIndexServiceMock.fetchInstance.mockResolvedValue(instance);

      const response = await request(app).get(
        `/v2/workflows/instances/${instance.id}`,
      );

      expect(response.status).toBe(200);
      expect(response.body.id).toBe(instance.id);
    });

    it('returns 403 when abort permission is denied', async () => {
      app = await createTestApp({
        authorizeImpl: jest
          .fn()
          .mockResolvedValue([{ result: AuthorizeResult.DENY }]),
      });
      const instance = generateProcessInstance(1);
      dataIndexServiceMock.fetchInstance.mockResolvedValue(instance);

      const response = await request(app).delete(
        `/v2/workflows/instances/${instance.id}/abort`,
      );

      expect(response.status).toBe(403);
    });

    it('returns 500 when abort fails', async () => {
      app = await createTestApp({
        authorizeImpl: jest.fn().mockImplementation(async requests => {
          const name = requests[0]?.permission?.name ?? '';
          if (name.includes('.use')) {
            return [{ result: AuthorizeResult.ALLOW }];
          }
          return [{ result: AuthorizeResult.ALLOW }];
        }),
      });
      const instance = {
        ...generateProcessInstance(1),
        processId: 'workflow-1',
      };
      dataIndexServiceMock.fetchInstance.mockResolvedValue(instance);
      dataIndexServiceMock.fetchWorkflowInfo.mockResolvedValue({
        id: 'workflow-1',
        serviceUrl: 'http://localhost:8080',
      });
      sonataFlowServiceMock.abortInstance.mockRejectedValue(
        new Error('abort failed'),
      );

      const response = await request(app).delete(
        `/v2/workflows/instances/${instance.id}/abort`,
      );

      expect(response.status).toBe(500);
    });

    it('allows access when specific workflow permission is granted but generic is denied', async () => {
      app = await createTestApp({
        authorizeImpl: jest.fn().mockImplementation(async requests => {
          const name = requests[0]?.permission?.name ?? '';
          if (name === orchestratorWorkflowPermission.name) {
            return [{ result: AuthorizeResult.DENY }];
          }
          if (
            name === orchestratorWorkflowSpecificPermission('workflow-1').name
          ) {
            return [{ result: AuthorizeResult.ALLOW }];
          }
          return [{ result: AuthorizeResult.DENY }];
        }),
      });
      dataIndexServiceMock.fetchWorkflowSource.mockResolvedValue(
        'id: specific-access\nspecVersion: "0.8"',
      );

      const response = await request(app).get(
        '/v2/workflows/workflow-1/source',
      );

      expect(response.status).toBe(200);
      expect(response.text).toContain('specific-access');
    });
  });
});
