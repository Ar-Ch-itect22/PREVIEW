import { describe, expect, it } from 'vitest';

import { RevisionDraft, SealedRevisionMutationError } from '../src/index.js';
import { digest, makeEffect, makeRevision } from './fixtures.js';

describe('revision sealing', () => {
  it('seals an exact immutable effect graph', () => {
    const draft = new RevisionDraft(makeRevision());
    draft.appendEffect(makeEffect());

    const sealed = draft.seal(digest, digest);

    expect(sealed.status).toBe('SEALED');
    expect(sealed.baseSnapshotDigest).toBe(digest);
    expect(sealed.graphDigest).toBe(digest);
    expect(sealed.effectGraph?.effects).toEqual([makeEffect()]);
    expect(Object.isFrozen(sealed)).toBe(true);
    expect(Object.isFrozen(sealed.effectGraph?.effects[0]?.payload)).toBe(true);
  });

  it('rejects all mutation after sealing', () => {
    const draft = new RevisionDraft(makeRevision());
    draft.seal(digest, digest);

    expect(() => draft.appendEffect(makeEffect())).toThrow(SealedRevisionMutationError);
    expect(() =>
      draft.addConstraint({ kind: 'DENY_MUTATION', resourceKey: 'resource-1' }),
    ).toThrow(SealedRevisionMutationError);
    expect(() => draft.seal(digest, digest)).toThrow(SealedRevisionMutationError);
  });

  it('does not alias caller-owned effect data', () => {
    const effect = makeEffect();
    const draft = new RevisionDraft(makeRevision());
    draft.appendEffect(effect);
    (effect.payload as { value: string }).value = 'tampered';

    expect(draft.seal(digest, digest).effectGraph?.effects[0]?.payload).toEqual({ value: 'after' });
  });
});
