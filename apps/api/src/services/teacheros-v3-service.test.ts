import { describe, expect, it } from 'vitest';

import {
  buildMeetingCandidates,
  calculatePlannedPercentage,
  findCurrentMeeting,
  isIanaTimezone,
  zonedDateParts
} from './teacheros-v3-service.js';

describe('TeacherOS v3 calendar engine', () => {
  const base = {
    startDate: '2026-10-12',
    endDate: '2026-10-16',
    rules: [
      {
        id: 'rule-1',
        startTime: '10:00',
        endTime: '10:50',
        effectiveStart: null,
        effectiveEnd: null,
        room: null
      }
    ],
    ruleDays: [
      { meetingRuleId: 'rule-1', weekday: 1 },
      { meetingRuleId: 'rule-1', weekday: 3 },
      { meetingRuleId: 'rule-1', weekday: 5 }
    ]
  };

  it('does not let a Schedule Override recreate a non-instructional date', () => {
    const meetings = buildMeetingCandidates({
      ...base,
      events: [{ startDate: '2026-10-14', endDate: '2026-10-14', instructional: false }],
      overrides: [
        {
          date: '2026-10-14',
          meetings: [{ action: 'replace', startTime: '09:20', endTime: '09:55', room: null }]
        }
      ]
    });
    expect(meetings.map((meeting) => meeting.localDate)).toEqual(['2026-10-12', '2026-10-16']);
  });

  it('applies a minimum-day override to an instructional meeting', () => {
    const meetings = buildMeetingCandidates({
      ...base,
      events: [],
      overrides: [
        {
          date: '2026-10-14',
          meetings: [{ action: 'replace', startTime: '09:20', endTime: '09:55', room: null }]
        }
      ]
    });
    expect(meetings.find((meeting) => meeting.localDate === '2026-10-14')).toMatchObject({
      startTime: '09:20',
      endTime: '09:55',
      source: 'override'
    });
  });

  it('generates only effective M/W/F instructional meetings', () => {
    const meetings = buildMeetingCandidates({
      ...base,
      rules: [{ ...base.rules[0]!, effectiveStart: '2026-10-14', effectiveEnd: '2026-10-16' }],
      events: [],
      overrides: []
    });
    expect(meetings.map((meeting) => meeting.localDate)).toEqual(['2026-10-14', '2026-10-16']);
  });

  it('uses the stored TeacherOS timezone to interpret an instant', () => {
    const instant = new Date('2026-10-16T16:30:00.000Z');
    expect(zonedDateParts('America/Los_Angeles', instant)).toEqual({
      localDate: '2026-10-16',
      localTime: '09:30'
    });
    expect(zonedDateParts('America/New_York', instant)).toEqual({
      localDate: '2026-10-16',
      localTime: '12:30'
    });
  });

  it('accepts IANA timezones for one-time account initialization', () => {
    expect(isIanaTimezone('America/Los_Angeles')).toBe(true);
    expect(isIanaTimezone('not/a-timezone')).toBe(false);
  });

  it('returns no current meeting when no Class Group is active', () => {
    expect(
      findCurrentMeeting([{ localDate: '2026-10-16', startTime: '10:00', endTime: '10:50' }], {
        localDate: '2026-10-16',
        localTime: '09:30'
      })
    ).toBeNull();
  });

  it('recognizes an exact start time returned by PostgreSQL time columns', () => {
    expect(
      findCurrentMeeting(
        [{ localDate: '2026-10-16', startTime: '10:00:00', endTime: '10:50:00' }],
        { localDate: '2026-10-16', localTime: '10:00' }
      )
    ).not.toBeNull();
  });
});

describe('TeacherOS v3 Class Group planned percentage', () => {
  it('counts multiple Lesson allocations in one Meeting once', () => {
    const metric = calculatePlannedPercentage({
      meetingIds: ['m1', 'm2', 'm3'],
      allocations: [
        { meetingInstanceId: 'm1', unitId: 'u1' },
        { meetingInstanceId: 'm1', unitId: 'u1' }
      ],
      unitPlans: [],
      meetingDates: new Map([
        ['m1', '2026-08-24'],
        ['m2', '2026-08-26'],
        ['m3', '2026-08-28']
      ]),
      weeklyMeetingCount: 3
    });
    expect(metric).toMatchObject({ explicitMeetings: 1, overCapacityMeetings: 0 });
    expect(metric.percent).toBeCloseTo(100 / 3);
  });

  it('does not double-count an explicit meeting against its Unit estimate', () => {
    const metric = calculatePlannedPercentage({
      meetingIds: ['m1', 'm2', 'm3', 'm4'],
      allocations: [{ meetingInstanceId: 'm1', unitId: 'u1' }],
      unitPlans: [
        { unitId: 'u1', estimatedMeetings: 3, estimatedWeeks: null, startDate: null, endDate: null }
      ],
      meetingDates: new Map([
        ['m1', '2026-08-24'],
        ['m2', '2026-08-26'],
        ['m3', '2026-08-28'],
        ['m4', '2026-08-31']
      ]),
      weeklyMeetingCount: 3
    });
    expect(metric).toMatchObject({
      explicitMeetings: 1,
      estimatedMeetings: 2,
      percent: 75,
      isApproximate: true
    });
  });

  it('caps displayed capacity and reports over-planning', () => {
    const metric = calculatePlannedPercentage({
      meetingIds: ['m1', 'm2'],
      allocations: [{ meetingInstanceId: 'm1', unitId: 'u1' }],
      unitPlans: [
        { unitId: 'u1', estimatedMeetings: 5, estimatedWeeks: null, startDate: null, endDate: null }
      ],
      meetingDates: new Map([
        ['m1', '2026-08-24'],
        ['m2', '2026-08-26']
      ]),
      weeklyMeetingCount: 2
    });
    expect(metric.percent).toBe(100);
    expect(metric.overCapacityMeetings).toBe(3);
  });
});
