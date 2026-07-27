import 'dotenv/config';

import { z } from 'zod';

import { createAiJobsWorker } from './jobs/ai-jobs.js';

const EnvSchema = z.object({
  REDIS_URL: z.string().min(1).optional(),
  OPENROUTER_API_KEY: z.string().min(1),
  OPENROUTER_MODEL_PARSE_SCHEDULE: z.string().default('openai/gpt-4o-mini'),
  OPENROUTER_MODEL_GENERATE_SEGMENTS: z.string().default('openai/gpt-4o-mini'),
  OPENROUTER_MODEL_CONTINUITY: z.string().default('openai/gpt-4o-mini')
});

const env = EnvSchema.parse(process.env);

if (!env.REDIS_URL) {
  console.log('AI worker disabled: REDIS_URL is not configured');
  process.exit(0);
}

const worker = createAiJobsWorker({
  redisUrl: env.REDIS_URL,
  openRouterApiKey: env.OPENROUTER_API_KEY,
  modelParseSchedule: env.OPENROUTER_MODEL_PARSE_SCHEDULE,
  modelGenerateSegments: env.OPENROUTER_MODEL_GENERATE_SEGMENTS,
  modelContinuity: env.OPENROUTER_MODEL_CONTINUITY
});

worker.on('ready', () => {
  console.log('AI worker ready');
});

worker.on('failed', (job, error) => {
  console.error(`Job ${job?.id ?? 'unknown'} failed`, error);
});
