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
    OPENROUTER_MODEL_CONTINUITY: 'openai/gpt-4o-mini',
    OPENROUTER_MODEL_GENERATE_SEGMENTS: 'openai/gpt-4o-mini',
    OPENROUTER_MODEL_PARSE_SCHEDULE: 'openai/gpt-4o-mini',
    REDIS_URL: undefined,
    OPENROUTER_API_KEY: undefined,
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
});
