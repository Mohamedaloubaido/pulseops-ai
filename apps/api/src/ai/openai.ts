import { z } from "zod";
import { env } from "../env.js";
import { ApiError } from "../lib/api-error.js";

const responseSchema = z
  .object({
    id: z.string(),
    model: z.string(),
    output: z.array(
      z
        .object({
          type: z.string(),
          content: z
            .array(
              z
                .object({
                  type: z.string(),
                  text: z.string().optional(),
                })
                .passthrough(),
            )
            .optional(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

function extractOutputText(value: z.infer<typeof responseSchema>) {
  const text = value.output
    .flatMap((item) => item.content ?? [])
    .find((content) => content.type === "output_text" && typeof content.text === "string")?.text;

  if (!text) throw new ApiError(502, "AI provider returned no text output");
  return text;
}

function parseJsonText(text: string) {
  const trimmed = text.trim();
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    return JSON.parse(unfenced) as unknown;
  } catch {
    throw new ApiError(502, "AI provider returned invalid structured output");
  }
}

export async function generateAiJson({
  system,
  input,
  maxOutputTokens = 1400,
}: {
  system: string;
  input: string;
  maxOutputTokens?: number;
}) {
  if (!env.OPENAI_API_KEY) {
    throw new ApiError(503, "AI copilot is not configured");
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: env.OPENAI_MODEL,
      store: false,
      max_output_tokens: maxOutputTokens,
      input: [
        { role: "system", content: system },
        { role: "user", content: input },
      ],
    }),
    signal: AbortSignal.timeout(env.AI_REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    const providerBody = await response.text();
    console.error("OpenAI Responses API error", response.status, providerBody.slice(0, 500));
    throw new ApiError(502, "AI provider request failed");
  }

  const parsed = responseSchema.safeParse(await response.json());
  if (!parsed.success) throw new ApiError(502, "AI provider returned an unexpected response");

  return {
    responseId: parsed.data.id,
    model: parsed.data.model,
    payload: parseJsonText(extractOutputText(parsed.data)),
  };
}
