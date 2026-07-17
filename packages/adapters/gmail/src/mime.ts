import { createHash } from 'node:crypto';

export const GMAIL_MIME_BUILDER_VERSION = 'preview-plain-text-v1';

export interface ExactMailContent {
  readonly from: string;
  readonly logicalId: string;
  readonly recipients: readonly string[];
  readonly subject: string;
  readonly textBody: string;
}

export interface DeterministicMime {
  readonly builderVersion: typeof GMAIL_MIME_BUILDER_VERSION;
  readonly rawBase64Url: string;
  readonly rawDigest: string;
  readonly rfcMessageId: string;
}

export function buildDeterministicMime(content: ExactMailContent): DeterministicMime {
  assertHeaderValue(content.from, 'From');
  assertHeaderValue(content.subject, 'Subject');
  for (const recipient of content.recipients) assertHeaderValue(recipient, 'To');
  const rfcMessageId = rfcMessageIdForLogicalId(content.logicalId);
  const body = wrapBase64(Buffer.from(content.textBody, 'utf8').toString('base64'));
  const raw = [
    `From: ${content.from}`,
    `To: ${content.recipients.join(', ')}`,
    `Subject: ${content.subject}`,
    `Message-ID: ${rfcMessageId}`,
    `X-Preview-Logical-ID: ${content.logicalId}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    body,
    '',
  ].join('\r\n');
  return {
    builderVersion: GMAIL_MIME_BUILDER_VERSION,
    rawBase64Url: Buffer.from(raw, 'utf8').toString('base64url'),
    rawDigest: `sha256:${sha256(raw)}`,
    rfcMessageId,
  };
}

export function rfcMessageIdForLogicalId(logicalId: string): string {
  return `<preview.${sha256(logicalId)}@preview.invalid>`;
}

export function parseControlledMime(rawBase64Url: string): ExactMailContent & { readonly rfcMessageId: string } {
  const raw = Buffer.from(rawBase64Url, 'base64url').toString('utf8');
  const boundary = raw.indexOf('\r\n\r\n');
  if (boundary < 0) throw new TypeError('Gmail raw message has no MIME header boundary');
  const headers = new Map<string, string>();
  const unfoldedHeaders = raw.slice(0, boundary).replace(/\r\n[\t ]+/gu, ' ');
  for (const line of unfoldedHeaders.split('\r\n')) {
    const separator = line.indexOf(':');
    if (separator <= 0) throw new TypeError('Gmail raw message contains a malformed header');
    headers.set(line.slice(0, separator).toLowerCase(), line.slice(separator + 1).trim());
  }
  const transferEncoding = headers.get('content-transfer-encoding')?.toLowerCase();
  if (transferEncoding !== 'base64') throw new TypeError('Gmail message is not certified base64 plain text');
  const contentType = headers.get('content-type')?.toLowerCase();
  if (contentType !== 'text/plain; charset=utf-8') throw new TypeError('Gmail message is not certified UTF-8 text');
  const from = requiredHeader(headers, 'from');
  const logicalId = requiredHeader(headers, 'x-preview-logical-id');
  const recipients = requiredHeader(headers, 'to').split(',').map((value) => value.trim());
  const subject = requiredHeader(headers, 'subject');
  const rfcMessageId = requiredHeader(headers, 'message-id');
  const encodedBody = raw.slice(boundary + 4).replace(/\r\n/gu, '');
  return {
    from,
    logicalId,
    recipients,
    rfcMessageId,
    subject,
    textBody: Buffer.from(encodedBody, 'base64').toString('utf8'),
  };
}

function requiredHeader(headers: ReadonlyMap<string, string>, name: string): string {
  const value = headers.get(name);
  if (value === undefined || value.length === 0) throw new TypeError(`Gmail message is missing ${name}`);
  return value;
}

function assertHeaderValue(value: string, name: string): void {
  if (value.includes('\r') || value.includes('\n')) throw new TypeError(`${name} contains a header injection`);
  if (!/^[\x20-\x7E]+$/u.test(value)) throw new TypeError(`${name} must use certified printable ASCII`);
}

function wrapBase64(value: string): string {
  return value.match(/.{1,76}/gu)?.join('\r\n') ?? '';
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
