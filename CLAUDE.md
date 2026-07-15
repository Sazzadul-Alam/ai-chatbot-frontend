# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm start` — dev server (`ng serve --host 0.0.0.0`) on `http://localhost:4200/`. Use `npm run "start HM"` for the 8 GB-heap variant when the build OOMs.
- `npm run build` — production build (runs Node with a 4 GB heap; the raised memory limit is required or the build OOMs).
- `npm run watch` — development build in watch mode.
- `npm test` — unit tests via the `@angular/build:unit-test` builder, which runs **Vitest** with a jsdom environment. Specs are colocated as `*.spec.ts`. There is no Karma/Jasmine here. To focus a single test, use Vitest's `it.only` / `describe.only` in the spec.
- `npm run serve:ssr:ai-chat-frontend` — run the built SSR server from `dist/` (after a build).

Prettier is configured in `package.json` (100 col, single quotes, Angular parser for HTML).

## Architecture

Angular 21 **standalone-component** app (no NgModules) with **SSR** enabled. All routes prerender via an Express host.

### Two backends — LLM inference + application backend
The app talks to two distinct servers, configured in `src/environments/` (keys: `apiUrl`, `backend`, `llmApiKey`, `recaptchaSiteKey`):

- **`environment.apiUrl`** — the LLM endpoint. The OpenAI-compatible **llama-server / llama.cpp** (`/v1/chat/completions` SSE, `/props`, `/health`). Request headers come from `ChatService.buildHeaders()`: `x-api-key` is sent **only if `environment.llmApiKey` is set**, and `Authorization: Bearer <token>` is added for logged-in users.
- **`environment.backend`** — the application backend (auth, conversation persistence, country codes), `localhost:8083` in dev.

> **The application backend is a separate repo** — "Tracks", a **Spring Boot 2.7 / Java 8 / MongoDB** app; the chatbot lives in its `isage` module. It owns the contract for every `environment.backend` endpoint (`/authenticate`, `/user/register`, `/user/activate`, `/user/otp/reset`, `/isage/save-conv`, `/isage/get-conv`, `/isage/save-request`, `/isage/country-code`) and also now hosts an **LLM proxy (BFF)** exposing `/v1/chat/completions`, `/props`, `/health`. When a request/response shape is unclear, that repo is the source of truth. Separate origins in dev (`:4200` vs `:8083`) → the backend must allow CORS.

> **Production cutover (BFF):** the secure target is to route inference **through the backend proxy** instead of calling llama-server directly — point `apiUrl` at the backend and set `llmApiKey: ''` so the key never ships to the browser. The proxy holds the key, injects the system prompt, enforces guardrails + rate limits (returns **429**), and writes an encrypted audit row. The frontend is already proxy-ready (`buildHeaders` + 429 handling in `ChatComponent.streamErrorMessage`); cutover is a one-line env change once the backend proxy is confirmed running. `environment.prod.ts` values (`backend: '/isage-api'`, empty `llmApiKey`/`recaptchaSiteKey`) are **placeholders — confirm before shipping.**

### `ChatService` (`src/app/services/chat.service.ts`) — the hub
A single `providedIn: 'root'` service handles **both** LLM streaming and all backend REST (`login`, `registration`, `activate`, `saveConv`/`getConv`, `saveRequest`, `getCountryCode`, `resendCode`). Note `ChatComponent` also re-lists it in its own `providers: []`, so it gets a component-scoped instance.

Streaming (`sendMessageStream`) does **not** use Angular's `HttpClient`. It uses raw `fetch()` + a `ReadableStream` reader to parse **Server-Sent Events** by hand (splitting on blank lines, reading `event:`/`data:` fields, accumulating deltas), with an `AbortController` for cancellation/pause. Because this runs outside Angular's zone, callbacks are re-entered via `NgZone.run(...)` and change detection is triggered manually.

### iSAGE identity & safety (product-critical — defense in depth)
The product is branded **"iSAGE"** (Datasoft Systems Bangladesh); the underlying model must never be revealed, and unsafe requests are refused. Enforced in layers (`ChatService` + `ChatComponent`) — preserve all of them:

