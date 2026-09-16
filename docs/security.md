# Security and data handling

Community archives are private by nature: they contain who said what, when, and
about whom. These are the controls in place and, just as importantly, the ones
that are not.

## Authentication

- Passwords hashed with bcrypt (cost 12). Sign-in always runs a comparison, even
  for an unknown email, so timing does not reveal whether an account exists, and
  the error message does not either.
- Short-lived JWT access tokens (15 minutes by default).
- **Rotating refresh tokens**, stored as SHA-256 hashes. Presenting a token that
  has already been consumed revokes every session for that user — the standard
  detection for a stolen token being replayed.
- The first account created becomes the administrator; every later sign-up is a
  regular member.
- The user row is re-read on every request, so a deleted or demoted account
  loses access immediately rather than at token expiry.

## Authorisation

- The JWT guard is applied **globally**. A route is public only by opting in
  with `@Public()`, so a newly added endpoint cannot accidentally expose
  community knowledge.
- `@Roles('ADMIN')` guards every administrative action, enforced server-side
  regardless of what the UI renders.
- Conversations are checked for ownership on every read and delete; one member
  cannot read another's, and the end-to-end suite asserts it.

## Input validation

- Every body, query and route parameter is validated by a DTO before reaching a
  service. Unknown fields are rejected rather than ignored, so a request cannot
  smuggle a property past a whitelist.
- UUID parameters are parsed and rejected if malformed.
- Validation failures return field-level detail so the UI can point at the field
  without guessing.

## File uploads

- Size limit enforced by the upload middleware *and* re-checked in the service.
- Extension and MIME type both checked; either may be wrong on its own, so one
  must match and neither may contradict.
- **Magic bytes** verified for PDF and the ZIP family (DOCX). A `.pdf` that does
  not begin `%PDF-` is rejected.
- Text uploads must decode as UTF-8 and must not contain NUL bytes.
- Storage keys are **generated server-side** from a UUID plus a sanitised slug
  and extension. The client's filename never becomes a path, so it cannot
  traverse one. The local driver additionally refuses any resolved path outside
  its root.
- Uploaded files are never executed, and never served from a static directory.

## SQL

- Every pgvector and full-text query is parameterised, including the embedding
  itself (`$n::vector`).
- Table names in raw SQL come from a fixed whitelist in code; no identifier ever
  originates from user input.
- Free-form search text goes through `websearch_to_tsquery`, which is designed
  to accept untrusted input.

## Object storage

- Nothing is served from a permanent URL. Downloads use time-limited signed
  URLs: S3 presigned URLs in production, and for the local driver an HMAC that
  covers **both the key and the expiry**, so editing the query string cannot
  extend access.
- Bucket objects are private; no ACL makes them public.

## Transport and headers

- CORS restricted to a configured origin list.
- `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`,
  `Cross-Origin-Resource-Policy` and `Permissions-Policy` on every response;
  HSTS in production.
- `trust proxy` is enabled so rate limiting sees the real client IP behind a
  reverse proxy.

## Rate limiting

Global limits plus tighter ones where abuse is expensive: authentication (10 per
minute), chat (20 per minute, since each request costs an embedding and a model
call), and uploads. All configurable.

## Secrets

- No provider credential, database URL or signing secret is ever bundled into
  the browser. Only `NEXT_PUBLIC_*` values reach the client, and both of them
  are public.
- The environment schema **refuses to start in production** with the example JWT
  secrets.
- `.env` is gitignored, and `.env.example` contains no real value.

## Logging and privacy

- Structured JSON logs with a request id on every line, propagated to the
  response as `X-Request-Id`.
- Anything whose key looks like a credential — password, secret, token, api key,
  authorization, cookie, jwt — is redacted at any depth.
- **Community message bodies are never logged.** Question text is stored,
  because an administrator has to read a question to answer it, but no other
  content is copied into logs.
- Internal failures return a generic message to the client; the detail goes to
  the log with the request id, so support can correlate the two without leaking
  internals.

## Demo isolation

Demo rows are flagged, and retrieval either sees only demo content or only real
content — never both. Seeding a database that already holds real content cannot
contaminate answers, and the seed never overwrites the password of an existing
non-demo account that shares an email.

## Known limitations

Stated plainly, because a security section that lists only strengths is not
useful:

- **Tokens are held in `localStorage`.** They are the user's own credentials,
  not an application secret, but a successful XSS could read them. The hardening
  step is httpOnly cookies with CSRF protection, which needs the API and the web
  app to share a site.
- **Knowledge has no per-source access control yet.** Any authenticated member
  can retrieve anything indexed. `Source` already carries the metadata this
  needs — this is the first item on the roadmap, and it is why private pod
  channels should not be imported until it lands.
- **No audit log** of who read what.
- **No virus scanning** of uploads. Files are validated and never executed, but
  a malicious document passed on to another user would not be caught.
- **The offline provider's embeddings are lexical.** They do not leak anything,
  but they are not a privacy feature either: with `AI_PROVIDER=openai`, content
  is sent to that provider. Choose the provider your community's data policy
  allows, and note that `OPENAI_BASE_URL` can point at self-hosted inference.
