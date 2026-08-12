import { describe, expect, it } from 'vitest';

import { ScheduleImportResponseSchema } from './index.js';

describe('schedule import contract', () => {
  it('preserves both start and end times for an imported class', () => {
    const parsed = ScheduleImportResponseSchema.parse({
      classes: [
        {
          name: 'Algebra I',
          period: 'Period 2',
          days: ['Monday', 'Wednesday', 'Friday'],
          time: '09:05',
          endTime: '09:55',
          room: '204',
          subject: 'Mathematics',
          grade: '9'
        }
      ],
      assignments: []
    });

    expect(parsed.classes[0]).toMatchObject({ time: '09:05', endTime: '09:55' });
  });
});
