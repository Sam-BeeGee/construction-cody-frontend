import { z } from "zod";

export const MAX_SPEC_CHARACTERS = 20_000;
export const MAX_REQUEST_BYTES = 100_000;

export const requirementLabels = {
  product_data: "Product data",
  shop_drawings: "Shop drawings",
  samples: "Samples",
  certificates: "Certificates",
  test_reports: "Test reports",
  closeout: "Closeout documents",
  domestic_content: "Domestic content / origin",
  other: "Other requirement",
} as const;

export const analysisRequestSchema = z.strictObject({
  specification: z
    .string()
    .min(1)
    .max(MAX_SPEC_CHARACTERS)
    .refine((value) => value.trim().length > 0),
  sourceName: z.string().trim().min(1).max(120),
});

// The model supplies only classification and verbatim evidence, never products
// or paraphrased assertions. Line numbers refer to the submitted excerpt.
export const extractedRequirementSchema = z.strictObject({
  kind: z.enum([
    "product_data",
    "shop_drawings",
    "samples",
    "certificates",
    "test_reports",
    "closeout",
    "domestic_content",
    "other",
  ]),
  quote: z.string().min(1).max(4_000),
  startLine: z.number().int().min(1),
  endLine: z.number().int().min(1),
});

export const modelOutputSchema = z.strictObject({
  requirements: z.array(extractedRequirementSchema).max(80),
});

export const analysisResultSchema = z.strictObject({
  status: z.enum(["requirements_found", "no_requirements_found"]),
  source: z.strictObject({
    name: z.string(),
    text: z.string(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    lineCount: z.number().int().min(1),
  }),
  requirements: z
    .array(
      extractedRequirementSchema.extend({
        id: z.string(),
        reviewStatus: z.literal("needs_review"),
      }),
    )
    .max(80),
  limitations: z.array(z.string()),
  analyzedAt: z.string(),
  model: z.string(),
});

export const analysisErrorSchema = z.strictObject({
  error: z.strictObject({ code: z.string(), message: z.string() }),
});

export type AnalysisRequest = z.infer<typeof analysisRequestSchema>;
export type AnalysisResult = z.infer<typeof analysisResultSchema>;
