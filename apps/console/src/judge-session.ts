import { ContentBoundApprovalAuthority } from '@preview/approval';
import {
  createHeroDraft,
  createHeroProviders,
  customerMeetings,
  HERO_INSTRUCTION,
  protectCalendarEvent,
  runCustomerOpsSimulation,
  type CustomerOpsSimulationResult,
  type HeroProviders,
} from '@preview/customer-ops-demo';
import type { Approval, Effect, Receipt } from '@preview/domain';
import { InMemorySagaStore, type SagaJournalEntry, type StoredApprovalContext } from '@preview/persistence';
import {
  ReferenceCalendarCommitAdapter,
  moveEffectSchema,
} from '@preview/reference-calendar';
import { ReferenceCrmCommitAdapter, moveFollowUpEffectSchema } from '@preview/reference-crm';
import { ReferenceMailCommitAdapter, sendMessageEffectSchema } from '@preview/reference-mail';
import { eraseDurableCommitAdapter, executeDurableSaga } from '@preview/worker';

const ADAPTER_VERSIONS = Object.freeze({
  'reference-calendar': '1.0.0',
  'reference-crm': '1.0.0',
  'reference-mail': '1.0.0',
});

export type JudgePhase = 'ABORTED' | 'APPROVED' | 'COMMITTED' | 'READY' | 'REPLAYED' | 'REVIEW';

export interface EffectView {
  readonly adapterId: string;
  readonly after: Readonly<Record<string, unknown>>;
  readonly before: Readonly<Record<string, unknown>> | null;
  readonly customerName: string;
  readonly dependencies: readonly string[];
  readonly externalities: readonly string[];
  readonly id: string;
  readonly operation: string;
  readonly resourceKey: string;
  readonly risk: Effect['risk'];
  readonly summary: string;
  readonly system: 'Calendar' | 'CRM' | 'Mail';
}
export interface ProviderStateView {
  readonly calendarMutations: number;
  readonly crmMutations: number;
  readonly mailMutations: number;
  readonly totalMutations: number;
  readonly unchangedFromBase: boolean;
}

export interface JudgeSessionView {
  readonly approval: Readonly<Approval> | null;
  readonly effectCount: number;
  readonly effects: readonly EffectView[];
  readonly graphDigest: string | null;
  readonly instruction: string;
  readonly invalidatedGraphDigest: string | null;
  readonly journal: readonly Readonly<SagaJournalEntry>[];
  readonly phase: JudgePhase;
  readonly providerState: ProviderStateView;
  readonly receipt: Readonly<Receipt> | null;
  readonly replayConstraint: string | null;
  readonly revisionId: string | null;
  readonly revisionNumber: number | null;
  readonly snapshotDigest: string | null;
  readonly transactionId: string;
}

export class JudgeSessionError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'JudgeSessionError';
  }
}

export class JudgeSession {
  readonly #authority = new ContentBoundApprovalAuthority('preview-judge-mode-signing-key');
  readonly #baseline: Readonly<{ calendar: Buffer; crm: Buffer; mail: Buffer }>;
  readonly #clock: () => Date;
  readonly #providers: HeroProviders;
  readonly #store = new InMemorySagaStore();
  #approval: Readonly<Approval> | null = null;
  #approvalContext: StoredApprovalContext | null = null;
  #invalidatedGraphDigest: string | null = null;
  #journal: readonly Readonly<SagaJournalEntry>[] = Object.freeze([]);
  #phase: JudgePhase = 'READY';
  #receipt: Readonly<Receipt> | null = null;
  #simulation: CustomerOpsSimulationResult | null = null;

