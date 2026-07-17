# Google Calendar adapter

Certified Gate 7 operation: move one timed, non-recurring event without attendee notifications. Commit and compensation use provider etags through `If-Match`; reconciliation uses PREVIEW-owned private extended properties. Required OAuth scope: `https://www.googleapis.com/auth/calendar.events` (or the narrower owned-events scope when the configured fixture calendar is owned by the test user).

All-day events, recurring series/instances, attendee changes, conference changes, creates, deletes, and unknown operations fail closed.
