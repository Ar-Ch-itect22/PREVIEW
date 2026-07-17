import {
  computeEffectGraphDigest,
  createSnapshotManifest,
} from '@preview/approval';
import {
  ConstraintViolationError,
  type Effect,
  type ReplayRevisionTransition,
  type SimulationRevision,
  type SnapshotManifest,
} from '@preview/domain';
import { ReferenceCalendarSimulationAdapter } from '@preview/reference-calendar';
import { ReferenceCrmSimulationAdapter } from '@preview/reference-crm';
import { ReferenceMailSimulationAdapter } from '@preview/reference-mail';
import {
  ReplayCoordinator,
  ShadowRevisionSession,
  type ApprovalPathInvalidator,
} from '@preview/runtime';

import { customerMeetings, type CustomerMeeting, type HeroProviders } from './fixtures.js';

export const HERO_INSTRUCTION = 'I am at an offsite next week. Move every customer meeting to the following week, email attendees with their new times, and push the corresponding CRM follow-up dates.';

export interface CustomerEffectGroup {
  readonly customerName: string;
  readonly effectIds: readonly string[];
  readonly eventResourceKey: string;
  readonly label: string;
}

export interface CustomerOpsSimulationResult {
  readonly effectGroups: readonly CustomerEffectGroup[];
  readonly revision: Readonly<SimulationRevision>;
  readonly snapshot: Readonly<SnapshotManifest>;
}

export async function runCustomerOpsSimulation(
  draftRevision: Readonly<SimulationRevision>,
  providers: HeroProviders,
  meetings: readonly CustomerMeeting[] = customerMeetings,
): Promise<CustomerOpsSimulationResult> {
  const calendar = new ReferenceCalendarSimulationAdapter(providers.calendar.createReadPort());
  const crm = new ReferenceCrmSimulationAdapter(providers.crm.createReadPort());
  const mail = new ReferenceMailSimulationAdapter(providers.mail.createReadPort());
  const session = new ShadowRevisionSession(structuredClone(draftRevision));
  const effectGroups: CustomerEffectGroup[] = [];

  for (const meeting of meetings) {
    const calendarResourceKey = `${calendar.adapterId}:event:${meeting.eventId}`;
    const observed = await session.read(
      calendarResourceKey,
      () => calendar.read(calendarResourceKey),
      observationOptions(calendar.adapterId),
    );
    if (observed === undefined) throw new Error(`Missing hero event ${meeting.eventId}`);
    const calendarEffectId = `effect:calendar:${meeting.eventId}`;
    try {
      await session.stage(
        calendarResourceKey,
        () => calendar.read(calendarResourceKey),
        { effectId: calendarEffectId, observation: observationOptions(calendar.adapterId) },
        (current, context) => calendar.stage(current, {
          end: shiftIsoByDays(observed.end, 7),
          eventId: meeting.eventId,
          start: shiftIsoByDays(observed.start, 7),
        }, context),
      );
    } catch (error) {
      if (
        error instanceof ConstraintViolationError
        && error.constraintKind === 'DENY_MUTATION'
        && error.resourceKey === calendarResourceKey
      ) {
        continue;
      }
      throw error;
    }

    const moved = await session.read(
      calendarResourceKey,
      () => calendar.read(calendarResourceKey),
      observationOptions(calendar.adapterId),
    );
    if (moved === undefined) throw new Error(`Missing staged hero event ${meeting.eventId}`);

    const mailResourceKey = `${mail.adapterId}:message:${meeting.mailMessageId}`;
    const mailEffectId = `effect:mail:${meeting.mailMessageId}`;
    await session.read(
      mailResourceKey,
      () => mail.read(mailResourceKey),
      observationOptions(mail.adapterId),
    );
    await session.stage(
      mailResourceKey,
      () => mail.read(mailResourceKey),
      {
        dependencyResourceKeys: [calendarResourceKey],
        effectId: mailEffectId,
        observation: observationOptions(mail.adapterId),
      },
      (current, context) => mail.stage(current, {
        messageId: meeting.mailMessageId,
        recipients: [...meeting.attendeeRecipients],
        subject: `${observed.title} moved`,
        textBody: {
          field: 'start',
          prefix: `The ${observed.title} has moved to `,
          resourceKey: calendarResourceKey,
          suffix: '.',
        },
      }, context),
    );

    const crmResourceKey = `${crm.adapterId}:record:${meeting.crmRecordId}`;
    const crmEffectId = `effect:crm:${meeting.crmRecordId}`;
    await session.read(
      crmResourceKey,
      () => crm.read(crmResourceKey),
      observationOptions(crm.adapterId),
    );
    await session.stage(
      crmResourceKey,
      () => crm.read(crmResourceKey),
      {
        dependencyResourceKeys: [calendarResourceKey],
        effectId: crmEffectId,
        observation: observationOptions(crm.adapterId),
      },
      (current, context) => crm.stage(current, {
        recordId: meeting.crmRecordId,
        source: { field: 'start', resourceKey: calendarResourceKey },
      }, context),
    );

    effectGroups.push(Object.freeze({
      customerName: meeting.customerName,
      effectIds: Object.freeze([calendarEffectId, mailEffectId, crmEffectId]),
      eventResourceKey: calendarResourceKey,
      label: observed.title,
    }));
  }

  const snapshot = createSnapshotManifest(session.inspectObservations());
  const revision = session.seal(computeEffectGraphDigest);
  return Object.freeze({ effectGroups: Object.freeze(effectGroups), revision, snapshot });
}

export function protectCalendarEvent(
  priorRevision: Readonly<SimulationRevision>,
  eventId: string,
  replayRevisionId: string,
  approvalPaths: ApprovalPathInvalidator,
): ReplayRevisionTransition {
  return new ReplayCoordinator(approvalPaths).beginReplay(priorRevision, {
    constraints: [{
      kind: 'DENY_MUTATION',
      resourceKey: `reference-calendar:event:${eventId}`,
    }],
    revisionId: replayRevisionId,
  });
}

export function effectsForCustomer(
  result: CustomerOpsSimulationResult,
  customerName: string,
): readonly Effect[] {
  const group = result.effectGroups.find((candidate) => candidate.customerName === customerName);
  if (group === undefined) return [];
  const effectIds = new Set(group.effectIds);
  return result.revision.effectGraph?.effects.filter((effect) => effectIds.has(effect.id)) ?? [];
}

function shiftIsoByDays(value: string, days: number): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid hero fixture date: ${value}`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function observationOptions(adapterId: string) {
  return {
    adapterId,
    observedAt: '2026-07-17T00:00:00.000Z',
    version: readVersion,
  };
}

function readVersion(resource: unknown): string | null {
  if (resource === null || typeof resource !== 'object') return null;
  const version = (resource as { version?: unknown }).version;
  return typeof version === 'string' ? version : null;
}
