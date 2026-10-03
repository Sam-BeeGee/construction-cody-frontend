import { NextResponse } from "next/server";
import {
  AnalysisFailure,
  analyzeSpecification,
} from "@/lib/submittals/analyze";
import {
  analysisRequestSchema,
  MAX_REQUEST_BYTES,
} from "@/lib/submittals/schema";

export const runtime = "nodejs";
export const maxDuration = 45;

function failure(code: string, message: string, status: number) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

async function readBody(request: Request) {
  if (!request.body)
    throw new AnalysisFailure(
      "INVALID_REQUEST",
      "A JSON request body is required.",
      400,
    );
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_REQUEST_BYTES) {
        await reader.cancel();
        throw new AnalysisFailure(
          "REQUEST_TOO_LARGE",
          "The request is too large. Submit one specification excerpt at a time.",
          413,
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    ) as unknown;
  } catch {
    throw new AnalysisFailure(
      "INVALID_JSON",
      "The request body must be valid UTF-8 JSON.",
      400,
    );
  }
}

export async function POST(request: Request) {
  if (
    request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !==
    "application/json"
  ) {
    return failure(
      "UNSUPPORTED_MEDIA_TYPE",
      "Send specification text as application/json.",
      415,
    );
  }
  try {
    const parsed = analysisRequestSchema.safeParse(await readBody(request));
    if (!parsed.success)
      return failure(
        "INVALID_REQUEST",
        "Provide a source name (1–120 characters) and specification text (1–20,000 characters).",
        400,
      );
    const apiKey = process.env.GOOGLE_API_KEY?.trim();
    const model = process.env.GEMINI_MODEL?.trim();
    if (!apiKey || !model || !/^[a-zA-Z0-9._-]+$/.test(model)) {
      return failure(
        "ANALYZER_NOT_CONFIGURED",
        "The server needs GOOGLE_API_KEY and a structured-output capable GEMINI_MODEL before analysis can run.",
        503,
      );
    }
    const result = await analyzeSpecification(parsed.data, { apiKey, model });
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof AnalysisFailure)
      return failure(error.code, error.message, error.status);
    // Do not expose provider responses, secrets, or project specification text.
    return failure(
      "ANALYSIS_FAILED",
      "Analysis failed unexpectedly. No results were accepted. Try again.",
      500,
    );
  }
}
