# Gmail certified adapter

Gate 7 certifies two independent exact operations: create a plain-text draft and send a
plain-text message. The approved effect binds deterministic MIME bytes generated during
simulation. Draft creation is compensable with mailbox-history residuals. Sending is
irreversible. Empty search results after an ambiguous mutation remain `UNKNOWN` and are
never treated as permission to retry.

Required OAuth scopes are `gmail.compose` and `gmail.readonly`. The current certification
excludes HTML, attachments, Cc/Bcc, arbitrary headers, signatures, threading, and aliases.
