# PREVIEW Product Contract

PREVIEW is a transactional runtime for tool-using agents: execute against shadow state, inspect one cross-system consequence diff, replay corrections, then commit and verify the exact approved effects.

Customer operations is the hero proof, not the architecture. Core packages remain neutral about customers, meetings, email, calendars, and CRMs.

## Canonical flow

Agent connects → transaction opens → reads capture observed base state → writes mutate a shadow overlay → later reads see staged writes → effects form a dependency graph → revision seals → user reviews consequences → corrections become replay constraints → replay creates a new revision → user approves that exact digest → live state is revalidated → deterministic commit runs → effects are verified → receipt reports actual committed, compensated, residual, and unresolved state.

## Safety promise

For PREVIEW-certified operations, no provider mutation is issued before a human approves an immutable effect graph. PREVIEW revalidates live state, executes the frozen graph, verifies actual results, and truthfully reports or compensates failures.
