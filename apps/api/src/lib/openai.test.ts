import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import {
  AnnualCalendarProposalSchema,
  WeeklyScheduleProposalSchema
} from '@teacheros/contracts';

import { runStructuredPrompt } from './openai.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('OpenAI structured schedule prompts', () => {
  it('uses the Responses API and returns a reviewed weekly proposal', async () => {
    const proposal = {
      courses: [
        {
          name: 'Spanish',
          subject: 'Spanish',
          gradeLevel: '5–8',
          sections: [
            {
              name: '5A',
              meetings: [
                { day: 'Monday', startTime: '12:50', endTime: '13:25', room: null },
                { day: 'Wednesday', startTime: '12:50', endTime: '13:25', room: null }
              ]
            },
            {
              name: '8A',
              meetings: [
                { day: 'Monday', startTime: '10:08', endTime: '10:58', room: null },
                { day: 'Friday', startTime: '09:20', endTime: '10:10', room: null }
              ]
            }
          ]
        }
      ],
      blocks: [
        { day: 'Monday', startTime: '09:48', endTime: '10:05', label: 'Nutrition break', kind: 'break' },
        { day: 'Friday', startTime: '12:45', endTime: '13:15', label: 'Lunch', kind: 'lunch' }
      ],
      warnings: ['Confirm handwritten Friday dismissal note.']
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ output_text: JSON.stringify(proposal) })
    });
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(
      runStructuredPrompt({
        apiKey: 'test-key',
        model: 'gpt-5.6-luna',
        schemaName: 'weekly_schedule_proposal',
        schema: WeeklyScheduleProposalSchema,
        systemPrompt: 'Extract a reviewed schedule.',
        userPrompt: 'A schedule image is attached.',
        userImageDataUrl: 'data:image/png;base64,test'
      })
    ).resolves.toEqual(proposal);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('https://api.openai.com/v1/responses');
    const requestBody = (init as RequestInit).body;
    if (typeof requestBody !== 'string') throw new Error('Expected a JSON request body');
    const body = JSON.parse(requestBody) as Record<string, any>;
    expect(body.model).toBe('gpt-5.6-luna');
    expect(body.reasoning).toEqual({ effort: 'low' });
    expect(body.text.format.type).toBe('json_schema');
    expect(body.text.format.schema.definitions.weekly_schedule_proposal.properties.courses.items.required).toContain(
      'gradeLevel'
    );
    expect(body.input[1].content).toContainEqual({
      type: 'input_image',
      image_url: 'data:image/png;base64,test'
    });
  });

  it('retries a failed request and validates annual date overrides', async () => {
    const calendar = {
      overrides: [
        {
          date: '2026-10-12',
          label: 'Indigenous Peoples Day',
          kind: 'no_school',
          rotationDay: null,
          replaceWeeklySchedule: false,
          meetings: []
        },
        {
          date: '2026-11-20',
          label: 'Early dismissal',
          kind: 'early_release',
          rotationDay: 'A-Day',
          replaceWeeklySchedule: true,
          meetings: []
        }
      ],
      warnings: []
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 429 })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ output_text: JSON.stringify(calendar) }) });
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(
      runStructuredPrompt({
        apiKey: 'test-key',
        model: 'gpt-5.6-luna',
        schemaName: 'annual_calendar_proposal',
        schema: AnnualCalendarProposalSchema,
        systemPrompt: 'Extract dates.',
        userPrompt: 'Calendar text'
      })
    ).resolves.toEqual(calendar);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not accept malformed structured output', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ output_text: '{"courses": []}' })
    });
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(
      runStructuredPrompt({
        apiKey: 'test-key',
        model: 'gpt-5.6-luna',
        schemaName: 'required_name',
        schema: z.object({ name: z.string() }),
        systemPrompt: 'Return a name.',
        userPrompt: 'Test'
      })
    ).rejects.toThrow();
  });
});