  public constructor(clock: () => Date = () => new Date()) {
    this.#clock = clock;
    this.#providers = createHeroProviders();
    this.#baseline = Object.freeze({
      calendar: this.#providers.calendar.snapshotBytes(),
      crm: this.#providers.crm.snapshotBytes(),
      mail: this.#providers.mail.snapshotBytes(),
    });
  }

  public async stage(): Promise<JudgeSessionView> {
    this.#requirePhase('READY');
    this.#simulation = await runCustomerOpsSimulation(
      createHeroDraft('judge-revision-1'),
      this.#providers,
    );
    this.#phase = 'REVIEW';
    return this.view();
  }

  public async protectAcme(): Promise<JudgeSessionView> {
    this.#requirePhase('REVIEW');
    const prior = this.#requiredSimulation();
    this.#invalidatedGraphDigest = prior.revision.graphDigest;
    const transition = protectCalendarEvent(
      prior.revision,
      'acme-renewal',
      'judge-revision-2',
      this.#authority,
    );
    this.#simulation = await runCustomerOpsSimulation(
      transition.replayRevision,
      this.#providers,
    );
    this.#phase = 'REPLAYED';
    return this.view();
  }

  public approve(): Promise<JudgeSessionView> {
    if (this.#phase !== 'REVIEW' && this.#phase !== 'REPLAYED') {
      throw new JudgeSessionError(`Cannot approve while session is ${this.#phase}`);
    }
    const simulation = this.#requiredSimulation();
    const now = this.#clock();
    const approvalContext = Object.freeze({
      adapterVersions: ADAPTER_VERSIONS,
      approverId: 'judge@preview.local',
      policyVersions: { transaction: 'judge-mode-v1' },
      snapshot: simulation.snapshot,
      tenantId: 'judge-mode',
    });
    this.#approval = this.#authority.approve(simulation.revision, {
      ...approvalContext,
      expiresAt: new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString(),
    });
    this.#approvalContext = approvalContext;
    this.#phase = 'APPROVED';
    return this.view();
  }

  public async commit(): Promise<JudgeSessionView> {
    this.#requirePhase('APPROVED');
    const simulation = this.#requiredSimulation();
    const approval = this.#approval;
    const approvalContext = this.#approvalContext;
    if (approval === null || approvalContext === null) {
      throw new JudgeSessionError('Commit requires content-bound approval');
    }
    const authorizedAt = this.#clock().toISOString();
    const runId = `judge-run-${String(simulation.revision.revisionNumber)}`;
    this.#receipt = await executeDurableSaga({
      adapters: [
        eraseDurableCommitAdapter(
          new ReferenceCalendarCommitAdapter(this.#providers.calendar.createCommitPort()),
        ),
        eraseDurableCommitAdapter(
          new ReferenceCrmCommitAdapter(this.#providers.crm.createCommitPort()),
        ),
        eraseDurableCommitAdapter(
          new ReferenceMailCommitAdapter(this.#providers.mail.createCommitPort()),
        ),
      ],
      authority: this.#authority,
      now: this.#clock,
      ownerId: 'judge-mode-worker',
      seed: {
        approval,
        approvalContext,
        authorizedAt,
        createdAt: authorizedAt,
        revision: simulation.revision,
        runId,
      },
      store: this.#store,
    });
    this.#journal = await this.#store.listEvents(runId);
    this.#phase = 'COMMITTED';
    return this.view();
  }

  public abort(): Promise<JudgeSessionView> {
    if (this.#phase === 'APPROVED' || this.#phase === 'COMMITTED') {
      throw new JudgeSessionError(`Cannot abort while session is ${this.#phase}`);
    }
    this.#phase = 'ABORTED';
    return this.view();
  }

  public view(): Promise<JudgeSessionView> {
    const revision = this.#simulation?.revision ?? null;
    const effects = revision?.effectGraph?.effects ?? [];
    return Promise.resolve(Object.freeze({
      approval: this.#approval,
      effectCount: effects.length,
      effects: Object.freeze(effects.map(toEffectView)),
      graphDigest: revision?.graphDigest ?? null,
      instruction: HERO_INSTRUCTION,
      invalidatedGraphDigest: this.#invalidatedGraphDigest,
      journal: this.#journal,
      phase: this.#phase,
      providerState: this.#providerState(),
      receipt: this.#receipt,
      replayConstraint: this.#phase === 'REPLAYED' || this.#phase === 'APPROVED' || this.#phase === 'COMMITTED'
        ? 'Protect Acme renewal — do not move this Calendar event'
        : null,
      revisionId: revision?.id ?? null,
      revisionNumber: revision?.revisionNumber ?? null,
      snapshotDigest: revision?.baseSnapshotDigest ?? null,
      transactionId: 'hero-transaction-1',
    }));
  }

  #providerState(): ProviderStateView {
    const calendarMutations = this.#providers.calendar.mutationCount;
    const crmMutations = this.#providers.crm.mutationCount;
    const mailMutations = this.#providers.mail.mutationCount;
    return Object.freeze({
      calendarMutations,
      crmMutations,
      mailMutations,
      totalMutations: calendarMutations + crmMutations + mailMutations,
      unchangedFromBase: this.#providers.calendar.snapshotBytes().equals(this.#baseline.calendar)
        && this.#providers.crm.snapshotBytes().equals(this.#baseline.crm)
        && this.#providers.mail.snapshotBytes().equals(this.#baseline.mail),
    });
  }

  #requiredSimulation(): CustomerOpsSimulationResult {
    if (this.#simulation === null) throw new JudgeSessionError('Stage the agent run first');
    return this.#simulation;
  }

  #requirePhase(expected: JudgePhase): void {
    if (this.#phase !== expected) {
      throw new JudgeSessionError(`Expected ${expected}, received ${this.#phase}`);
    }
  }
}

