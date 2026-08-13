import { describe, expect, it } from 'vitest';

import {
  AnnualCalendarProposalSchema,
  ScheduleImportResponseSchema,
  findScheduleHierarchyProblems,
  normalizeScheduleImportResponse,
  normalizeWeeklyScheduleProposal
} from './index.js';

const meeting = { day: 'Monday' as const, startTime: '08:00', endTime: '08:50', room: null };

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

describe('annual calendar days-off contract', () => {
  it('preserves a reviewed no-school date separately from an early-release schedule change', () => {
    const proposal = AnnualCalendarProposalSchema.parse({
      overrides: [
        {
          date: '2026-11-26',
          label: 'Thanksgiving break',
          kind: 'no_school',
          rotationDay: null,
          replaceWeeklySchedule: false,
          meetings: []
        },
        {
          date: '2026-12-18',
          label: 'Winter break begins — minimum day',
          kind: 'early_release',
          rotationDay: null,
          replaceWeeklySchedule: true,
          meetings: [
            {
              courseName: 'Spanish 5',
              sectionName: 'A',
              startTime: '08:00',
              endTime: '08:35',
              room: '204'
            }
          ]
        }
      ],
      warnings: []
    });

    expect(proposal.overrides[0]).toMatchObject({ kind: 'no_school', meetings: [] });
    expect(proposal.overrides[1]).toMatchObject({
      kind: 'early_release',
      replaceWeeklySchedule: true,
      meetings: [
        { courseName: 'Spanish 5', sectionName: 'A', startTime: '08:00', endTime: '08:35' }
      ]
    });
  });

  it('does not permit a malformed calendar date or an invalid replacement meeting time', () => {
    expect(() =>
      AnnualCalendarProposalSchema.parse({
        overrides: [
          {
            date: 'November 26',
            label: 'Thanksgiving break',
            kind: 'no_school',
            rotationDay: null,
            replaceWeeklySchedule: false,
            meetings: []
          }
        ],
        warnings: []
      })
    ).toThrow();

    expect(() =>
      AnnualCalendarProposalSchema.parse({
        overrides: [
          {
            date: '2026-12-18',
            label: 'Minimum day',
            kind: 'early_release',
            rotationDay: null,
            replaceWeeklySchedule: true,
            meetings: [
              {
                courseName: 'Spanish 5',
                sectionName: 'A',
                startTime: '8:00',
                endTime: '08:35',
                room: null
              }
            ]
          }
        ],
        warnings: []
      })
    ).toThrow();
  });

  it('does not allow a no-school date to carry a teaching schedule', () => {
    expect(() =>
      AnnualCalendarProposalSchema.parse({
        overrides: [
          {
            date: '2026-11-26',
            label: 'Thanksgiving break',
            kind: 'no_school',
            rotationDay: null,
            replaceWeeklySchedule: true,
            meetings: [
              {
                courseName: 'Spanish 5',
                sectionName: 'A',
                startTime: '08:00',
                endTime: '08:35',
                room: null
              }
            ]
          }
        ],
        warnings: []
      })
    ).toThrow('no-school date');
  });
});

