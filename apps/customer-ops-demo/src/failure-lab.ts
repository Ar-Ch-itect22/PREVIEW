import { ContentBoundApprovalAuthority } from '@preview/approval';
import type { Receipt } from '@preview/domain';
import { InMemorySagaStore, type SagaRunSeed, type SagaStore } from '@preview/persistence';
import { ReferenceCalendarCommitAdapter } from '@preview/reference-calendar';
import { ReferenceCrmCommitAdapter } from '@preview/reference-crm';
import {
  ReferenceMailCommitAdapter,
  type MailCommitFault,
} from '@preview/reference-mail';
import {
  eraseDurableCommitAdapter,
  executeDurableSaga,
  type ErasedDurableCommitAdapter,
  type SagaCheckpoint,
} from '@preview/worker';

import {
  createHeroDraft,
  createHeroProviders,
  customerMeetings,
  type HeroProviders,
} from './fixtures.js';
import { runCustomerOpsSimulation } from './hero-replay.js';

const AUTHORIZED_AT = '2026-07-17T00:00:00.000Z';
const ADAPTER_VERSIONS = Object.freeze({
  'reference-calendar': '1.0.0',
  'reference-crm': '1.0.0',
  'reference-mail': '1.0.0',
});

export interface FailureLabOptions {
  readonly crmFailsBeforeWrite?: boolean;
  readonly mailFault?: Exclude<MailCommitFault, 'NONE'>;
  readonly runId?: string;
  readonly store?: SagaStore;
}

export interface PreparedFailureLab {
  readonly authority: ContentBoundApprovalAuthority;
  readonly providers: HeroProviders;
  readonly seed: Readonly<SagaRunSeed>;
  readonly store: SagaStore;
  createAdapters(): readonly ErasedDurableCommitAdapter[];
  execute(input?: FailureLabExecutionInput): Promise<Readonly<Receipt>>;
}

export interface FailureLabExecutionInput {
  readonly checkpoint?: SagaCheckpoint;
  readonly now?: () => Date;
  readonly ownerId?: string;
}

export async function prepareFailureLab(
  options: FailureLabOptions = {},
): Promise<PreparedFailureLab> {
  const providers = createHeroProviders();
  const meeting = customerMeetings[0];
  if (meeting === undefined) throw new Error('Failure Lab requires the Acme fixture');
  const simulation = await runCustomerOpsSimulation(
    createHeroDraft('failure-lab-revision-1'),
    providers,
    [meeting],
  );
  const authority = new ContentBoundApprovalAuthority('gate-six-signing-key');
  const approvalContext = Object.freeze({
    adapterVersions: ADAPTER_VERSIONS,
    approverId: 'aru',
    policyVersions: { transaction: 'gate-6' },
    snapshot: simulation.snapshot,
    tenantId: 'tenant-1',
  });
  const approval = authority.approve(simulation.revision, {
    ...approvalContext,
    expiresAt: '2026-07-20T00:00:00.000Z',
  });
  const seed = Object.freeze({
    approval,
    approvalContext,
    authorizedAt: AUTHORIZED_AT,
    createdAt: AUTHORIZED_AT,
    revision: simulation.revision,
    runId: options.runId ?? 'failure-lab-run-1',
  });
  const store = options.store ?? new InMemorySagaStore();
  if (options.crmFailsBeforeWrite === true) providers.crm.failAllCommitsBeforeWrite();
  if (options.mailFault !== undefined) providers.mail.injectNextCommitFault(options.mailFault);

  const createAdapters = (): readonly ErasedDurableCommitAdapter[] => Object.freeze([
    eraseDurableCommitAdapter(
      new ReferenceCalendarCommitAdapter(providers.calendar.createCommitPort()),
    ),
    eraseDurableCommitAdapter(new ReferenceCrmCommitAdapter(providers.crm.createCommitPort())),
    eraseDurableCommitAdapter(new ReferenceMailCommitAdapter(providers.mail.createCommitPort())),
  ]);

  return Object.freeze({
    authority,
    createAdapters,
    execute: async (input: FailureLabExecutionInput = {}) => executeDurableSaga({
      adapters: createAdapters(),
      authority,
      ...(input.checkpoint === undefined ? {} : { checkpoint: input.checkpoint }),
      now: input.now ?? (() => new Date(AUTHORIZED_AT)),
      ownerId: input.ownerId ?? 'failure-lab-worker-1',
      seed,
      store,
    }),
    providers,
    seed,
    store,
  });
}