function toEffectView(effect: Effect): EffectView {
  const customerName = customerForResource(effect.resourceKey);
  if (effect.adapterId === 'reference-calendar') {
    const parsed = moveEffectSchema.parse(effect);
    return Object.freeze({
      adapterId: parsed.adapterId,
      after: Object.freeze({ end: parsed.payload.end, start: parsed.payload.start }),
      before: Object.freeze({
        end: parsed.preconditions[0].before.end,
        start: parsed.preconditions[0].before.start,
      }),
      customerName,
      dependencies: parsed.dependencies,
      externalities: parsed.externalities,
      id: parsed.id,
      operation: parsed.operation,
      resourceKey: parsed.resourceKey,
      risk: parsed.risk,
      summary: parsed.presentation.summary,
      system: 'Calendar',
    });
  }
  if (effect.adapterId === 'reference-mail') {
    const parsed = sendMessageEffectSchema.parse(effect);
    return Object.freeze({
      adapterId: parsed.adapterId,
      after: Object.freeze({
        recipients: parsed.payload.recipients,
        subject: parsed.payload.subject,
        textBody: parsed.payload.textBody,
      }),
      before: null,
      customerName,
      dependencies: parsed.dependencies,
      externalities: parsed.externalities,
      id: parsed.id,
      operation: parsed.operation,
      resourceKey: parsed.resourceKey,
      risk: parsed.risk,
      summary: parsed.presentation.summary,
      system: 'Mail',
    });
  }
  const parsed = moveFollowUpEffectSchema.parse(effect);
  return Object.freeze({
    adapterId: parsed.adapterId,
    after: Object.freeze({ followUpAt: parsed.payload.followUpAt }),
    before: Object.freeze({ followUpAt: parsed.preconditions[0].before.followUpAt }),
    customerName,
    dependencies: parsed.dependencies,
    externalities: parsed.externalities,
    id: parsed.id,
    operation: parsed.operation,
    resourceKey: parsed.resourceKey,
    risk: parsed.risk,
    summary: parsed.presentation.summary,
    system: 'CRM',
  });
}

function customerForResource(resourceKey: string): string {
  const meeting = customerMeetings.find(({ customerName }) => (
    resourceKey.toLowerCase().includes(customerName.toLowerCase())
  ));
  return meeting?.customerName ?? 'Unknown';
}
