import {
  ApprovalValidationError,
  ContentBoundApprovalAuthority,
} from '@preview/approval';
import { sendMessageEffectSchema } from '@preview/reference-mail';
import { describe, expect, it } from 'vitest';

import {
  createHeroDraft,
  createHeroProviders,
  customerMeetings,
  effectsForCustomer,
  protectCalendarEvent,
  runCustomerOpsSimulation,
} from '../src/index.js';

describe('Gate 4 Customer Ops replay', () => {
  it('removes the protected Acme causal group on every clean replay', async () => {
    const providers = createHeroProviders();
    const calendarBefore = providers.calendar.snapshotBytes();
    const mailBefore = providers.mail.snapshotBytes();
    const crmBefore = providers.crm.snapshotBytes();
    const revisionOne = await runCustomerOpsSimulation(createHeroDraft('hero-revision-1'), providers);
    const acmeEffects = effectsForCustomer(revisionOne, 'Acme');
    const acmeCalendar = acmeEffects[0];
    const acmeMail = acmeEffects[1];
    const acmeCrm = acmeEffects[2];

    expect(customerMeetings[0]).toMatchObject({
      customerName: 'Acme',
      recurrenceScope: 'THIS_EVENT',
      renewalValueUsd: 1_250_000,
    });
    expect(revisionOne.revision.effectGraph?.effects).toHaveLength(6);
    expect(revisionOne.effectGroups[0]?.label).toBe('Acme renewal');
    expect(revisionOne.revision.graphDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(acmeCalendar).toMatchObject({
      adapterId: 'reference-calendar',
      dependencies: [],
      resourceKey: 'reference-calendar:event:acme-renewal',
    });
    expect(acmeMail).toMatchObject({
      adapterId: 'reference-mail',
      dependencies: [acmeCalendar?.id],
      resourceKey: 'reference-mail:message:mail-acme-renewal',
    });
    expect(acmeCrm).toMatchObject({
      adapterId: 'reference-crm',
      dependencies: [acmeCalendar?.id],
      resourceKey: 'reference-crm:record:crm-acme-renewal',
    });
    expect(sendMessageEffectSchema.parse(acmeMail).payload.textBody).toBe(
      'The Acme renewal has moved to 2026-07-27T10:00:00.000Z.',
    );

    const authority = new ContentBoundApprovalAuthority('gate-four-signing-key');
    const oldApproval = authority.approve(revisionOne.revision, {
      approverId: 'aru',
      expiresAt: '2026-07-20T00:00:00.000Z',
      policyVersion: 'gate-4',
      tenantId: 'tenant-1',
    });
    const firstReplay = protectCalendarEvent(
      revisionOne.revision,
      'acme-renewal',
      'hero-revision-2',
      authority,
    );
    const priorGraphBytes = JSON.stringify(revisionOne.revision.effectGraph);

    expect(firstReplay.invalidatedRevision.status).toBe('INVALIDATED');
    expect(JSON.stringify(firstReplay.invalidatedRevision.effectGraph)).toBe(priorGraphBytes);
    expect(firstReplay.replayRevision).toMatchObject({
      baseSnapshotId: revisionOne.revision.baseSnapshotId,
      replayOfRevisionId: revisionOne.revision.id,
      revisionNumber: 2,
      status: 'DRAFT',
    });
    expect(() => authority.approve(revisionOne.revision, {
      approverId: 'aru',
      expiresAt: '2026-07-20T00:00:00.000Z',
      policyVersion: 'gate-4',
      tenantId: 'tenant-1',
    })).toThrow(ApprovalValidationError);
    expect(() => authority.verify(
      oldApproval,
      revisionOne.revision,
      { approverId: 'aru', tenantId: 'tenant-1' },
      new Date('2026-07-17T00:00:00.000Z'),
    )).toThrow(ApprovalValidationError);

    const revisionTwo = await runCustomerOpsSimulation(firstReplay.replayRevision, providers);
    const repeatedReplay = protectCalendarEvent(
      revisionOne.revision,
      'acme-renewal',
      'hero-revision-2-repeat',
      authority,
    );
    const repeated = await runCustomerOpsSimulation(repeatedReplay.replayRevision, providers);
    const revisionTwoResources = revisionTwo.revision.effectGraph?.effects.map(
      (effect) => effect.resourceKey,
    );
    const mailBodies = revisionTwo.revision.effectGraph?.effects
      .filter((effect) => effect.adapterId === 'reference-mail')
      .map((effect) => sendMessageEffectSchema.parse(effect).payload.textBody);

    expect(revisionTwo.revision.effectGraph?.effects).toHaveLength(3);
    expect(revisionTwo.effectGroups.map((group) => group.customerName)).toEqual(['Globex']);
    expect(revisionTwoResources).not.toContain('reference-calendar:event:acme-renewal');
    expect(revisionTwoResources).not.toContain('reference-mail:message:mail-acme-renewal');
    expect(revisionTwoResources).not.toContain('reference-crm:record:crm-acme-renewal');
    expect(mailBodies).toEqual([
      'The Globex renewal has moved to 2026-07-28T14:00:00.000Z.',
    ]);
    expect(revisionTwo.revision.graphDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(revisionTwo.revision.graphDigest).not.toBe(revisionOne.revision.graphDigest);
    expect(repeated.revision.graphDigest).toBe(revisionTwo.revision.graphDigest);
    expect(repeated.revision.effectGraph).toEqual(revisionTwo.revision.effectGraph);
    expect(providers.calendar.snapshotBytes().equals(calendarBefore)).toBe(true);
    expect(providers.mail.snapshotBytes().equals(mailBefore)).toBe(true);
    expect(providers.crm.snapshotBytes().equals(crmBefore)).toBe(true);
    expect(providers.calendar.mutationCount).toBe(0);
  });
});
