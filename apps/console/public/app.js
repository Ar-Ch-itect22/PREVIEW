const app = document.querySelector('#app');
const toast = document.querySelector('#toast');
let state;
let busy = false;
let motionAction = null;
let openPanel = null;
let liveConfig = null;
let liveResult = null;
let liveBusy = false;
let liveReviewOpen = false;

const steps = [
  { label: 'Stage shadow run', short: 'Stage' },
  { label: 'Inspect consequences', short: 'Inspect' },
  { label: 'Replay correction', short: 'Replay' },
  { label: 'Bind human approval', short: 'Approve' },
  { label: 'Commit and verify', short: 'Verify' },
];

const phaseIndex = {
  READY: 0,
  REVIEW: 1,
  REPLAYED: 2,
  APPROVED: 3,
  COMMITTED: 5,
  ABORTED: 0,
};

const phaseCopy = {
  READY: {
    eyebrow: 'Pre-commit control plane',
    title: 'Preview consequences, not plans.',
    body: 'The agent can explore an isolated copy of your world. Nothing crosses into reality until you inspect and approve the exact result.',
  },
  REVIEW: {
    eyebrow: 'Revision 01 / consequence review',
    title: 'Six effects. One hidden landmine.',
    body: 'The instruction sounded safe. Its cross-system consequences are now visible before a single provider write.',
  },
  REPLAYED: {
    eyebrow: 'Revision 02 / replay complete',
    title: 'The risky branch is gone.',
    body: 'One human constraint rebuilt the transaction from clean shadow state. Acme disappeared across Calendar, Mail, and CRM together.',
  },
  APPROVED: {
    eyebrow: 'Revision 02 / approval bound',
    title: 'This exact future is sealed.',
    body: 'Approval is content-bound to the effect graph, snapshot, adapter versions, policy, and order shown on screen.',
  },
  COMMITTED: {
    eyebrow: 'Durable receipt / independently verified',
    title: 'Reality matches the approved preview.',
    body: 'Every committed effect was verified. The receipt reports residual and unresolved state without pretending the world is universally undoable.',
  },
  ABORTED: {
    eyebrow: 'Transaction aborted',
    title: 'Nothing crossed the boundary.',
    body: 'The shadow run was discarded. Every synthetic provider remains byte-identical to its starting state.',
  },
};

async function request(path, options = {}) {
  const response = await fetch(path, options);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'Judge Mode request failed');
  return payload;
}

async function act(action) {
  if (busy) return;
  busy = true;
  motionAction = action === 'protect-acme'
    ? 'replay-out'
    : action === 'commit'
      ? 'commit-pending'
      : null;
  document.body.classList.add('loading');
  render();
  try {
    const pendingState = request(`/api/session/${action}`, { method: 'POST' });
    state = action === 'protect-acme'
      ? (await Promise.all([pendingState, wait(600)]))[0]
      : await pendingState;
    motionAction = action === 'protect-acme'
      ? 'replay-in'
      : action === 'commit'
        ? 'commit-in'
        : null;
  } catch (error) {
    motionAction = null;
    showToast(error instanceof Error ? error.message : 'Something went wrong');
  } finally {
    busy = false;
    document.body.classList.remove('loading');
    render();
    window.scrollTo({ top: 0, behavior: 'auto' });
  }
}

function wait(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  window.setTimeout(() => toast.classList.remove('show'), 3200);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function shortDigest(value) {
  if (!value) return 'Not sealed';
  return `${value.slice(0, 12)}...${value.slice(-7)}`;
}

function formatDate(value) {
  return `${new Intl.DateTimeFormat('en', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC',
  }).format(new Date(value))} UTC`;
}

function formatDay(value) {
  return new Intl.DateTimeFormat('en', {
    month: 'short', day: 'numeric', timeZone: 'UTC',
  }).format(new Date(value));
}

function formatMoney(value) {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2).replace(/\.00$/u, '')}M`;
  return `$${Math.round(value / 1_000)}K`;
}

function scenarioFor(customerName) {
  return state.scenarioContext.find((context) => context.customerName === customerName);
}

function humanizeIsoTimestamps(value) {
  return String(value).replace(
    /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z/gu,
    (timestamp) => formatDate(timestamp),
  );
}

function riskLabel(risk) {
  if (risk === 'IRREVERSIBLE') return 'Irreversible';
  if (risk === 'COMPENSABLE') return 'Compensable';
  return 'Reversible';
}

function systemGlyph(system) {
  if (system === 'Calendar') {
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5.5" width="16" height="14" rx="2.5"></rect><path d="M8 3.5v4M16 3.5v4M4 9.5h16M8 13h3M8 16h6"></path></svg>`;
  }
  if (system === 'Mail') {
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5.5" width="17" height="13" rx="2.5"></rect><path d="m5 8 7 5 7-5"></path></svg>`;
  }
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3"></circle><path d="M3.8 18.5c.5-3.2 2.2-5 5.2-5s4.7 1.8 5.2 5M16 7h4M18 5v4M16.5 13.5H21M16.5 17H21"></path></svg>`;
}

function groupEffects(effects) {
  return effects.reduce((groups, effect) => {
    (groups[effect.customerName] ||= []).push(effect);
    return groups;
  }, {});
}

