import { executeCertification } from './certification.js';
import { loadGateSevenConfig, loadGateSevenSecrets } from './config.js';

const receipt = await executeCertification(
  loadGateSevenConfig(),
  loadGateSevenSecrets(),
  process.env.PREVIEW_GATE7_APPROVE_GRAPH_DIGEST,
);
process.stdout.write(`${JSON.stringify({
  effects: receipt.effects.map(({ adapterId, attemptCount, compensationAttemptCount, status }) => ({
    adapterId,
    attemptCount,
    compensationAttemptCount,
    status,
  })),
  knownResidualCount: receipt.knownResidualCount,
  runId: receipt.runId,
  terminalStatus: receipt.terminalStatus,
  unresolvedCount: receipt.unresolvedCount,
}, null, 2)}\n`);
