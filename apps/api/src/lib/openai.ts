import { zodToJsonSchema } from 'zod-to-json-schema';
import { z } from 'zod';

type PromptInput = {
  apiKey: string;
  model: string;
  schemaName: string;
  schema: z.ZodTypeAny;
  systemPrompt: string;
  userPrompt: string;
  userImageDataUrl?: string;
  userImageDataUrls?: string[];
};

const OPENAI_REQUEST_TIMEOUT_MS = 45_000;

/**
 * The Responses API strict-schema mode requires every object property to be
 * listed in `required`, including properties that Zod models as optional.
 * Zod's parser still supplies defaults after a response is received; this only
 * makes the JSON Schema acceptable to the provider and gives the model a
 * complete response shape to fill.
 */
function makeSchemaStrictForOpenAi(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(makeSchemaStrictForOpenAi);
  if (!schema || typeof schema !== 'object') return schema;

  const record = schema as Record<string, unknown>;
  const normalized = Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key, makeSchemaStrictForOpenAi(value)])
  );
  const properties = normalized.properties;
  if (properties && typeof properties === 'object' && !Array.isArray(properties)) {
    normalized.required = Object.keys(properties);
  }
  return normalized;
}

function extractOutputText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Could not extract output text from OpenAI response');
  }

  if ('output_text' in payload && typeof payload.output_text === 'string') {
    return payload.output_text;
  }

  if ('output' in payload && Array.isArray(payload.output)) {
    for (const item of payload.output) {
      if (!item || typeof item !== 'object' || !('content' in item) || !Array.isArray(item.content))
        continue;
      for (const content of item.content) {
        const contentRecord = content as Record<string, unknown>;
        if (
          content &&
          typeof content === 'object' &&
          contentRecord.type === 'output_text' &&
          typeof contentRecord.text === 'string'
        ) {
          return contentRecord.text;
        }
      }
    }
  }

  throw new Error('OpenAI response did not include structured output text');
}

export async function runStructuredPrompt<T>(params: PromptInput): Promise<T> {
  const schemaJson = makeSchemaStrictForOpenAi(zodToJsonSchema(params.schema, {
    name: params.schemaName,
    $refStrategy: 'none'
  }));
  const imageUrls = [
    ...(params.userImageDataUrls ?? []),
    ...(params.userImageDataUrl ? [params.userImageDataUrl] : [])
  ];
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const controller = new AbortController();
      timeout = setTimeout(() => controller.abort(), OPENAI_REQUEST_TIMEOUT_MS);
      const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${params.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: params.model,
          input: [
            { role: 'system', content: [{ type: 'input_text', text: params.systemPrompt }] },
            {
              role: 'user',
              content: [
                { type: 'input_text', text: params.userPrompt },
                ...imageUrls.map((imageUrl) => ({ type: 'input_image', image_url: imageUrl }))
              ]
            }
          ],
          reasoning: { effort: 'low' },
          text: {
            format: {
              type: 'json_schema',
              name: params.schemaName,
              strict: true,
              schema: schemaJson
            }
          }
        }),
        signal: controller.signal
      });
      if (!response.ok) {
        const errorPayload = (await response.json().catch(() => null)) as {
          error?: { message?: unknown };
        } | null;
        const detail = errorPayload?.error?.message;
        throw new Error(
          `OpenAI request failed with status ${response.status}${
            typeof detail === 'string' ? `: ${detail}` : ''
          }`
        );
      }

      const payload = (await response.json()) as unknown;
      const outputText = extractOutputText(payload);
      const parsedOutput = JSON.parse(outputText) as unknown;

      return params.schema.parse(parsedOutput) as T;
    } catch (error) {
      lastError =
        error instanceof Error && error.name === 'AbortError'
          ? new Error('OpenAI request timed out after 45 seconds. Try a clearer or smaller schedule file.')
          : error;

      if (attempt === 0 && lastError instanceof Error && /status (400|401|403|404)/.test(lastError.message)) {
        break;
      }
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  throw lastError instanceof Error ? lastError : new Error('OpenAI structured request failed');
}
