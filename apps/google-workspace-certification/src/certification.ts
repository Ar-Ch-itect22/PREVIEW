import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';

import { computeEffectGraphDigest, ContentBoundApprovalAuthority } from '@preview/approval';
import {
  computeCanonicalDigest,
  createSnapshotManifest,
  simulationRevisionSchema,
  snapshotManifestSchema,
} from '@preview/domain';
import {
  GmailCommitAdapter,
  GmailProvider,
  GmailSimulationAdapter,
  gmailResourceKey,
} from '@preview/gmail';
import {
  GoogleCalendarCommitAdapter,
  GoogleCalendarProvider,
  GoogleCalendarSimulationAdapter,
  googleCalendarResourceKey,
} from '@preview/google-calendar';
import {
  FetchGoogleApiTransport,
  GoogleRefreshTokenProvider,
} from '@preview/google-common';
import { FileSagaStore } from '@preview/persistence';
import { eraseDurableCommitAdapter, executeDurableSaga } from '@preview/worker';
import { z } from 'zod';

import type { GateSevenConfig, GateSevenSecrets } from './config.js';
import { gateSevenDirectory, preparedArtifactPath, sagaDirectory } from './paths.js';

const approvalContextSchema = z.object({
  adapterVersions: z.record(z.string(), z.string()),
  approverId: z.string().min(1),
  policyVersions: z.record(z.string(), z.string()),
  snapshot: snapshotManifestSchema,
  tenantId: z.string().min(1),
});

const preparedSchema = z.object({
  approvalContext: approvalContextSchema,
  authorizedAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
  revision: simulationRevisionSchema,
  runId: z.string().min(1),
  sessionId: z.string().min(1),
});

export type PreparedGateSevenCertification = z.infer<typeof preparedSchema>;

export async function prepareCertification(
  config: GateSevenConfig,
  secrets: GateSevenSecrets,
  now: Date = new Date(),
): Promise<PreparedGateSevenCertification> {
  if (Date.parse(config.calendarNewEnd) <= Date.parse(config.calendarNewStart)) {
    throw new TypeError('GOOGLE_CALENDAR_NEW_END must be after GOOGLE_CALENDAR_NEW_START');
  }
  const providers = createProviders(secrets);
  const calendarSimulation = new GoogleCalendarSimulationAdapter(providers.calendar);
  const gmailSimulation = new GmailSimulationAdapter(providers.gmail);
  const calendarKey = googleCalendarResourceKey(config.calendarId, config.calendarEventId);
  const calendarBefore = await calendarSimulation.read(calendarKey);
  if (calendarBefore === undefined) throw new TypeError('Certified Google Calendar event was not found');
  const calendar = calendarSimulation.stage(calendarBefore, {
    calendarId: config.calendarId,
    end: config.calendarNewEnd,
    eventId: config.calendarEventId,
    start: config.calendarNewStart,
  }, { dependencies: [], effectId: `${config.sessionId}:calendar` });

  const draftLogicalId = `${config.sessionId}.draft`;
  const sendLogicalId = `${config.sessionId}.send`;
  const draftKey = gmailResourceKey('draft', draftLogicalId);
  const sendKey = gmailResourceKey('message', sendLogicalId);
  if (await gmailSimulation.read(draftKey) !== undefined || await gmailSimulation.read(sendKey) !== undefined) {
    throw new TypeError('Gate 7 Gmail Message-ID already exists; choose a fresh session ID');
  }
  const dependency = [{
    effectId: calendar.effect.id,
    resource: calendar.resource,
    resourceKey: calendar.effect.resourceKey,
  }];
  const body = `PREVIEW Gate 7 certification. Approved Calendar start: ${calendar.resource.start}.`;
  const draft = gmailSimulation.stage(undefined, {
    from: config.gmailFrom,
    logicalId: draftLogicalId,
    operation: 'create-draft-exact',
    recipients: [config.gmailRecipient],
    subject: `PREVIEW Gate 7 draft ${config.sessionId}`,
    textBody: body,
  }, { dependencies: dependency, effectId: `${config.sessionId}:draft` });
  const send = gmailSimulation.stage(undefined, {
    from: config.gmailFrom,
    logicalId: sendLogicalId,
    operation: 'send-message-exact',
    recipients: [config.gmailRecipient],
    subject: `PREVIEW Gate 7 send ${config.sessionId}`,
    textBody: body,
  }, { dependencies: dependency, effectId: `${config.sessionId}:send` });
  const graph = { effects: [calendar.effect, draft.effect, send.effect], version: 1 as const };
  const observedAt = now.toISOString();
  const snapshot = createSnapshotManifest([
    {
      adapterId: 'google-calendar',
      observedAt,
      presence: 'PRESENT',
      resourceKey: calendarKey,
      valueDigest: computeCanonicalDigest(calendarBefore),
      version: calendarBefore.version,
    },
    {
      adapterId: 'gmail',
      observedAt,
      presence: 'ABSENT',
      resourceKey: draftKey,
      valueDigest: null,
      version: null,
    },
    {
      adapterId: 'gmail',
      observedAt,
      presence: 'ABSENT',
      resourceKey: sendKey,
      valueDigest: null,
      version: null,
    },
  ]);
  const revision = simulationRevisionSchema.parse({
    baseSnapshotDigest: snapshot.digest,
    baseSnapshotId: `${config.sessionId}:snapshot`,
    effectGraph: graph,
    graphDigest: computeEffectGraphDigest(graph),
    id: `${config.sessionId}:revision`,
    replayOfRevisionId: null,
    revisionNumber: 1,
    status: 'SEALED',
    structuredConstraints: [],
    transactionId: `${config.sessionId}:transaction`,
  });
  const prepared = preparedSchema.parse({
    approvalContext: {
      adapterVersions: { gmail: '1.0.0', 'google-calendar': '1.0.0' },
      approverId: 'aru',
      policyVersions: { transaction: 'gate-7-live' },
      snapshot,
      tenantId: 'gate7-synthetic',
    },
    authorizedAt: observedAt,
    expiresAt: new Date(now.getTime() + 60 * 60 * 1_000).toISOString(),
    revision,
    runId: `${config.sessionId}:run`,
    sessionId: config.sessionId,
  });
  await writePrepared(prepared);
  return prepared;
}

