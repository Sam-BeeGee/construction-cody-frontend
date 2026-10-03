# Construction Cody — submittal requirements MVP

Next.js 15.5.27 / React 19.1.9 remain the base. This selectively ports the older `Sam-BeeGee/constructioncody` submittal workflow: source input → server analysis → reviewable requirement cards. It replaces the starter homepage and is also available at `/submittals`.

The old upgrade gate, fake timed Generate action, inactive PDF/save/download controls, product suggestions and fabricated parsing fallback are excluded. This MVP extracts **requirements**, not approved products or completed submittal packages.

## Run locally

```sh
npm ci
cp .env.example .env.local
# Set GOOGLE_API_KEY and GEMINI_MODEL in .env.local
npm run dev
```

Choose a currently available Gemini model supporting `generateContent` structured output with `generationConfig.responseFormat.text.schema`. No model is silently chosen or substituted. Secrets are server-side only; never use `NEXT_PUBLIC_` for the key.

Paste one spec excerpt (maximum 20,000 characters), give it a meaningful source/section/revision name, or import a UTF-8 `.txt` file. PDF extraction/OCR is intentionally deferred; paste the relevant extracted PDF text. The excerpt is sent to Google Gemini. The application has no database, source logging, draft persistence or browser storage; browser state is lost on refresh. Provider data handling is separate from application storage.

## Trust boundary

- One strict Zod schema defines model requirements and produces the provider JSON Schema. Responses are parsed as JSON and validated at runtime; markdown repair and demo fallback are not allowed.
- Every requirement consists of full source lines copied verbatim plus a tentative AI document-type classification. No generated product, manufacturer, model or compliance assertions exist in the output schema.
- The server checks quote text and both line endpoints against the original excerpt (only CRLF/CR line endings are normalized). Invalid evidence, extra fields, duplicate evidence or any invalid item rejects the entire result.
- Source-line verification proves where a quote came from, **not** that the model interpreted it correctly or found every requirement. Human review must check conditional language, section context, referenced documents, drawings and addenda. Classification is also unverified.
- All returned items remain `needs_review`. No automatic approval status exists. Empty results mean no explicit requirements were identified in that excerpt, not that the project needs no submittals or is compliant.
- Source links show the immutable analyzed text and excerpt line numbers, not guessed PDF pages. JSON export includes the full analyzed text, source name, SHA-256, model, timestamp, quotes, citations and limitations. Download is a real local file operation, not package generation.
- HTTP errors explicitly cover invalid requests, missing configuration, provider rejection/rate limit/network failure, block, timeout, incomplete generation, invalid output and unverifiable evidence. No raw provider diagnostics or secrets are sent to the client.
- Input is bounded at 100,000 actual request bytes and 20,000 spec characters; provider calls have a 30-second deadline. Responses are not cached.

This is a private evaluation slice. The analysis endpoint has no application authentication, rate limiting or database. Keep the deployment behind hosting access protection while evaluating; add user authentication and shared quota enforcement before public access with a billable key. This PR does not change hosting configuration or secrets.

## Validation

```sh
npm test
npm run typecheck
npm run lint
npm run build
```

Tests use a mocked provider; they exercise schema/evidence rejection, negation-preserving quotes, real route response codes, empty output, truncation, malformed JSON, configuration and provider failures. They do not establish model accuracy on real project specifications. A live smoke test with the deployment's configured key/model is still needed.

## Files

| File | Responsibility |
| --- | --- |
| `src/app/page.tsx` | Replace starter with requirements workspace |
| `src/app/submittals/page.tsx` | Same workspace at the original workflow URL |
| `src/components/submittal-workspace.tsx` | Text import, request/error states, source review and JSON download |
| `src/app/api/submittals/analyze/route.ts` | Bounded request validation, server configuration and HTTP failures |
| `src/lib/submittals/schema.ts` | Strict request, model output and response contracts |
| `src/lib/submittals/analyze.ts` | Structured Gemini call and deterministic evidence validation |
| `src/app/globals.css`, `src/app/layout.tsx` | Workspace styling and site metadata |
| `package.json`, `package-lock.json` | Zod, test runner and validation commands |
| `.env.example`, `.gitignore` | Document required configuration without committing secrets |
| `tests/submittals.test.ts` | Trust-boundary and route regression tests |
| `.github/workflows/checks.yml` | PR lint/typecheck/test/build checks |
| `README.md` | Scope, setup, trust limits and next deployment check |

Next slice: validate extraction on a small authorized set of real specs; then add PDF extraction with page provenance. Product selection requires separate supplier/manufacturer evidence and a reviewer-controlled compliance matrix.

Provider format reference: https://ai.google.dev/gemini-api/docs/generate-content/structured-output
Zod JSON Schema reference: https://zod.dev/json-schema
