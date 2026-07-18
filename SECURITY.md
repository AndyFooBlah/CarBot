# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in CarBot, please report it responsibly.

**Please do not open a public GitHub issue for security vulnerabilities.**

Preferred: use GitHub's private vulnerability reporting — the **"Report a vulnerability"** button under this repository's **Security** tab. It opens a private channel visible only to the maintainer.

Alternatively, email **andrew.brook@fooblah.org**.

Include as much detail as you can:
- A description of the vulnerability
- Steps to reproduce
- Potential impact
- Any suggested mitigations

We will acknowledge your report within 48 hours and aim to release a fix within 14 days for critical issues.

## Scope

This policy covers the CarBot web client, its Cloud Functions, the Firestore/Storage security rules, and the email-ingestion pipeline in this repository.

Two areas deserve special attention:

- **Secrets**: `GEMINI_API_KEY`, `GOOGLE_MAPS_API_KEY`, and the Gmail OAuth credentials live in Firebase Secret Manager and are never committed or shipped to the client. The browser reaches Gemini exclusively through server-side broker callables (ephemeral tokens / proxied calls). A report of any path that would expose a server-side secret to the client bundle or the repository is in scope and treated as critical.
- **Child safety**: CarBot is a voice product used by children. Any path that lets an unauthorized party inject content into a family's sessions (e.g. defeating the DMARC + registered-sender gates on email ingestion, or writing to another user's context documents) is in scope and treated as high severity regardless of technical sophistication.
