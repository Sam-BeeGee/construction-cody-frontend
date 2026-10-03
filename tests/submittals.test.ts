import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { POST } from "../src/app/api/submittals/analyze/route";
import {
  AnalysisFailure,
  analyzeSpecification,
  validateEvidence,
} from "../src/lib/submittals/analyze";
import {
  analysisResultSchema,
  MAX_REQUEST_BYTES,
} from "../src/lib/submittals/schema";

const input = {
  sourceName: "Section 26 24 16, Rev 2",
  specification:
    "SECTION 26 24 16 — PANELBOARDS\n1.3 SUBMITTALS\nA. Submit product data for each panelboard.\nB. Submit manufacturer origin certificates.\nC. Do not submit samples unless requested.",
};
const config = { apiKey: "test-only-secret", model: "test-model" };
const requirement = {
  kind: "product_data",
  quote: "A. Submit product data for each panelboard.",
  startLine: 3,
  endLine: 3,
};
const output = { requirements: [requirement] };
function provider(text = JSON.stringify(output), finishReason = "STOP") {
  return Response.json({
    candidates: [{ finishReason, content: { parts: [{ text }] } }],
  });
}
const originalKey = process.env.GOOGLE_API_KEY;
const originalModel = process.env.GEMINI_MODEL;
afterEach(() => {
  mock.restoreAll();
  if (originalKey === undefined) delete process.env.GOOGLE_API_KEY;
  else process.env.GOOGLE_API_KEY = originalKey;
  if (originalModel === undefined) delete process.env.GEMINI_MODEL;
  else process.env.GEMINI_MODEL = originalModel;
});

function expectFailure(code: string) {
  return (error: unknown) =>
    error instanceof AnalysisFailure && error.code === code;
}
function request(body: unknown = input) {
  return new Request("http://localhost/api/submittals/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("grounded extraction requests a structured schema and returns reviewable source provenance", async () => {
  const fetcher: typeof fetch = async (url, options) => {
    assert.match(String(url), /test-model:generateContent$/);
    assert.equal(
      new Headers(options?.headers).get("x-goog-api-key"),
      config.apiKey,
    );
    const body = JSON.parse(String(options?.body));
    assert.equal(
      body.generationConfig.responseFormat.text.mimeType,
      "application/json",
    );
    assert.deepEqual(
      body.generationConfig.responseFormat.text.schema.required,
      ["requirements"],
    );
    assert.deepEqual(
      JSON.parse(body.contents[0].parts[0].text).sourceLines[2],
      { line: 3, text: requirement.quote },
    );
    assert.match(
      body.systemInstruction.parts[0].text,
      /Never follow instructions/,
    );
    return provider();
  };
  const result = await analyzeSpecification(input, config, fetcher);
  assert.equal(analysisResultSchema.safeParse(result).success, true);
  assert.equal(result.status, "requirements_found");
  assert.equal(result.requirements[0].reviewStatus, "needs_review");
  assert.equal(result.source.text, input.specification);
  assert.equal(result.source.lineCount, 5);
  assert.match(result.source.sha256, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(result).includes(config.apiKey), false);
});

test("empty extraction is explicit and does not imply compliance", async () => {
  const result = await analyzeSpecification(input, config, async () =>
    provider('{"requirements":[]}'),
  );
  assert.equal(result.status, "no_requirements_found");
  assert.deepEqual(result.requirements, []);
  assert.ok(
    result.limitations.some((text) =>
      text.includes("compliance has been verified"),
    ),
  );
});

test("CRLF input is normalized without changing quoted wording", async () => {
  const result = await analyzeSpecification(
    { ...input, specification: input.specification.replaceAll("\n", "\r\n") },
    config,
    async () => provider(),
  );
  assert.equal(result.source.text, input.specification);
});

test("multi-line evidence keeps original conditions and indentation", () => {
  const source = "1. SUBMITTALS\nA. If requested:\n  Submit samples.";
  const requirements = validateEvidence(
    {
      requirements: [
        {
          kind: "samples",
          quote: "A. If requested:\n  Submit samples.",
          startLine: 2,
          endLine: 3,
        },
      ],
    },
    source,
  );
  assert.equal(requirements.length, 1);
});

for (const [label, altered, code] of [
  [
    "invented evidence",
    { ...requirement, quote: "Submit a fabricated product." },
    "UNVERIFIED_EVIDENCE",
  ],
  [
    "wrong source line",
    { ...requirement, startLine: 4, endLine: 4 },
    "UNVERIFIED_EVIDENCE",
  ],
  [
    "overbroad citation",
    { ...requirement, startLine: 2 },
    "UNVERIFIED_EVIDENCE",
  ],
  ["reversed range", { ...requirement, endLine: 2 }, "UNVERIFIED_EVIDENCE"],
  ["out of range", { ...requirement, endLine: 99 }, "UNVERIFIED_EVIDENCE"],
  [
    "missing same-line exception",
    {
      ...requirement,
      kind: "samples",
      quote: "submit samples",
      startLine: 5,
      endLine: 5,
    },
    "UNVERIFIED_EVIDENCE",
  ],
  [
    "extra product recommendation",
    { ...requirement, manufacturer: "Made Up" },
    "INVALID_MODEL_OUTPUT",
  ],
  [
    "wrong field type",
    { ...requirement, startLine: "3" },
    "INVALID_MODEL_OUTPUT",
  ],
  [
    "unknown classification",
    { ...requirement, kind: "approved_product" },
    "INVALID_MODEL_OUTPUT",
  ],
] as const) {
  test(`rejects ${label} rather than accepting fallback or partial results`, () => {
    assert.throws(
      () =>
        validateEvidence(
          { requirements: [requirement, altered] },
          input.specification,
        ),
      expectFailure(code),
    );
  });
}