export async function executeCertification(
  config: GateSevenConfig,
  secrets: GateSevenSecrets,
  approvedGraphDigest: string | undefined,
): Promise<Awaited<ReturnType<typeof executeDurableSaga>>> {
  const prepared = preparedSchema.parse(JSON.parse(await readFile(preparedArtifactPath, 'utf8')) as unknown);
  if (prepared.sessionId !== config.sessionId) throw new TypeError('Prepared artifact session does not match environment');
  if (approvedGraphDigest === undefined || approvedGraphDigest !== prepared.revision.graphDigest) {
    throw new TypeError('PREVIEW_GATE7_APPROVE_GRAPH_DIGEST must exactly match the reviewed sealed graph digest');
  }
  const providers = createProviders(secrets);
  const authority = new ContentBoundApprovalAuthority(secrets.signingKey);
  const approval = authority.approve(prepared.revision, {
    ...prepared.approvalContext,
    expiresAt: prepared.expiresAt,
  });
  return executeDurableSaga({
    adapters: [
      eraseDurableCommitAdapter(new GoogleCalendarCommitAdapter(providers.calendar)),
      eraseDurableCommitAdapter(new GmailCommitAdapter(providers.gmail)),
    ],
    authority,
    now: () => new Date(),
    ownerId: `${config.sessionId}:worker`,
    seed: {
      approval,
      approvalContext: prepared.approvalContext,
      authorizedAt: prepared.authorizedAt,
      createdAt: prepared.authorizedAt,
      revision: prepared.revision,
      runId: prepared.runId,
    },
    store: new FileSagaStore(sagaDirectory),
  });
}

function createProviders(secrets: GateSevenSecrets): {
  readonly calendar: GoogleCalendarProvider;
  readonly gmail: GmailProvider;
} {
  const tokens = new GoogleRefreshTokenProvider({
    clientId: secrets.clientId,
    clientSecret: secrets.clientSecret,
    refreshToken: secrets.refreshToken,
  });
  const transport = new FetchGoogleApiTransport(tokens);
  return { calendar: new GoogleCalendarProvider(transport), gmail: new GmailProvider(transport) };
}

async function writePrepared(prepared: PreparedGateSevenCertification): Promise<void> {
  await mkdir(gateSevenDirectory, { recursive: true });
  const temporary = `${preparedArtifactPath}.${String(process.pid)}.tmp`;
  await writeFile(temporary, `${JSON.stringify(prepared, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  await rename(temporary, preparedArtifactPath);
}