function sortEffects(effects) {
  const rank = { Calendar: 0, Mail: 1, CRM: 2 };
  return [...effects].sort((left, right) => rank[left.system] - rank[right.system]);
}

function renderSteps() {
  const active = phaseIndex[state.phase] ?? 0;
  return steps.map((step, index) => {
    const className = index < active ? 'done' : index === active ? 'active' : '';
    return `<div class="journey-step ${className}">
      <span class="journey-label">${escapeHtml(step.label)}</span>
      <span class="journey-short">${escapeHtml(step.short)}</span>
      <span class="journey-number">0${index + 1}</span>
    </div>`;
  }).join('');
}

function renderShellActions() {
  if (state.phase === 'READY') return '';
  if (state.phase === 'ABORTED' || state.phase === 'COMMITTED') {
    return `<button class="quiet-action" data-action="reset" ${busy ? 'disabled' : ''}>New run</button>`;
  }
  const abort = state.phase === 'APPROVED' ? '' : `<button class="quiet-action danger-text" data-action="abort" ${busy ? 'disabled' : ''}>Abort</button>`;
  return `${abort}<button class="quiet-action" data-action="reset" ${busy ? 'disabled' : ''}>Reset</button>`;
}

function renderRail() {
  const copy = phaseCopy[state.phase];
  const safe = state.providerState.totalMutations === 0;
  const commitMotion = state.phase === 'COMMITTED' && motionAction === 'commit-in';
  const providerWrites = commitMotion
    ? `<strong class="commit-write-counter" aria-label="3"><span class="write-tick write-tick-0" aria-hidden="true">0</span><span class="write-tick write-tick-1" aria-hidden="true">1</span><span class="write-tick write-tick-2" aria-hidden="true">2</span><span class="write-tick write-tick-3" aria-hidden="true">3</span></strong>`
    : `<strong class="${safe ? 'safe' : ''}">${state.providerState.totalMutations}</strong>`;
  const realityLabel = commitMotion
    ? '<p class="commit-label-crossfade" aria-label="Committed after bound approval."><span class="commit-label-old" aria-hidden="true">Reality is untouched.</span><span class="commit-label-new" aria-hidden="true">Committed after bound approval.</span></p>'
    : `<p>${safe ? 'Reality is untouched.' : 'Committed after bound approval.'}</p>`;
  return `<aside class="narrative-rail">
    <div class="rail-grain"></div>
    <header class="rail-brand">
      <span class="brand-symbol"><span></span></span>
      <span class="brand-word">PREVIEW</span>
      <span class="judge-chip">Guided Judge Mode</span>
    </header>
    <section class="rail-story">
      <p class="rail-eyebrow">${copy.eyebrow}</p>
      <h1>${copy.title}</h1>
      <p class="rail-copy">${copy.body}</p>
    </section>
    <section class="instruction-card">
      <div class="instruction-head"><span class="agent-dot">AI</span><span>Agent instruction</span></div>
      <p>${escapeHtml(state.instruction)}</p>
    </section>
    <nav class="journey" aria-label="Transaction stages">
      <p class="journey-title">Transaction path</p>
      ${renderSteps()}
    </nav>
    <footer class="rail-footer">
      <div>${providerWrites}<span>provider writes</span></div>
      ${realityLabel}
    </footer>
  </aside>`;
}

function renderStageBar() {
  const revision = liveReviewOpen
    ? 'Sealed live graph'
    : state.revisionNumber
      ? `Revision 0${state.revisionNumber}`
      : 'No revision';
  const context = liveReviewOpen ? 'Live GPT-5.6 sandbox' : 'Customer operations';
  return `<header class="stage-bar">
    <div class="stage-context">
      <span class="context-dot"></span>
      <span>${context}</span>
      <span class="context-divider"></span>
      <span>${revision}</span>
    </div>
    <div class="stage-actions">
      <button class="quiet-action stage-tool live-trigger" data-panel="live"><i></i><span>Try Live GPT-5.6</span></button>
      <button class="quiet-action stage-tool" data-panel="evidence">What's running?</button>
      <span class="isolation-chip"><i></i> Isolated synthetic state</span>
      ${liveReviewOpen ? '<button class="quiet-action" data-live-exit>Return to guided demo</button>' : renderShellActions()}
    </div>
  </header>`;
}

function renderLiveEffect(effect) {
  const riskClass = effect.risk.toLowerCase();
  const diff = effect.system === 'Calendar'
    ? `<div class="time-diff"><span class="diff-before">${formatDate(effect.before.start)}</span><b>&rarr;</b><span class="diff-after">${formatDate(effect.after.start)}</span></div>`
    : `<div class="mail-diff"><div class="mail-recipient-line"><small>To</small><span class="mail-recipient">${escapeHtml(effect.after.recipients.join(', '))}</span><em class="external-chip">External</em></div><span><small>Message</small>&ldquo;${escapeHtml(humanizeIsoTimestamps(effect.after.textBody))}&rdquo;</span></div>`;
  return `<article class="live-effect">
    <span class="effect-icon">${systemGlyph(effect.system)}</span>
    <div><strong>${escapeHtml(humanizeIsoTimestamps(effect.summary))}</strong><span>${escapeHtml(effect.system)} / ${escapeHtml(effect.operation)}</span></div>
    ${diff}
    <span class="risk-pill risk-${riskClass}"><i></i>${riskLabel(effect.risk)}</span>
  </article>`;
}

