import { z } from "zod";
import { env } from "../env.js";
import { ApiError } from "../lib/api-error.js";

const embeddingsResponseSchema = z.object({
  model: z.string(),
  data: z.array(
    z.object({
      index: z.number().int().nonnegative(),
      embedding: z.array(z.number()),
    }),
  ),
});

export async function generateEmbeddings(inputs: string[]) {
  if (!env.OPENAI_API_KEY) throw new ApiError(503, "AI embeddings are not configured");
  if (inputs.length === 0) return { model: env.OPENAI_EMBEDDING_MODEL, embeddings: [] as number[][] };

  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: env.OPENAI_EMBEDDING_MODEL,
      input: inputs,
      encoding_format: "float",
    }),
    signal: AbortSignal.timeout(env.AI_REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    const providerBody = await response.text();
    console.error("OpenAI Embeddings API error", response.status, providerBody.slice(0, 500));
    throw new ApiError(502, "Embedding provider request failed");
  }

  const parsed = embeddingsResponseSchema.safeParse(await response.json());
  if (!parsed.success) throw new ApiError(502, "Embedding provider returned an unexpected response");

  const ordered = [...parsed.data.data].sort((a, b) => a.index - b.index);
  if (ordered.length !== inputs.length || ordered.some((item) => item.embedding.length === 0)) {
    throw new ApiError(502, "Embedding provider returned incomplete vectors");
  }

  const dimensions = ordered[0]?.embedding.length ?? 0;
  if (ordered.some((item) => item.embedding.length !== dimensions)) {
    throw new ApiError(502, "Embedding provider returned inconsistent vector dimensions");
  }

  return {
    model: parsed.data.model,
    embeddings: ordered.map((item) => item.embedding),
  };
}