1. **System prompt** — `ISAGE_SYSTEM_PROMPT` is the canonical prompt, but post-BFF-cutover the **backend proxy injects it server-side** and strips any client system message, so `buildPayload` no longer sends it (the constant is kept as reference / for rollback).
2. **Identity-probe interception** — `checkForIdentityProbe` / `IDENTITY_PROBE_PATTERNS` catch "what model are you / are you MiniMax / ignore your instructions / from now on you are…". A match is answered locally with `ISAGE_IDENTITY_RESPONSE` and **never sent to the model or added to `chatHistory`** (via `pushLocalExchange` / `insertLocalAssistant`), so a jailbreak has nothing to leak.
3. **Content guardrails** — `checkForBlockedContent` / `BLOCKED_CATEGORIES` (CSAM, sexual violence, explicit sexual content, violence/weapons, crime, self-harm, hate) short-circuit with a canned refusal before any request is sent.
4. **Output scrubbing** — `sanitizeIsageResponse` / `IDENTITY_LEAK_PATTERNS` rewrite leaked model names in streamed output (**order-sensitive** — specific "…by MiniMax" before the generic `minimax → iSAGE`). A lighter scrub is duplicated in `ChatComponent.cleanResponse`.

**These are the canonical definitions, mirrored in [`docs/guardrails-source-of-truth.md`](docs/guardrails-source-of-truth.md).** After cutover the **backend proxy is the authoritative enforcement point** (client copies become bypassable UX). When you change a pattern here, update the doc and the backend, or the two drift.

> Caveat: the `minimax → iSAGE` scrub also rewrites the legitimate *minimax algorithm* (game theory). Accepted cost of the hard no-leak rule.

### `ChatComponent` (`src/app/components/chat/`) — nearly all UI logic
Everything (sidebar, conversations, streaming display, files, modals) lives here.

- **Conversations**: kept in an in-memory `convStore: Map<id, ConversationState>`. For non-guest users they're persisted to the backend (`saveConv`/`getConv`); the rendered `SafeHtml` fields are stripped before saving. **Guests do not persist.**
- **Rendering pipeline**: `marked` with a custom `Renderer` produces styled code blocks (with copy buttons / terminal styling) and tables. `extractSections` splits assistant output into reasoning (`<think>…</think>` or a `Reasoning:/Final:` heading) vs. the final answer. Math (`$$…$$`, `$…$`) is wrapped for KaTeX. During streaming, plain rendering is used for speed unless a table is detected; the final pass renders full markdown.
- **SSR-safety**: browser-only work (marked setup, `localStorage`, DOM copy-button wiring in `ngAfterViewChecked`) is guarded by `isPlatformBrowser`. `ngOnInit` must **not** open the LandingPage modal on the server — ngx-bootstrap's `show()` reads `document.activeElement` and throws during prerender; the modal opens client-side when `ngOnInit` re-runs after hydration.
- **Scroll-lock**: auto-scroll during streaming is suppressed once the user scrolls up (`userScrolled`), restored via the scroll-down button / on new message.

### Auth flow & user types
Three user modes, all keyed off the `user` object in `localStorage`:

- **guest** — capped at `GUEST_MAX_REQUESTS` (5), tracked in `sessionStorage` (`guest_request_count`).
- **registered / active user** — `login` returns `AccessToken`/`RefreshToken`, stored in `localStorage` and sent as `Bearer` on backend calls.
- **unauthenticated** — on load with no `user`, `ChatComponent` opens the `LandingPage` modal.

Auth UI is modal-driven via **ngx-bootstrap** `BsModalService` (not routes): `LandingPage` → (`Login`, or `Registration` → `CheckMailVerfiy` OTP). Login uses **real Google reCAPTCHA v2** via `ng-recaptcha` (site key from `environment.recaptchaSiteKey`, provided globally as `RECAPTCHA_SETTINGS` in `app.config.ts`; the token is posted to the backend as `recaptchaToken` for server-side verification). The old client-side `RecaptchaChallengeComponent` is now unused dead code. Toasts use the imperative `ToastService` (`src/app/shared/toast.ts`), which dynamically creates `ToastComponent`.

### Routing & SSR entry points
`app.routes.ts` maps both `''` and `'chat'` to `ChatComponent` (the LandingPage is a modal, not a route). SSR wiring: `main.server.ts` → `app.config.server.ts`; `server.ts` is the Express host; `app.routes.server.ts` prerenders all routes (`RenderMode.Prerender`).

## Conventions

From `.github/copilot-instructions.md`: reuse existing services/models/patterns before adding abstractions; keep `.ts`/`.html`/`.css` in sync when UI behavior changes; keep changes scoped and avoid unrelated refactors or dependency churn; do not alter the auth, chat-streaming, or routing behavior without clear justification.