function renderLiveSandbox() {
  const available = liveConfig?.available;
  const result = liveResult;
  return `<div class="panel-backdrop" data-panel-backdrop>
    <section class="product-panel live-panel" role="dialog" aria-modal="true" aria-labelledby="live-panel-title" data-panel-stop>
      <header class="panel-head">
        <div><p class="surface-kicker">Live orchestration proof</p><h3 id="live-panel-title">GPT-5.6 inside the staging boundary.</h3></div>
        <button class="panel-close" data-panel="close" aria-label="Close">&times;</button>
      </header>
      <div class="authority-strip"><span><i></i>Stage-only tools</span><span>Calendar + Mail</span><span>0 provider writes</span><span>No approval or commit tools</span></div>
      ${result ? `<div class="live-result">
        <section class="live-result-proof">
          <div><span>Model</span><strong>${escapeHtml(result.model)}</strong></div>
          <div><span>Strict tool calls</span><strong>${result.toolTrace.length}</strong></div>
          <div><span>Sealed effects</span><strong>${result.effectCount}</strong></div>
          <div><span>Provider writes</span><strong class="safe">${result.providerMutationCount}</strong></div>
        </section>
        <section class="live-intent"><small>Your instruction</small><p>${escapeHtml(result.instruction)}</p></section>
        <section class="live-effects">${result.effects.map(renderLiveEffect).join('')}</section>
        <section class="live-trace"><div><small>GPT-5.6 tool trace</small><span>${result.toolTrace.map((entry) => `<code>${escapeHtml(entry.name)}</code>`).join('<b>&rarr;</b>')}</span></div><div><small>Sealed graph</small><code title="${escapeHtml(result.graphDigest)}">${shortDigest(result.graphDigest)}</code></div></section>
        <p class="live-output">${escapeHtml(result.modelOutput || 'The dependent preview is ready for human inspection.')}</p>
        <div class="live-result-actions"><button class="button button-preview" data-live-open-preview>Open in PREVIEW <b>&rarr;</b></button><button class="button button-quiet" data-live-reset>Run another instruction</button></div>
      </div>` : `<form class="live-form" id="live-sandbox-form">
        <label for="live-intent">Instruction to the agent</label>
        <textarea id="live-intent" name="intent" maxlength="1200" ${liveBusy ? 'disabled' : ''}>${escapeHtml(liveConfig?.sampleIntent ?? 'Move event-1 to Jul 27, 10:00 AM–10:30 AM UTC and stage an attendee message as message-1 to attendee@example.test.')}</textarea>
        <div class="sandbox-world"><div><span class="node-icon">${systemGlyph('Calendar')}</span><p><strong>event-1</strong><small>Synthetic planning session · Jul 20, 10:00 AM UTC</small></p></div><div><span class="node-icon">${systemGlyph('Mail')}</span><p><strong>Reference Mail</strong><small>Isolated empty outbox</small></p></div></div>
        ${available === false ? '<p class="panel-warning">The UI is ready, but this server was started without OPENAI_API_KEY. Restart it with the local environment loaded to make the live call.</p>' : ''}
        <button class="button button-preview button-large" type="submit" ${liveBusy || available === false ? 'disabled' : ''}>${liveBusy ? 'GPT-5.6 is staging effects...' : 'Run live shadow simulation'} <b>&rarr;</b></button>
        <p class="form-footnote">The API key stays server-side. GPT receives only four strict read/stage tools; PREVIEW deterministically seals the resulting effect graph.</p>
      </form>`}
    </section>
  </div>`;
}

function renderEvidencePanel() {
  const runtimeRows = [
    ['Judge Mode', 'Real PREVIEW kernel and worker over isolated synthetic Calendar, Mail, and CRM providers.'],
    ['Live Sandbox', 'Real GPT-5.6 Responses API orchestration with four strict stage-only tools.'],
    ['Human boundary', 'Content-bound approval over the exact immutable graph; replay invalidates the prior path.'],
    ['Commit path', 'Deterministic adapters, complete read-set drift check, durable journal, verification, and honest residual reporting.'],
  ];
  return `<div class="panel-backdrop" data-panel-backdrop>
    <section class="product-panel evidence-panel" role="dialog" aria-modal="true" aria-labelledby="evidence-panel-title" data-panel-stop>
      <header class="panel-head"><div><p class="surface-kicker">Implementation evidence</p><h3 id="evidence-panel-title">What is actually running?</h3></div><button class="panel-close" data-panel="close" aria-label="Close">&times;</button></header>
      <div class="evidence-grid">
        <section><p class="panel-section-label">This product surface</p>${runtimeRows.map(([title, body]) => `<article class="evidence-row"><i></i><div><strong>${title}</strong><span>${body}</span></div></article>`).join('')}</section>
        <section class="certification-card"><p class="panel-section-label">Credentialed Google certification</p><h4>COMMITTED_VERIFIED</h4><span>Separate controlled Gate 7 run — not active in Guided Judge Mode.</span><div class="certification-effects"><p><i>&#10003;</i><strong>Google Calendar move</strong><span>Verified · 1 attempt</span></p><p><i>&#10003;</i><strong>Gmail draft</strong><span>Verified · 1 attempt</span></p><p><i>&#10003;</i><strong>Gmail send</strong><span>Verified · 1 attempt</span></p></div><footer><span><strong>0</strong> residuals</span><span><strong>0</strong> unresolved</span></footer></section>
      </div>
      <div class="truth-note"><strong>Honest boundary</strong><span>PREVIEW does not claim universal undo, global atomicity, or exactly-once delivery where a provider does not guarantee it.</span></div>
    </section>
  </div>`;
}

