import { z } from 'zod';

const nonSecretSchema = z.object({
  calendarId: z.string().min(1),
  calendarEventId: z.string().min(1),
  calendarNewEnd: z.string().datetime({ offset: true }),
  calendarNewStart: z.string().datetime({ offset: true }),
  gmailFrom: z.string().email(),
  gmailRecipient: z.string().email(),
  sessionId: z.string().min(1).max(120).regex(/^[a-zA-Z0-9._-]+$/u),
});

const secretSchema = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  refreshToken: z.string().min(1),
  signingKey: z.string().min(16),
});

export type GateSevenConfig = z.infer<typeof nonSecretSchema>;
export type GateSevenSecrets = z.infer<typeof secretSchema>;

export function loadGateSevenConfig(environment: NodeJS.ProcessEnv = process.env): GateSevenConfig {
  return nonSecretSchema.parse({
    calendarEventId: environment.GOOGLE_CALENDAR_EVENT_ID,
    calendarId: environment.GOOGLE_CALENDAR_ID,
    calendarNewEnd: environment.GOOGLE_CALENDAR_NEW_END,
    calendarNewStart: environment.GOOGLE_CALENDAR_NEW_START,
    gmailFrom: environment.GOOGLE_GMAIL_FROM,
    gmailRecipient: environment.GOOGLE_GMAIL_TEST_RECIPIENT,
    sessionId: environment.PREVIEW_GATE7_SESSION_ID,
  });
}

export function loadGateSevenSecrets(environment: NodeJS.ProcessEnv = process.env): GateSevenSecrets {
  return secretSchema.parse({
    clientId: environment.GOOGLE_CLIENT_ID,
    clientSecret: environment.GOOGLE_CLIENT_SECRET,
    refreshToken: environment.GOOGLE_REFRESH_TOKEN,
    signingKey: environment.PREVIEW_APPROVAL_SIGNING_KEY,
  });
}