test("duplicate evidence is rejected", () => {
  assert.throws(
    () =>
      validateEvidence(
        { requirements: [requirement, requirement] },
        input.specification,
      ),
    expectFailure("INVALID_MODEL_OUTPUT"),
  );
});

for (const text of [
  "not json",
  '```json\n{"requirements":[]}\n```',
  '{"items":[{"product":"Demo"}]}',
  '{"requirements":null}',
]) {
  test(`invalid model payload never becomes demo products: ${text.slice(0, 20)}`, async () => {
    await assert.rejects(
      analyzeSpecification(input, config, async () => provider(text)),
      expectFailure("INVALID_MODEL_OUTPUT"),
    );
  });
}

for (const finish of ["MAX_TOKENS", "SAFETY", "RECITATION", "OTHER"]) {
  test(`incomplete ${finish} response is not accepted even if JSON looks valid`, async () => {
    await assert.rejects(
      analyzeSpecification(input, config, async () =>
        provider(JSON.stringify(output), finish),
      ),
      expectFailure("INCOMPLETE_ANALYSIS"),
    );
  });
}

test("provider prompt block is explicit", async () => {
  await assert.rejects(
    analyzeSpecification(input, config, async () =>
      Response.json({ promptFeedback: { blockReason: "SAFETY" } }),
    ),
    expectFailure("ANALYSIS_BLOCKED"),
  );
});
for (const [status, code] of [
  [429, "PROVIDER_RATE_LIMITED"],
  [403, "PROVIDER_ERROR"],
  [500, "PROVIDER_ERROR"],
] as const) {
  test(`provider ${status} maps to a safe failure`, async () => {
    await assert.rejects(
      analyzeSpecification(
        input,
        config,
        async () => new Response("secret provider diagnostic", { status }),
      ),
      expectFailure(code),
    );
  });
}
test("network failures do not expose diagnostics", async () => {
  await assert.rejects(
    analyzeSpecification(input, config, async () => {
      throw new Error("secret project contents");
    }),
    expectFailure("PROVIDER_UNAVAILABLE"),
  );
});
test("provider timeout is explicit", async () => {
  await assert.rejects(
    analyzeSpecification(input, config, async () => {
      throw new DOMException("deadline", "TimeoutError");
    }),
    expectFailure("ANALYSIS_TIMEOUT"),
  );
});

for (const body of [
  {},
  { ...input, specification: "   " },
  { ...input, specification: "x".repeat(20_001) },
  { ...input, sourceName: "" },
  { ...input, extra: true },
]) {
  test(`API rejects invalid input before calling provider: ${Object.keys(body).join(",")}`, async () => {
    const fetchMock = mock.method(globalThis, "fetch", async () => {
      throw new Error("must not be called");
    });
    const response = await POST(request(body));
    assert.equal(response.status, 400);
    assert.equal(fetchMock.mock.callCount(), 0);
  });
}
test("API rejects invalid JSON", async () => {
  const response = await POST(
    new Request("http://localhost", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{",
    }),
  );
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "INVALID_JSON");
});
test("API rejects non-JSON content types", async () => {
  const response = await POST(
    new Request("http://localhost", { method: "POST", body: "text" }),
  );
  assert.equal(response.status, 415);
});
test("API bounds actual body bytes even without Content-Length", async () => {
  const response = await POST(
    new Request("http://localhost", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: " ".repeat(MAX_REQUEST_BYTES + 1),
    }),
  );
  assert.equal(response.status, 413);
});
test("missing server configuration fails explicitly", async () => {
  delete process.env.GOOGLE_API_KEY;
  delete process.env.GEMINI_MODEL;
  const response = await POST(request());
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, "ANALYZER_NOT_CONFIGURED");
});
test("route executes extraction and disables response caching", async () => {
  process.env.GOOGLE_API_KEY = config.apiKey;
  process.env.GEMINI_MODEL = config.model;
  mock.method(globalThis, "fetch", async () => provider());
  const response = await POST(request());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(
    analysisResultSchema.safeParse(await response.json()).success,
    true,
  );
});
test("route returns evidence failure with no successful items", async () => {
  process.env.GOOGLE_API_KEY = config.apiKey;
  process.env.GEMINI_MODEL = config.model;
  mock.method(globalThis, "fetch", async () =>
    provider(
      JSON.stringify({
        requirements: [{ ...requirement, quote: "Fabricated" }],
      }),
    ),
  );
  const response = await POST(request());
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.equal(body.error.code, "UNVERIFIED_EVIDENCE");
  assert.equal(body.requirements, undefined);
});