function renderPanel() {
  if (openPanel === 'live') return renderLiveSandbox();
  if (openPanel === 'evidence') return renderEvidencePanel();
  return '';
}

function renderStageIntro() {
  const safe = state.providerState.totalMutations === 0;
  const stageTitle = state.phase === 'READY'
    ? 'A practice world for consequential agents.'
    : state.phase === 'COMMITTED'
      ? 'One approved transaction, verified across every system.'
      : 'One transaction across every connected system.';
  return `<section class="stage-intro">
    <div>
      <p class="section-kicker">Transaction ${escapeHtml(state.transactionId)}</p>
      <h2>${stageTitle}</h2>
    </div>
    <div class="stage-proof">
      <span class="proof-light ${safe ? 'safe' : 'committed'}"></span>
      <div><strong>${safe ? 'Shadow only' : 'Committed'}</strong><span>${safe ? 'No provider mutation endpoint exposed' : 'Approved revision independently verified'}</span></div>
    </div>
  </section>`;
}

function renderEmptyGraph() {
  return `<section class="empty-canvas surface">
    <div class="boundary-visual" aria-hidden="true">
      <span class="boundary-ring ring-one"></span>
      <span class="boundary-ring ring-two"></span>
      <span class="boundary-core"><i></i></span>
      <span class="system-satellite satellite-calendar">${systemGlyph('Calendar')}</span>
      <span class="system-satellite satellite-mail">${systemGlyph('Mail')}</span>
      <span class="system-satellite satellite-crm">${systemGlyph('CRM')}</span>
    </div>
    <p class="empty-kicker">Simulation boundary ready</p>
    <h3>Nothing is real yet.</h3>
    <p class="empty-copy">Stage the agent against isolated Calendar, Mail, and CRM state. You will inspect the exact consequence graph before anything can commit.</p>
    <button class="button button-preview button-large" data-action="stage" ${busy ? 'disabled' : ''}>
      <span>${busy ? 'Building effect graph...' : 'Run shadow simulation'}</span><b>&rarr;</b>
    </button>
    <div class="empty-foot"><span>Real PREVIEW runtime</span><span>Isolated synthetic providers</span><span>0 real writes</span></div>
  </section>`;
}

function renderGraphNode(effect, index) {
  const riskClass = effect.risk.toLowerCase();
  const operation = effect.system === 'Calendar' ? 'Move meeting' : effect.system === 'Mail' ? 'Send message' : 'Move follow-up';
  return `${index > 0 ? '<span class="graph-edge"><i></i></span>' : ''}<article class="effect-node risk-node-${riskClass}" style="--node-order:${index}">
    <div class="node-top"><span class="node-icon">${systemGlyph(effect.system)}</span><span class="node-risk"></span></div>
    <strong>${effect.system}</strong>
    <span>${operation}</span>
  </article>`;
}

function renderGraphLane(customerName, effects) {
  const acme = customerName === 'Acme';
  const sorted = sortEffects(effects);
  const context = scenarioFor(customerName);
  const value = context ? formatMoney(context.renewalValueUsd) : '';
  const deadline = context ? formatDay(context.renewalDeadline) : '';
  return `<section class="graph-lane ${acme ? 'landmine' : ''}">
    <header class="lane-head">
      <div><span class="lane-dot"></span><strong>${escapeHtml(customerName)} renewal</strong></div>
      <span>${escapeHtml(value)} contract &middot; deadline ${escapeHtml(deadline)}</span>
    </header>
    <div class="node-chain">${sorted.map(renderGraphNode).join('')}</div>
  </section>`;
}

function renderRemovedLane() {
  return `<section class="graph-lane removed-lane">
    <header class="lane-head"><div><span class="lane-dot"></span><strong>Acme renewal</strong></div><span>Removed by replay</span></header>
    <div class="node-chain removed-chain">
      ${['Calendar', 'Mail', 'CRM'].map((system, index) => `${index > 0 ? '<span class="graph-edge"><i></i></span>' : ''}<article class="effect-node removed-node" style="--node-order:${index}"><div class="node-top"><span class="node-icon">${systemGlyph(system)}</span></div><strong>${system}</strong><span>Branch removed</span></article>`).join('')}
    </div>
    <span class="constraint-stamp">Protect Acme renewal</span>
  </section>`;
}

function renderGraph() {
  const groups = groupEffects(state.effects);
  const removed = state.replayConstraint ? renderRemovedLane() : '';
  return `<section class="graph-surface surface">
    <header class="surface-header">
      <div><p class="surface-kicker">Causal effect graph</p><h3>Future state, before commit</h3></div>
      <div class="graph-legend"><span><i class="legend-reversible"></i>Reversible</span><span><i class="legend-compensable"></i>Compensable</span><span><i class="legend-irreversible"></i>Irreversible</span></div>
    </header>
    <div class="graph-grid">${removed}${Object.entries(groups).map(([name, effects]) => renderGraphLane(name, effects)).join('')}</div>
  </section>`;
}

