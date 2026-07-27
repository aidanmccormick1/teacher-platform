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
  if (!payload || typeof payload !== 'object' || !('choices' in payload) || !Array.isArray(payload.choices)) {
    throw new Error('Could not extract output text from OpenRouter response');
  }

  const content = payload.choices[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new Error('OpenRouter response did not include a text completion');
  }

  return content;
}

export async function runStructuredPrompt<T>(params: PromptInput): Promise<T> {
  const schemaJson = zodToJsonSchema(params.schema, params.schemaName);

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: params.model,
      messages: [
        { role: 'system', content: params.systemPrompt },
        { role: 'user', content: params.userPrompt }
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: params.schemaName,
          strict: true,
          schema: schemaJson
        }
      }
    })
  });

  if (!response.ok) {
    throw new Error(`OpenRouter request failed with status ${response.status}`);
  }

  const payload = (await response.json()) as unknown;
  const outputText = extractOutputText(payload);
  const parsedOutput = JSON.parse(outputText) as unknown;

  return params.schema.parse(parsedOutput) as T;
}
