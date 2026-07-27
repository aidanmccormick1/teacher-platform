import { zodToJsonSchema } from 'zod-to-json-schema';
import { z } from 'zod';

type PromptInput = {
  apiKey: string;
  model: string;
  schemaName: string;
  schema: z.ZodTypeAny;
  systemPrompt: string;
  userPrompt: string;
};

function extractOutputText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Could not extract output text from OpenAI response');
  }

  if ('output_text' in payload && typeof payload.output_text === 'string') {
    return payload.output_text;
  }
  throw new Error('OpenAI response did not include structured output text');
}

export async function runStructuredPrompt<T>(params: PromptInput): Promise<T> {
  const schemaJson = zodToJsonSchema(params.schema, {
    name: params.schemaName,
    $refStrategy: 'none'
  });

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
        { role: 'user', content: [{ type: 'input_text', text: params.userPrompt }] }
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
    })
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
}