function renderDiff(effect) {
  if (effect.system === 'Mail') {
    const recipients = effect.after.recipients.join(', ');
    const external = effect.externalities.includes('DELIVERS_EXTERNAL_MESSAGE');
    return `<div class="mail-diff"><div class="mail-recipient-line"><small>To</small><span class="mail-recipient" title="${escapeHtml(recipients)}">${escapeHtml(recipients)}</span>${external ? '<em class="external-chip">External</em>' : ''}</div><span title="${escapeHtml(effect.after.textBody)}"><small>Message</small>&ldquo;${escapeHtml(effect.after.textBody)}&rdquo;</span></div>`;
  }
  const field = effect.system === 'Calendar' ? 'start' : 'followUpAt';
  return `<div class="time-diff"><span class="diff-before">${formatDate(effect.before[field])}</span><b>&rarr;</b><span class="diff-after">${formatDate(effect.after[field])}</span></div>`;
}

function renderEffect(effect) {
  const riskClass = effect.risk.toLowerCase();
  const displaySummary = humanizeIsoTimestamps(effect.summary);
  return `<div class="effect-row">
    <span class="effect-icon">${systemGlyph(effect.system)}</span>
    <div class="effect-identity"><strong title="${escapeHtml(displaySummary)}">${escapeHtml(displaySummary)}</strong><span>${effect.system} / ${escapeHtml(effect.operation)}</span></div>
    <div class="effect-diff">${renderDiff(effect)}</div>
    <span class="risk-pill risk-${riskClass}"><i></i>${riskLabel(effect.risk)}</span>
  </div>`;
}

function renderGroups() {
  const groups = groupEffects(state.effects);
  return Object.entries(groups).map(([customerName, effects]) => {
    const acme = customerName === 'Acme';
    const context = scenarioFor(customerName);
    const value = context ? formatMoney(context.renewalValueUsd) : '';
    const deadline = context ? formatDay(context.renewalDeadline) : '';
    return `<article class="effect-group ${acme ? 'risky' : ''}">
      <header class="effect-group-head">
        <div><span class="customer-marker"></span><strong>${escapeHtml(customerName)} renewal</strong><span>${effects.length} linked effects</span></div>
        <span class="customer-value">${escapeHtml(value)} contract &middot; deadline ${escapeHtml(deadline)}</span>
      </header>
      <div>${sortEffects(effects).map(renderEffect).join('')}</div>
    </article>`;
  }).join('');
}

function renderAlert() {
  if (state.phase !== 'REVIEW') return '';
  const acmeCalendar = state.effects.find((effect) => effect.customerName === 'Acme' && effect.system === 'Calendar');
  const acme = scenarioFor('Acme');
  const movedTo = acmeCalendar ? formatDate(acmeCalendar.after.start) : 'the following week';
  const deadline = acme ? formatDay(acme.renewalDeadline) : 'the renewal deadline';
  const recipient = acme?.attendeeRecipients[0] ?? 'an external attendee';
  return `<section class="blast-alert facts-only">
    <div class="alert-mark">!</div>
    <div><p>Hidden consequence surfaced</p><h3>Acme moves to ${escapeHtml(movedTo)} — after its ${escapeHtml(deadline)} renewal deadline — and notifies ${escapeHtml(recipient)} externally.</h3><span>Contract value is ${escapeHtml(formatMoney(acme?.renewalValueUsd ?? 0))}. PREVIEW exposes the facts; you decide whether the branch should proceed.</span></div>
  </section>`;
}

function renderReplayBanner() {
  if (!state.replayConstraint) return '';
  return `<section class="replay-banner">
    <span class="replay-symbol">&#10003;</span>
    <div><p>Replayed from clean shadow state</p><strong>Acme's entire causal branch disappeared.</strong></div>
    <span class="effect-reduction"><s>6 effects</s><b>&rarr;</b><strong>3 effects</strong></span>
  </section>`;
}

function renderLedger() {
  return `<section class="ledger surface">
    <header class="surface-header ledger-header">
      <div><p class="surface-kicker">Cross-system consequence diff</p><h3>What will become real</h3></div>
      <div class="ledger-count"><strong>${state.effectCount}</strong><span>sealed effects</span></div>
    </header>
    <div class="effect-groups">${renderGroups()}</div>
  </section>`;
}

function renderNetworkNode({ name, label, position, future = false }) {
  const glyph = future
    ? `<span class="future-monogram">${name === 'Payments' ? '&#8377;' : name.slice(0, 1)}</span>`
    : systemGlyph(name);
  return `<article class="network-node ${future ? 'future-node' : 'verified-node'} ${position}">
    <span class="network-node-icon">${glyph}</span>
    <div><strong>${escapeHtml(name)}</strong><span>${escapeHtml(label)}</span></div>
    ${future ? '<i class="future-orbit"></i>' : '<i class="node-check">&#10003;</i>'}
  </article>`;
}

