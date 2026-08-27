import { z } from "zod";
import { UlidSchema } from "./ids.js";

export const SiteManifestSchema = z.object({
  id: UlidSchema,
  slug: z.string().min(1),
  name: z.string().min(1),
  ownerId: UlidSchema,
  schemaVersion: z.number().int().nonnegative(),
  pages: z.array(
    z.object({
      id: UlidSchema,
      slug: z.string().min(1),
    }),
  ),
});

export type SiteManifest = z.infer<typeof SiteManifestSchema>;
