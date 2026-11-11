import { z } from 'zod'

export const planSchema = z.object({
  goal: z.string().trim().min(1).max(500),
  steps: z.array(z.string().trim().min(1).max(400)).min(1).max(6),
  needsShardEdit: z.boolean(),
  targetShardId: z.string().trim().min(1).max(80).nullable(),
  successCriteria: z.array(z.string().trim().min(1).max(300)).min(1).max(5)
})

export type Plan = z.infer<typeof planSchema>

export const proposalSchema = z.object({
  shardId: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  markdown: z.string().trim().min(1).max(60_000),
  rationale: z.string().trim().min(1).max(500)
})

export type Proposal = z.infer<typeof proposalSchema>

const providerSchema = z.enum(['ollama-cloud', 'openrouter'])

export const setProviderSchema = z.object({ provider: providerSchema })
export const setModelSchema = z.object({ model: z.string().trim().min(1).max(120) })
export const setKeySchema = z.object({
  provider: providerSchema,
  apiKey: z.string().min(8).max(512)
})
export const clearKeySchema = z.object({ provider: providerSchema })
export const shardIdSchema = z.object({
  id: z.string().trim().regex(/^(identity-core|[a-z0-9]+(?:-[a-z0-9]+)*)$/)
})
export const ingestSchema = z.object({
  filename: z.string().trim().min(1).max(180),
  content: z.string().min(1).max(1_500_000)
})
export const turnSchema = z.object({
  prompt: z.string().trim().min(1).max(20_000)
})
export const cancelSchema = z.object({
  requestId: z.string().uuid()
})
