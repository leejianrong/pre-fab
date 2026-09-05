import { z } from "zod";

/**
 * Template metadata only — no filesystem access, so this module is safe to
 * import from the browser editor's template gallery as well as apps/api's
 * server-side fork-on-use handler. The actual site tree (site.json,
 * theme.json, pages/*.json) is loaded server-side only, via "./server.js".
 */
export const TemplateManifestSchema = z.object({
  id: z
    .string()
    .min(1)
    .regex(/^[a-z][a-z0-9-]*$/, "id must be lowercase kebab-case"),
  name: z.string().min(1).max(80),
  category: z.string().min(1).max(40),
  tagline: z.string().min(1).max(140),
  description: z.string().min(1).max(400),
});

export type TemplateManifest = z.infer<typeof TemplateManifestSchema>;

/**
 * Eight at launch (ADR-0011: "fewer than that and 'pretty by default' fails
 * for the beachhead user"), growing from there (KAN-1128). Each `id` names
 * a directory under packages/templates/templates/ authored as an ordinary
 * exported site tree (site.json/theme.json/pages/*.json) — see
 * scripts/generate.ts for how they were produced and README-style
 * regeneration instructions there.
 */
export const TEMPLATE_MANIFESTS: TemplateManifest[] = [
  {
    id: "consultant",
    name: "Independent Consultant",
    category: "consultant",
    tagline: "A one-page site for a solo consultant or freelancer",
    description: "Services, a short bio, a client quote and a way to get in touch — built for someone selling their own time and expertise.",
  },
  {
    id: "photographer",
    name: "Photography Portfolio",
    category: "photographer",
    tagline: "A visual-first site built around a gallery",
    description: "A hero image, a photo gallery, a client testimonial and contact details — for a photographer whose work should do the talking.",
  },
  {
    id: "tutor",
    name: "Private Tutor",
    category: "tutor",
    tagline: "Subjects taught, an FAQ, and a booking-friendly contact section",
    description: "Built for a tutor or coach offering one-to-one sessions: what you teach, answers to common questions, and how to reach you.",
  },
  {
    id: "cafe",
    name: "Neighbourhood Café",
    category: "cafe",
    tagline: "Menu highlights, a photo gallery and a map",
    description: "A warm, food-forward layout with menu highlights, a gallery of the space, opening hours and a map for a café or small restaurant.",
  },
  {
    id: "fitness-coach",
    name: "Fitness Coach",
    category: "fitness-coach",
    tagline: "Programs, results and a clear call to action",
    description: "Built for a personal trainer or fitness coach: programs on offer, a client result, frequently asked questions, and how to sign up.",
  },
  {
    id: "agency",
    name: "Small Digital Agency",
    category: "agency",
    tagline: "Services, selected work and a client quote",
    description: "A slightly more corporate one-pager for a small studio or agency: services offered, selected work, and a testimonial from a client.",
  },
  {
    id: "event",
    name: "One-Day Event",
    category: "event",
    tagline: "A schedule, highlights and a venue map",
    description: "For a single event — a festival, conference or workshop — with a schedule, highlights, venue map and a contact line for organisers.",
  },
  {
    id: "personal-brand",
    name: "Personal Brand",
    category: "personal-brand",
    tagline: "An about page for a writer, speaker or creator",
    description: "A simple personal site: who you are, what you've made or written, a quote about your work, and how people can reach you.",
  },
  {
    id: "wellness-studio",
    name: "Yoga & Wellness Studio",
    category: "wellness-studio",
    tagline: "A full-bleed hero photograph, restrained type and room to breathe",
    description: "Class offerings, a philosophy statement and a photo gallery for a yoga studio or small wellness practice — built around generous whitespace and a calm serif/sans pairing rather than a busy schedule grid.",
  },
];