function renderCommittedFinale() {
  const effects = state.receipt?.effects ?? [];
  const verifiedNodes = [
    { name: 'Calendar', label: 'Verified in this run', position: 'node-calendar' },
    { name: 'Mail', label: 'Verified in this run', position: 'node-mail' },
    { name: 'CRM', label: 'Verified in this run', position: 'node-crm' },
  ];
  const futureNodes = [
    { name: 'Files', label: 'Drive + Dropbox / future', position: 'node-files', future: true },
    { name: 'Payments', label: 'Stripe + Razorpay / future', position: 'node-payments', future: true },
    { name: 'Messaging', label: 'Slack + Teams / future', position: 'node-messaging', future: true },
  ];
  return `<div class="finale-layout">
    <section class="ecosystem surface">
      <header class="finale-header">
        <div><p class="surface-kicker">Verified transaction network</p><h3>The boundary held.</h3></div>
        <span class="finale-status"><i></i>${effects.length}/${effects.length} effects verified</span>
      </header>
      <div class="network-map" aria-label="PREVIEW verified Calendar, Mail, and CRM effects, with Files, Payments, and Messaging shown as future adapter surfaces">
        <div class="network-grid" aria-hidden="true"></div>
        <span class="network-path path-calendar verified-path"><i></i></span>
        <span class="network-path path-mail verified-path"><i></i></span>
        <span class="network-path path-crm verified-path"><i></i></span>
        <span class="network-path path-files future-path"></span>
        <span class="network-path path-payments future-path"></span>
        <span class="network-path path-messaging future-path"></span>
        <div class="preview-core">
          <span class="core-halo"></span>
          <span class="brand-symbol core-symbol"><span></span></span>
          <strong>PREVIEW</strong>
          <small>commit boundary</small>
        </div>
        ${verifiedNodes.map(renderNetworkNode).join('')}
        ${futureNodes.map(renderNetworkNode).join('')}
      </div>
      <footer class="network-legend">
        <span><i class="solid-key"></i>Verified transaction path</span>
        <span><i class="dotted-key"></i>Future adapter surface</span>
        <strong>3 adapters now <b>&rarr;</b> one horizontal runtime</strong>
      </footer>
    </section>
    <aside class="finale-receipt surface">
      <header class="receipt-hero">
        <span class="receipt-seal">&#10003;</span>
        <div><p class="surface-kicker">Durable receipt</p><h3>Committed.<br>Independently verified.</h3></div>
      </header>
      <div class="receipt-score">
        <article><strong>${effects.length}/${effects.length}</strong><span>effects verified</span></article>
        <article><strong>0</strong><span>residuals</span></article>
        <article><strong>0</strong><span>unresolved</span></article>
      </div>
      <div class="finale-effects">${effects.map((effect) => `<article><span class="effect-check">&#10003;</span><div><strong>${escapeHtml(effect.adapterId.replace('reference-', ''))}</strong><p>${escapeHtml(effect.details)}</p></div><b>Verified</b></article>`).join('')}</div>
      <div class="receipt-bindings">
        <p>Approval evidence</p>
        <span><small>Effect graph</small><code title="${escapeHtml(state.graphDigest || '')}">${shortDigest(state.graphDigest)}</code></span>
        <span><small>Human approval</small><code title="${escapeHtml(state.approval?.approvalDigest || '')}">${shortDigest(state.approval?.approvalDigest)}</code></span>
        <span><small>Receipt</small><code>${escapeHtml(state.receipt?.runId || 'Durable run sealed')}</code></span>
      </div>
      <button class="button button-primary full finale-reset" data-action="reset">Run the demo again <b>&rarr;</b></button>
    </aside>
  </div>`;
}

function renderAbortState() {
  return `<section class="empty-canvas surface abort-canvas">
    <div class="abort-symbol"><span></span></div>
    <p class="empty-kicker">Run safely discarded</p>
    <h3>Zero provider writes.</h3>
    <p class="empty-copy">The transaction never crossed its staging boundary. Synthetic Calendar, Mail, and CRM remain byte-identical to base state.</p>
    <button class="button button-primary" data-action="reset">Start a new run</button>
  </section>`;
}

function renderActionBox() {
  if (state.phase === 'REVIEW') {
    return `<div class="decision-box warning-decision"><p>Human decision</p><h4>Choose what crosses the boundary.</h4><span>Acme moves after its deadline. PREVIEW shows the consequence; only you decide.</span><div class="decision-actions"><button class="button button-preview full" data-action="protect-acme" ${busy ? 'disabled' : ''}>${busy ? 'Replaying...' : 'Protect Acme and replay'} <b>&rarr;</b></button><button class="button button-quiet full" data-action="approve" ${busy ? 'disabled' : ''}>Approve exact 6-effect graph</button><button class="decision-abort" data-action="abort" ${busy ? 'disabled' : ''}>Abort transaction &middot; 0 writes</button></div></div>`;
  }
  if (state.phase === 'REPLAYED') {
    return `<div class="decision-box"><p>Approval boundary</p><h4>Revision 02 is ready.</h4><span>Bind your approval to this exact graph, snapshot, policy, adapter set, and effect order.</span><div class="decision-actions"><button class="button button-preview full" data-action="approve" ${busy ? 'disabled' : ''}>Bind approval to Revision 02</button><button class="decision-abort" data-action="abort" ${busy ? 'disabled' : ''}>Abort transaction &middot; 0 writes</button></div></div>`;
  }
  if (state.phase === 'APPROVED') {
    return `<div class="decision-box approved-decision"><p>Human approval bound</p><h4>Ready to cross into reality.</h4><span>The worker revalidates drift before its first mutation, then commits in safe dependency order.</span><button class="button button-primary full" data-action="commit" ${busy ? 'disabled' : ''}>${busy ? 'Committing and verifying...' : 'Commit approved graph'} <b>&rarr;</b></button></div>`;
  }
  if (state.phase === 'COMMITTED') {
    return `<div class="decision-box verified-decision"><p>Receipt sealed</p><h4>Every effect verified.</h4><span>The durable receipt reports zero residual and unresolved outcomes.</span><button class="button button-quiet full" data-action="reset">Run the demo again</button></div>`;
  }
  return '';
}

function renderInspector() {
  const safe = state.providerState.totalMutations === 0;
  const replayMotion = state.phase === 'REPLAYED' && motionAction === 'replay-in';
  const sealedEffects = replayMotion
    ? '<strong class="sealed-roll" aria-label="3"><span class="sealed-roll-old" aria-hidden="true">6</span><span class="sealed-roll-new" aria-hidden="true">3</span></strong>'
    : `<strong>${state.effectCount}</strong>`;
  return `<aside class="inspector surface">
    <section class="inspector-section">
      <div class="inspector-head"><p>Runtime proof</p><span class="runtime-status ${safe ? 'safe' : 'committed'}">${safe ? 'Shadow only' : 'Committed'}</span></div>
      <div class="proof-metrics">
        <article><strong class="${safe ? 'safe' : ''}">${state.providerState.totalMutations}</strong><span>Provider writes</span></article>
        <article>${sealedEffects}<span>Sealed effects</span></article>
        <article><strong>${state.revisionNumber || '--'}</strong><span>Active revision</span></article>
        <article><strong>${state.journal.length}</strong><span>Journal events</span></article>
      </div>
    </section>
    <section class="inspector-section bindings">
      <p class="inspector-label">Cryptographic bindings</p>
      ${state.invalidatedGraphDigest ? `<div class="binding invalid"><span>Invalidated graph</span><code title="${escapeHtml(state.invalidatedGraphDigest)}">${shortDigest(state.invalidatedGraphDigest)}</code></div>` : ''}
      <div class="binding active-binding"><span>Active effect graph</span><code title="${escapeHtml(state.graphDigest || '')}">${shortDigest(state.graphDigest)}</code></div>
      <div class="binding"><span>Base snapshot</span><code title="${escapeHtml(state.snapshotDigest || '')}">${shortDigest(state.snapshotDigest)}</code></div>
      <div class="binding"><span>Human approval</span><code title="${escapeHtml(state.approval?.approvalDigest || '')}">${shortDigest(state.approval?.approvalDigest)}</code></div>
    </section>
    <section class="inspector-section">${renderActionBox()}</section>
  </aside>`;
}

function renderRuntime() {
  if (state.phase === 'READY') return renderEmptyGraph();
  if (state.phase === 'ABORTED') return renderAbortState();
  if (state.phase === 'COMMITTED') return renderCommittedFinale();
  return `<div class="runtime-layout">
    <div class="stage-stack">
      ${renderAlert()}
      ${renderReplayBanner()}
      ${renderGraph()}
      ${renderLedger()}
    </div>
    ${renderInspector()}
  </div>`;
}

function renderLiveReviewRail() {
  return `<aside class="narrative-rail">
    <div class="rail-grain"></div>
    <header class="rail-brand">
      <span class="brand-symbol"><span></span></span>
      <span class="brand-word">PREVIEW</span>
      <span class="judge-chip">Live review</span>
    </header>
    <section class="rail-story">
      <p class="rail-eyebrow">Live GPT-5.6 / consequence review</p>
      <h1>Live effects, inside PREVIEW.</h1>
      <p class="rail-copy">GPT-5.6 proposed the actions. PREVIEW sealed the exact graph and kept every provider untouched.</p>
    </section>
    <section class="instruction-card">
      <div class="instruction-head"><span class="agent-dot">AI</span><span>Live agent instruction</span></div>
      <p>${escapeHtml(liveResult.instruction)}</p>
    </section>
    <nav class="journey" aria-label="Live transaction stages">
      ${[
        ['GPT-5.6 staged effects', 'Stage', 'done'],
        ['PREVIEW sealed graph', 'Seal', 'done'],
        ['Inspect consequences', 'Inspect', 'active'],
        ['Human approval unavailable', 'Approve', ''],
        ['Provider commit unavailable', 'Commit', ''],
      ].map(([label, short, className], index) => `<div class="journey-step ${className}"><span class="journey-label">${label}</span><span class="journey-short">${short}</span><span class="journey-number">0${index + 1}</span></div>`).join('')}
    </nav>
    <footer class="rail-footer">
      <div><strong class="safe">0</strong><span>provider writes</span></div>
      <p>Live graph is staged only.</p>
    </footer>
  </aside>`;
}

function renderLiveReviewIntro() {
  return `<section class="stage-intro">
    <div>
      <p class="section-kicker">Live transaction &middot; sealed revision</p>
      <h2>A live effect graph, inside PREVIEW.</h2>
    </div>
    <div class="stage-proof">
      <span class="proof-light safe"></span>
      <div><strong>Shadow only</strong><span>GPT-5.6 has no approval or commit tools</span></div>
    </div>
  </section>`;
}

function renderLiveReviewRuntime() {
  return `<div class="runtime-layout live-review-layout">
    <div class="stage-stack">
      <section class="live-bridge-banner">
        <span class="replay-symbol">&#10003;</span>
        <div><p>Live graph handed to PREVIEW</p><strong>Generated by GPT-5.6. Deterministically sealed before inspection.</strong></div>
        <span class="live-zero-write">0 provider writes</span>
      </section>
      <section class="ledger surface live-review-ledger">
        <header class="surface-header ledger-header">
          <div><p class="surface-kicker">Cross-system consequence diff</p><h3>What GPT-5.6 proposes</h3></div>
          <div class="ledger-count"><strong>${liveResult.effectCount}</strong><span>sealed effects</span></div>
        </header>
        <section class="live-effects">${liveResult.effects.map(renderLiveEffect).join('')}</section>
      </section>
      <section class="surface live-review-trace">
        <div><p class="surface-kicker">GPT-5.6 tool trace</p><span>${liveResult.toolTrace.map((entry) => `<code>${escapeHtml(entry.name)}</code>`).join('<b>&rarr;</b>')}</span></div>
        <div><p class="surface-kicker">Model output</p><span>${escapeHtml(liveResult.modelOutput || 'The dependent preview is ready for human inspection.')}</span></div>
      </section>
    </div>
    <aside class="inspector surface live-review-inspector">
      <section class="inspector-section">
        <div class="inspector-head"><p>Runtime proof</p><span class="runtime-status safe">Shadow only</span></div>
        <div class="proof-metrics">
          <article><strong class="safe">0</strong><span>Provider writes</span></article>
          <article><strong>${liveResult.effectCount}</strong><span>Sealed effects</span></article>
          <article><strong>${liveResult.toolTrace.length}</strong><span>Strict tool calls</span></article>
          <article><strong>5.6</strong><span>OpenAI model</span></article>
        </div>
      </section>
      <section class="inspector-section bindings">
        <p class="inspector-label">Cryptographic binding</p>
        <div class="binding active-binding"><span>Sealed effect graph</span><code title="${escapeHtml(liveResult.graphDigest)}">${shortDigest(liveResult.graphDigest)}</code></div>
        <div class="binding"><span>Provider state</span><code>Byte-identical</code></div>
        <div class="binding"><span>Human approval</span><code>Not available to model</code></div>
      </section>
      <section class="inspector-section">
        <div class="decision-box"><p>Human boundary</p><h4>Ready for inspection.</h4><span>This live path ends at the staging boundary. It cannot approve or commit.</span><div class="decision-actions"><button class="button button-preview full" data-panel="live">Back to live sandbox</button><button class="button button-quiet full" data-live-exit>Return to guided demo</button></div></div>
      </section>
    </aside>
  </div>`;
}

function render() {
  if (!state) return;
  const motionClass = motionAction ? ` motion-${motionAction}` : '';
  app.innerHTML = `<div class="shell phase-${state.phase.toLowerCase()}${motionClass}">
    <div class="app-frame">
      ${liveReviewOpen && liveResult ? renderLiveReviewRail() : renderRail()}
      <main class="runtime-stage">
        ${renderStageBar()}
        <div class="stage-content">
          ${liveReviewOpen && liveResult ? `${renderLiveReviewIntro()}${renderLiveReviewRuntime()}` : `${renderStageIntro()}${renderRuntime()}`}
        </div>
      </main>
    </div>
    ${renderPanel()}
  </div>`;
}

document.addEventListener('click', (event) => {
  if (event.target.matches('[data-panel-backdrop]')) {
    openPanel = null;
    render();
    return;
  }
  const panelButton = event.target.closest('[data-panel]');
  if (panelButton) {
    const panel = panelButton.dataset.panel;
    openPanel = panel === 'close' ? null : panel;
    if (openPanel === 'live' && liveConfig === null) {
      void request('/api/live-sandbox').then((payload) => { liveConfig = payload; render(); }).catch((error) => showToast(error.message));
    }
    render();
    return;
  }
  if (event.target.closest('[data-live-reset]')) {
    liveResult = null;
    render();
    return;
  }
  if (event.target.closest('[data-live-open-preview]')) {
    liveReviewOpen = true;
    openPanel = null;
    render();
    window.scrollTo({ top: 0, behavior: 'auto' });
    return;
  }
  if (event.target.closest('[data-live-exit]')) {
    liveReviewOpen = false;
    openPanel = null;
    render();
    window.scrollTo({ top: 0, behavior: 'auto' });
    return;
  }
  const button = event.target.closest('[data-action]');
  if (!button) return;
  void act(button.dataset.action);
});

document.addEventListener('submit', (event) => {
  if (event.target.id !== 'live-sandbox-form') return;
  event.preventDefault();
  if (liveBusy) return;
  const form = new FormData(event.target);
  const intent = String(form.get('intent') ?? '');
  liveBusy = true;
  render();
  void request('/api/live-sandbox/run', {
    body: JSON.stringify({ intent }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  }).then((payload) => {
    liveResult = payload;
  }).catch((error) => {
    showToast(error.message);
  }).finally(() => {
    liveBusy = false;
    render();
  });
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && openPanel !== null) {
    openPanel = null;
    render();
  }
});

request('/api/session')
  .then((payload) => { state = payload; render(); window.scrollTo(0, 0); })
  .catch((error) => { showToast(error.message); });
