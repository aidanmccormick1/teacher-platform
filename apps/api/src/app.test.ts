import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from './app.js';
import type { AppConfig } from './config.js';

let app: Awaited<ReturnType<typeof createApp>>;

beforeAll(async () => {
  const config: AppConfig = {
    NODE_ENV: 'test',
    API_PORT: 3001,
    REQUEST_ID_HEADER: 'x-request-id',
    CLERK_AUTHORIZED_PARTIES: 'http://localhost:5173',
    DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/teacheros_test',
    OPENAI_MODEL_CONTINUITY: 'gpt-5.6-luna',
    OPENAI_MODEL_GENERATE_SEGMENTS: 'gpt-5.6-luna',
    OPENAI_MODEL_PARSE_SCHEDULE: 'gpt-5.6-luna',
    REDIS_URL: undefined,
    OPENAI_API_KEY: undefined,
    CLERK_SECRET_KEY: undefined,
    S3_REGION: 'us-east-1',
    S3_BUCKET: undefined,
    S3_ACCESS_KEY_ID: undefined,
    S3_SECRET_ACCESS_KEY: undefined,
    SENTRY_DSN: undefined
  };

  app = await createApp(config);
});

afterAll(async () => {
  await app.close();
});

describe('health endpoints', () => {
  it('returns liveness response', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health/liveness'
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });

  it('permits hosted web clients to preflight PUT curriculum updates', async () => {
    const response = await app.inject({
      method: 'OPTIONS',
      url: '/v1/courses/00000000-0000-4000-8000-000000000000/pacing-plan',
      headers: {
        origin: 'https://teacher-dashboard-clean.pages.dev',
        'access-control-request-method': 'PUT'
      }
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers['access-control-allow-methods']).toContain('PUT');
  });
});
