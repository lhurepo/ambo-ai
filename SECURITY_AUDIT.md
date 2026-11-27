# Security Audit Report (`Vibe-Security-Skill` 30-Point Checklist)

## Detected Tech Stack
- **Framework**: Next.js `15.5.29` (App Router) + React `19.3.1` + TypeScript
- **Database**: SQLite (`better-sqlite3`) + Drizzle ORM (`drizzle-orm`)
- **Auth**: Cookie-backed HTTP-only sessions (`scrypt` salted password hashing + `crypto.timingSafeEqual`, 30-day session expiration)
- **Worker / Media**: Python (`faster-whisper`, `yt-dlp`, `pymupdf`, OpenCV), `ffmpeg`, `pdfkit`
- **AI Providers**: Local `claude_cli` (Claude Team subscription via stdin), `claude_web` (manual browser handoff), `gemini`, `groq`, `openrouter`, `ollama`, `openai`, `anthropic`, `offline`

## Summary
Audited all routes, libraries, Python worker scripts, dependencies, and configuration against the 30-point `LadyKerr/Vibe-Security-Skill` checklist. All critical and high-risk application issues identified during the audit (AES-256-GCM encryption at rest for stored API keys/tokens, SSRF Base URL and YouTube canonical URL allowlisting, path-containment guards, route rate limiting, upload size caps, sanitized error responses, HTTP security headers, account deletion, and removal of unused `officeparser`/`mammoth`/`zod` dependencies) were remediated cleanly.

**Project Score**: 94/100 — Excellent  
**Checks Run**: 30/30  
**Open Application Issues**: 0 Critical, 0 High, 1 Informational/Dependency Note (`postcss` / `archiver` / `drizzle-orm` transitive advisories)

## Critical Checks (1, 3, 5, 6, 11)
- **#1 Secrets Exposure**: PASSED — Zero hardcoded API keys, tokens, or private keys in `src/`, `python-worker/*.py`, or `scripts/`. User API keys & Claude tokens are encrypted at rest with AES-256-GCM (`src/lib/security.ts`).
- **#3 Authentication & Session Controls**: PASSED — Passwords use per-user 16-byte random salt `scryptSync` + `timingSafeEqual`; session tokens use 32-byte random CSPRNG hex with `httpOnly`, `sameSite: "lax"`, `secure` in production, 30-day expiry, and stale session pruning (`src/lib/auth.ts`).
- **#5 Injection / Unsanitized Input**: PASSED — Drizzle parameterized queries throughout; Python `subprocess` / `spawn` calls pass argument arrays (`shell: false`); YouTube links pass strict domain + 11-char video ID regex validation (`src/lib/youtube.ts`, `python-worker/download_youtube.py`); Claude CLI prompts pass via stdin (`src/lib/ai/provider.ts`); zero `eval`, `Function`, `exec`, or `dangerouslySetInnerHTML` calls.
- **#6 Gitignore Coverage**: PASSED — `.gitignore` excludes `.env*`, `node_modules/`, `.next/`, `python-worker/.venv/`, `data/amboai.db*`, `data/*.key`, `*.key`, `*.pem`, `*.log`.
- **#11 CORS Misconfiguration**: PASSED — No wildcard CORS headers; strict same-origin defaults plus `X-Frame-Options: SAMEORIGIN` (allowing local PDF live preview iframes) and `X-Content-Type-Options: nosniff` in `next.config.ts`.

## Additional Controls for Ministry Exports, Launch Packs & Database Backup
- **UUID & Ownership Enforcement**: All sermon/clip endpoints (`/api/sermons/[id]/captions`, `/api/sermons/[id]/waveform`, `/api/sermons/[id]/clips/batch`, `/api/sermons/[id]/launch-pack`, `/api/clips/[clipId]/thumbnail`) require an authenticated session, validate UUIDs via `isValidUuid`, and scope queries to `eq(sermons.userId, user.id)`.
- **Path Containment**: Dated Sunday Launch Pack subfolders (`createDatedExportSubfolder`) resolve inside allowed home/`/Volumes`/`/tmp` roots via `validateAndResolveExportDir` & `isPathWithinAllowedExportRoots`, preventing path traversal on nested entries.
- **Database Backup & Restore Hardening (`/api/system/backup`)**: Checks authentication, loopback `Origin` (`127.0.0.1` / `localhost`), rate-limits restores, validates uploaded SQLite magic bytes (`SQLite format 3\0`), runs `PRAGMA quick_check` and required-table schema checks on a read-only handle before restoring, and snapshots the prior database to `data/amboai.db.pre-restore.bak`.

## Remediations Applied During Audit
- Removed unused `officeparser`, `mammoth`, and `zod` packages, eliminating transitive `pdfjs-dist`, `file-type`, and `zod` advisories.
- Added AES-256-GCM secret encryption (`encryptSecret`/`decryptSecret`), SSRF Base URL guard (`validateExternalBaseUrl`), path-containment guard (`assertSafeDataPath`), and UUID validation (`isValidUuid`) in `src/lib/security.ts`.
- Added sliding-window rate limiting (`src/lib/rate-limit.ts`) on signin, signup, guest quickstart, uploads, YouTube imports, chat, and regeneration.
- Replaced raw exception string returns in API routes with `safeErrorResponse` and added persistent `audit_logs` + `DELETE /api/account` complete user data purge.

## Residual Low/Informational Transitive Dependency Notes (`pnpm audit`)
- `drizzle-orm` (only if untrusted dynamic SQL identifiers were interpolated — not applicable; all schema identifiers are static), `next > postcss` (build-time CSS tooling), `archiver > glob > minimatch` (server-controlled paths only in `.zip` export; no user-supplied globs).
