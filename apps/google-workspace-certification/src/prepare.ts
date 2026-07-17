import { prepareCertification } from './certification.js';
import { loadGateSevenConfig, loadGateSevenSecrets } from './config.js';

const prepared = await prepareCertification(loadGateSevenConfig(), loadGateSevenSecrets());
const effects = prepared.revision.effectGraph?.effects.map((effect) => ({
  externalities: effect.externalities,
  operation: effect.operation,
  payload: effect.payload,
  risk: effect.risk,
  summary: effect.presentation.summary,
})) ?? [];
process.stdout.write(`${JSON.stringify({
  effects,
  expiresAt: prepared.expiresAt,
  graphDigest: prepared.revision.graphDigest,
  next: 'Review every effect, then set PREVIEW_GATE7_APPROVE_GRAPH_DIGEST to this exact graphDigest and run test:gate7:live:execute.',
  providerMutationCount: 0,
}, null, 2)}\n`);
