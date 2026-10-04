import { z } from "zod";

const looseCueSchema = z.object({
  start_seconds: z.coerce.number().optional(),
  end_seconds: z.coerce.number().optional(),
  text: z.string().optional(),
});

export const clipCandidateSchema = z.object({
  id: z.string().min(1),
  start_seconds: z.coerce.number().finite().nonnegative(),
  end_seconds: z.coerce.number().finite().positive(),
  viral_score: z.coerce.number().finite().min(0).max(100),
  title: z.string().min(1).transform((value) => value.trim().slice(0, 180)),
  hook: z.string().min(1).transform((value) => value.trim().slice(0, 280)),
  reason: z.string().min(1).transform((value) => value.trim().slice(0, 480)),
  tags: z.preprocess((value) => (Array.isArray(value) ? value : []), z.array(z.string())),
  platforms: z.preprocess((value) => (Array.isArray(value) ? value : []), z.array(z.string())),
});

export const clipResponseSchema = z.object({
  video: z
    .object({
      source_url: z.string().optional(),
      duration_seconds: z.coerce.number().finite().positive().optional(),
      language: z.string().optional(),
    })
    .default({}),
  clips: z.array(clipCandidateSchema).min(1),
  transcript: z.preprocess(
    (value) => (Array.isArray(value) ? value : []),
    z.array(looseCueSchema),
  ),
});

export type ClipCandidate = z.infer<typeof clipCandidateSchema>;
export type ClipResponse = z.infer<typeof clipResponseSchema>;
