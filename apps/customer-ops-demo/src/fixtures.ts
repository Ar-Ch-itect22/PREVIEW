import type { SimulationRevision } from '@preview/domain';
import {
  InMemoryReferenceCalendarProvider,
  type CalendarEvent,
} from '@preview/reference-calendar';
import {
  InMemoryReferenceCrmProvider,
  type CrmRecord,
} from '@preview/reference-crm';
import { InMemoryReferenceMailProvider } from '@preview/reference-mail';

export interface CustomerMeeting {
  readonly attendeeRecipients: readonly string[];
  readonly customerName: string;
  readonly eventId: string;
  readonly mailMessageId: string;
  readonly recurrenceScope: 'SERIES' | 'THIS_EVENT';
  readonly renewalDeadline: string;
  readonly renewalValueUsd: number;
  readonly crmRecordId: string;
}

export const customerMeetings: readonly CustomerMeeting[] = Object.freeze([
  {
    attendeeRecipients: ['buyer@acme.example.test'],
    crmRecordId: 'crm-acme-renewal',
    customerName: 'Acme',
    eventId: 'acme-renewal',
    mailMessageId: 'mail-acme-renewal',
    recurrenceScope: 'THIS_EVENT',
    renewalDeadline: '2026-07-24T23:59:59.000Z',
    renewalValueUsd: 1_250_000,
  },
  {
    attendeeRecipients: ['sponsor@globex.example.test'],
    crmRecordId: 'crm-globex-renewal',
    customerName: 'Globex',
    eventId: 'globex-renewal',
    mailMessageId: 'mail-globex-renewal',
    recurrenceScope: 'THIS_EVENT',
    renewalDeadline: '2026-08-15T23:59:59.000Z',
    renewalValueUsd: 180_000,
  },
]);

const calendarEvents: readonly CalendarEvent[] = [
  {
    end: '2026-07-20T10:30:00.000Z',
    id: 'acme-renewal',
    start: '2026-07-20T10:00:00.000Z',
    title: 'Acme renewal',
    version: 'v1',
  },
  {
    end: '2026-07-21T14:30:00.000Z',
    id: 'globex-renewal',
    start: '2026-07-21T14:00:00.000Z',
    title: 'Globex renewal',
    version: 'v1',
  },
];

const crmRecords: readonly CrmRecord[] = [
  {
    followUpAt: '2026-07-20T10:00:00.000Z',
    id: 'crm-acme-renewal',
    label: 'Acme renewal follow-up',
    version: 'v1',
  },
  {
    followUpAt: '2026-07-21T14:00:00.000Z',
    id: 'crm-globex-renewal',
    label: 'Globex renewal follow-up',
    version: 'v1',
  },
];

export interface HeroProviders {
  readonly calendar: InMemoryReferenceCalendarProvider;
  readonly crm: InMemoryReferenceCrmProvider;
  readonly mail: InMemoryReferenceMailProvider;
}

export function createHeroProviders(): HeroProviders {
  return {
    calendar: new InMemoryReferenceCalendarProvider(calendarEvents),
    crm: new InMemoryReferenceCrmProvider(crmRecords),
    mail: new InMemoryReferenceMailProvider([]),
  };
}

export function createHeroDraft(id: string): SimulationRevision {
  return {
    baseSnapshotDigest: null,
    baseSnapshotId: 'hero-snapshot-1',
    effectGraph: null,
    graphDigest: null,
    id,
    replayOfRevisionId: null,
    revisionNumber: 1,
    status: 'DRAFT',
    structuredConstraints: [],
    transactionId: 'hero-transaction-1',
  };
}