describe('schedule Course → Class Group hierarchy normalization', () => {
  it('splits Spanish levels and lettered groups into distinct Courses', () => {
    const proposal = normalizeWeeklyScheduleProposal({
      courses: [
        {
          name: 'Spanish',
          subject: 'World Languages',
          gradeLevel: '5–8',
          sections: ['5A', '5B', '5C', '6A', '6B', '6C', '7A', '7B', '7C', '8A', '8B', '8C'].map(
            (name) => ({ name, meetings: [meeting] })
          )
        }
      ],
      blocks: [],
      warnings: []
    });

    expect(proposal.courses.map((course) => course.name)).toEqual([
      'Spanish 5',
      'Spanish 6',
      'Spanish 7',
      'Spanish 8'
    ]);
    expect(
      proposal.courses.every(
        (course) => course.sections.map((section) => section.name).join(',') === 'A,B,C'
      )
    ).toBe(true);
  });

  it('keeps the same Class Group name independent under distinct Courses', () => {
    const proposal = normalizeWeeklyScheduleProposal({
      courses: [
        {
          name: 'Spanish 5',
          subject: 'Spanish',
          gradeLevel: '5',
          sections: [{ name: 'A', meetings: [meeting] }]
        },
        {
          name: 'Spanish 6',
          subject: 'Spanish',
          gradeLevel: '6',
          sections: [{ name: 'A', meetings: [meeting] }]
        }
      ],
      blocks: [],
      warnings: []
    });

    expect(proposal.courses).toHaveLength(2);
    expect(proposal.courses.map((course) => `${course.name}/${course.sections[0]?.name}`)).toEqual([
      'Spanish 5/A',
      'Spanish 6/A'
    ]);
  });

  it('keeps an explicitly labelled period as the Class Group', () => {
    const proposal = normalizeWeeklyScheduleProposal({
      courses: [
        {
          name: 'Spanish 5',
          subject: 'Spanish',
          gradeLevel: '5',
          sections: [{ name: 'Period 3', meetings: [meeting] }]
        },
        {
          name: 'US History',
          subject: 'History',
          gradeLevel: null,
          sections: [{ name: 'Period 5', meetings: [meeting] }]
        }
      ],
      blocks: [],
      warnings: []
    });

    expect(proposal.courses.map((course) => `${course.name}/${course.sections[0]?.name}`)).toEqual([
      'Spanish 5/Period 3',
      'US History/Period 5'
    ]);
  });

  it('repairs a numbered Course plus letter Class Group in the legacy response', () => {
    const parsed = normalizeScheduleImportResponse({
      classes: [
        {
          name: 'Spanish',
          period: '5B',
          days: ['Monday'],
          time: '08:00',
          endTime: '08:50',
          room: null,
          subject: 'Spanish',
          grade: '5'
        }
      ],
      assignments: [],
      warnings: []
    });

    expect(parsed.classes[0]).toMatchObject({ name: 'Spanish 5', period: 'B' });
  });

  it('separates French curriculum levels without collapsing them by subject', () => {
    const proposal = normalizeWeeklyScheduleProposal({
      courses: [
        {
          name: 'French',
          subject: 'French',
          gradeLevel: null,
          sections: ['1A', '1B', '2A', '2B'].map((name) => ({ name, meetings: [meeting] }))
        }
      ],
      blocks: [],
      warnings: []
    });

    expect(
      proposal.courses.map(
        (course) => `${course.name}: ${course.sections.map((section) => section.name).join(', ')}`
      )
    ).toEqual(['French 1: A, B', 'French 2: A, B']);
  });

  it('normalizes a spelled-out course level without merging different levels', () => {
    const proposal = normalizeWeeklyScheduleProposal({
      courses: [
        {
          name: 'Spanish Five',
          subject: 'Spanish',
          gradeLevel: '5',
          sections: [{ name: 'A', meetings: [meeting] }]
        },
        {
          name: 'Spanish 6',
          subject: 'Spanish',
          gradeLevel: '6',
          sections: [{ name: 'A', meetings: [meeting] }]
        }
      ],
      blocks: [],
      warnings: []
    });

    expect(proposal.courses.map((course) => course.name)).toEqual(['Spanish 5', 'Spanish 6']);
  });

  it('flags an unsafe AI hierarchy instead of silently saving Spanish levels as groups', () => {
    const proposal = normalizeWeeklyScheduleProposal({
      courses: [
        {
          name: 'Spanish',
          subject: 'Spanish',
          gradeLevel: '5–8',
          sections: ['5', '6', '7', '8', 'A', 'B', 'C'].map((name) => ({
            name,
            meetings: [meeting]
          }))
        }
      ],
      blocks: [],
      warnings: []
    });

    expect(findScheduleHierarchyProblems(proposal)).toHaveLength(1);
    expect(proposal.warnings[0]).toContain('Needs hierarchy review');
  });
});
