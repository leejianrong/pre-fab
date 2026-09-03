/**
 * Regenerates packages/templates/templates/<id>/{site.json,theme.json,pages/home.json}
 * from the block/theme definitions below. Run with:
 *
 *   pnpm --filter @prefab/templates run generate
 *
 * The output is checked into the repo like any other exported site tree
 * (ADR-0011: "templates are authored in-house as ordinary exported site
 * trees" — this script is the authoring tool, the committed JSON is the
 * artifact apps/api's fork-on-use handler actually reads at runtime).
 *
 * `site.id` / `page.id` / block ids below are placeholders: `newUlid()` is
 * called once per run so the checked-in files are valid ULIDs, but every
 * one of them is discarded and replaced on fork (packages/schema's
 * rekeyPageForFork) — a template is never instantiated by id-preserving
 * `push`, only by fork-on-use.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_THEME_TOKENS,
  newUlid,
  ORDER_GAP,
  type BlockNode,
  type PageDocument,
  type ThemeTokens,
} from "@prefab/schema";
import {
  BUTTON_BLOCK_TYPE,
  CARDGRID_BLOCK_TYPE,
  CONTACTDETAILS_BLOCK_TYPE,
  FAQ_BLOCK_TYPE,
  FOOTER_BLOCK_TYPE,
  GALLERY_BLOCK_TYPE,
  HEADING_BLOCK_TYPE,
  HERO_BLOCK_TYPE,
  MAPEMBED_BLOCK_TYPE,
  NAV_BLOCK_TYPE,
  RICHTEXT_BLOCK_TYPE,
  TESTIMONIAL_BLOCK_TYPE,
} from "@prefab/blocks";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "templates");

type BlockSpec = { type: string; props: Record<string, unknown> };

interface TemplateSpec {
  id: string;
  siteName: string;
  theme: ThemeTokens;
  blocks: BlockSpec[];
}

function theme(overrides: Partial<ThemeTokens["color"]>, radiusOverrides: Partial<ThemeTokens["radius"]> = {}): ThemeTokens {
  return {
    ...DEFAULT_THEME_TOKENS,
    color: { ...DEFAULT_THEME_TOKENS.color, ...overrides },
    radius: { ...DEFAULT_THEME_TOKENS.radius, ...radiusOverrides },
  };
}

const TEMPLATES: TemplateSpec[] = [
  {
    id: "consultant",
    siteName: "Ada Consulting",
    theme: theme({
      background: "#ffffff",
      foreground: "#0f172a",
      surface: "#f8fafc",
      "surface-foreground": "#0f172a",
      border: "#e2e8f0",
      accent: "#4f46e5",
      "accent-foreground": "#ffffff",
      muted: "#e2e8f0",
      "muted-foreground": "#475569",
    }),
    blocks: [
      { type: NAV_BLOCK_TYPE, props: { brand: "Ada Consulting", links: [{ label: "Services", href: "#services" }, { label: "Contact", href: "#contact" }] } },
      {
        type: HERO_BLOCK_TYPE,
        props: {
          heading: "Strategy and operations consulting for growing teams",
          subheading: "I help founders turn a messy first year into a business that runs without them in every room.",
          ctaLabel: "Book an introduction call",
          ctaHref: "#contact",
          background: "background",
        },
      },
      { type: HEADING_BLOCK_TYPE, props: { text: "What I help with", level: "h2", size: "heading", align: "left" } },
      {
        type: CARDGRID_BLOCK_TYPE,
        props: {
          columns: 3,
          cards: [
            { title: "Operations audit", body: "A structured review of how work actually moves through your team, with a prioritised fix list.", href: "" },
            { title: "Fractional COO", body: "Ongoing part-time operating support for founders who need a second pair of hands, not a full hire.", href: "" },
            { title: "Process design", body: "Turning tribal knowledge into documented, repeatable processes your team can run without you.", href: "" },
          ],
        },
      },
      {
        type: TESTIMONIAL_BLOCK_TYPE,
        props: {
          quote: "Ada rebuilt our onboarding process in three weeks. We went from a 40% drop-off to under 10%.",
          author: "Priya Shah",
          role: "Founder, Fieldnote",
        },
      },
      {
        type: CONTACTDETAILS_BLOCK_TYPE,
        props: { heading: "Get in touch", email: "hello@adaconsulting.example", phone: "+1 (555) 010-2200", address: "" },
      },
      { type: FOOTER_BLOCK_TYPE, props: { text: "© Ada Consulting", links: [] } },
    ],
  },
  {
    id: "photographer",
    siteName: "Lena Cruz Photography",
    theme: theme(
      {
        background: "#0b0b0d",
        foreground: "#f5f5f4",
        surface: "#18181b",
        "surface-foreground": "#f5f5f4",
        border: "#27272a",
        accent: "#d4af37",
        "accent-foreground": "#0b0b0d",
        muted: "#3f3f46",
        "muted-foreground": "#d4d4d8",
      },
      { card: "0.25rem", control: "0.25rem" },
    ),
    blocks: [
      { type: NAV_BLOCK_TYPE, props: { brand: "Lena Cruz", links: [{ label: "Portfolio", href: "#portfolio" }, { label: "Contact", href: "#contact" }] } },
      {
        type: HERO_BLOCK_TYPE,
        props: {
          heading: "Portraits and weddings, shot on location",
          subheading: "Based in Lisbon, available worldwide.",
          ctaLabel: "Enquire about a shoot",
          ctaHref: "#contact",
          background: "background",
        },
      },
      { type: HEADING_BLOCK_TYPE, props: { text: "Recent work", level: "h2", size: "heading", align: "left" } },
      {
        type: GALLERY_BLOCK_TYPE,
        props: {
          columns: 3,
          images: [
            { src: "https://images.unsplash.com/photo-1519741497674-611481863552?w=900&q=80", alt: "Wedding couple embracing outdoors" },
            { src: "https://images.unsplash.com/photo-1511285560929-80b456fea0bc?w=900&q=80", alt: "Portrait in natural light" },
            { src: "https://images.unsplash.com/photo-1511285560929-80b456fea0bc?w=900&q=80&sat=-100", alt: "Black and white portrait" },
            { src: "https://images.unsplash.com/photo-1520854221256-17451cc331bf?w=900&q=80", alt: "Wedding reception detail" },
            { src: "https://images.unsplash.com/photo-1465495976277-4387d4b0b4c6?w=900&q=80", alt: "Outdoor engagement session" },
            { src: "https://images.unsplash.com/photo-1522673607200-164d1b6ce486?w=900&q=80", alt: "Studio portrait" },
          ],
        },
      },
      {
        type: TESTIMONIAL_BLOCK_TYPE,
        props: {
          quote: "Lena made our wedding day feel effortless. The photos are the thing we look at most from that whole year.",
          author: "Marco & Julie",
          role: "",
        },
      },
      { type: CONTACTDETAILS_BLOCK_TYPE, props: { heading: "Enquire", email: "hello@lenacruz.example", phone: "", address: "Lisbon, Portugal" } },
      { type: FOOTER_BLOCK_TYPE, props: { text: "© Lena Cruz Photography", links: [] } },
    ],
  },
  {
    id: "tutor",
    siteName: "BrightPath Tutoring",
    theme: theme({
      background: "#ffffff",
      foreground: "#0c2340",
      surface: "#eef4fb",
      "surface-foreground": "#0c2340",
      border: "#d7e6f5",
      accent: "#0c6b81",
      "accent-foreground": "#ffffff",
      muted: "#d7e6f5",
      "muted-foreground": "#2d5069",
    }),
    blocks: [
      { type: NAV_BLOCK_TYPE, props: { brand: "BrightPath Tutoring", links: [{ label: "Subjects", href: "#subjects" }, { label: "FAQ", href: "#faq" }, { label: "Contact", href: "#contact" }] } },
      {
        type: HERO_BLOCK_TYPE,
        props: {
          heading: "One-to-one tutoring that meets your kid where they are",
          subheading: "Maths, science and English, for ages 10 to 18 — online or in person.",
          ctaLabel: "Book a free trial session",
          ctaHref: "#contact",
          background: "background",
        },
      },
      { type: HEADING_BLOCK_TYPE, props: { text: "Subjects I teach", level: "h2", size: "heading", align: "left" } },
      {
        type: CARDGRID_BLOCK_TYPE,
        props: {
          columns: 3,
          cards: [
            { title: "Mathematics", body: "From long division to calculus — exam prep and everyday confidence.", href: "" },
            { title: "Science", body: "Biology, chemistry and physics, tied to what's actually on the syllabus.", href: "" },
            { title: "English", body: "Reading comprehension and essay writing, one paragraph at a time.", href: "" },
          ],
        },
      },
      {
        type: FAQ_BLOCK_TYPE,
        props: {
          items: [
            { question: "How long is a session?", answer: "Sessions run 50 minutes, weekly or twice-weekly depending on the subject." },
            { question: "Do you tutor online?", answer: "Yes — most sessions are online, with in-person available locally." },
            { question: "What ages do you work with?", answer: "Primarily ages 10 to 18, across primary through to exam-year students." },
          ],
        },
      },
      { type: CONTACTDETAILS_BLOCK_TYPE, props: { heading: "Book a trial session", email: "hello@brightpathtutoring.example", phone: "+1 (555) 010-3300", address: "" } },
      { type: FOOTER_BLOCK_TYPE, props: { text: "© BrightPath Tutoring", links: [] } },
    ],
  },
  {
    id: "cafe",
    siteName: "The Daily Grind Café",
    theme: theme(
      {
        background: "#fdf6ec",
        foreground: "#3f2a1d",
        surface: "#f6e8d7",
        "surface-foreground": "#3f2a1d",
        border: "#e6d2b8",
        accent: "#9c4020",
        "accent-foreground": "#fdf6ec",
        muted: "#e6d2b8",
        "muted-foreground": "#5c4530",
      },
      { card: "1rem", control: "1rem" },
    ),
    blocks: [
      { type: NAV_BLOCK_TYPE, props: { brand: "The Daily Grind", links: [{ label: "Menu", href: "#menu" }, { label: "Visit", href: "#visit" }] } },
      {
        type: HERO_BLOCK_TYPE,
        props: {
          heading: "Coffee, pastries and a place to sit for a while",
          subheading: "Open every day from 7am, on the corner of Elm and 5th.",
          ctaLabel: "See the menu",
          ctaHref: "#menu",
          background: "background",
        },
      },
      { type: HEADING_BLOCK_TYPE, props: { text: "Menu highlights", level: "h2", size: "heading", align: "left" } },
      {
        type: CARDGRID_BLOCK_TYPE,
        props: {
          columns: 3,
          cards: [
            { title: "Flat white", body: "Double shot, steamed milk, our house blend.", href: "" },
            { title: "Almond croissant", body: "Baked fresh every morning, gone most days by 10am.", href: "" },
            { title: "Avocado toast", body: "Sourdough, chilli flakes, a soft-boiled egg on request.", href: "" },
          ],
        },
      },
      {
        type: GALLERY_BLOCK_TYPE,
        props: {
          columns: 3,
          images: [
            { src: "https://images.unsplash.com/photo-1445116572660-236099ec97a0?w=900&q=80", alt: "Latte art on a wooden table" },
            { src: "https://images.unsplash.com/photo-1554118811-1e0d58224f24?w=900&q=80", alt: "Café interior seating area" },
            { src: "https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=900&q=80", alt: "Pastries in a display case" },
          ],
        },
      },
      { type: MAPEMBED_BLOCK_TYPE, props: { query: "5th Ave & Elm St", height: "md" } },
      { type: CONTACTDETAILS_BLOCK_TYPE, props: { heading: "Visit us", email: "hello@dailygrindcafe.example", phone: "+1 (555) 010-4400", address: "5th Ave & Elm St" } },
      { type: FOOTER_BLOCK_TYPE, props: { text: "© The Daily Grind Café", links: [] } },
    ],
  },
  {
    id: "fitness-coach",
    siteName: "Forge Fitness Coaching",
    theme: theme({
      background: "#0e0e10",
      foreground: "#f4f4f5",
      surface: "#1a1a1d",
      "surface-foreground": "#f4f4f5",
      border: "#2a2a2e",
      accent: "#f4536b",
      "accent-foreground": "#1a1a1d",
      muted: "#3f3f46",
      "muted-foreground": "#d4d4d8",
    }),
    blocks: [
      { type: NAV_BLOCK_TYPE, props: { brand: "Forge Fitness", links: [{ label: "Programs", href: "#programs" }, { label: "FAQ", href: "#faq" }, { label: "Sign up", href: "#contact" }] } },
      {
        type: HERO_BLOCK_TYPE,
        props: {
          heading: "Coaching that fits around your actual life",
          subheading: "Strength and conditioning programs for people who've never had time for the gym before.",
          ctaLabel: "Start your first week free",
          ctaHref: "#contact",
          background: "background",
        },
      },
      { type: HEADING_BLOCK_TYPE, props: { text: "Programs", level: "h2", size: "heading", align: "left" } },
      {
        type: CARDGRID_BLOCK_TYPE,
        props: {
          columns: 3,
          cards: [
            { title: "Strength foundations", body: "Twelve weeks of guided strength training, three sessions a week.", href: "" },
            { title: "1:1 coaching", body: "A fully personalised program with weekly check-ins.", href: "" },
            { title: "Small group", body: "Train alongside four other people at your level, twice a week.", href: "" },
          ],
        },
      },
      {
        type: TESTIMONIAL_BLOCK_TYPE,
        props: {
          quote: "I'd tried and quit three gym memberships before this. Twelve weeks in and I haven't missed a session.",
          author: "Dev Patel",
          role: "Client since 2025",
        },
      },
      {
        type: FAQ_BLOCK_TYPE,
        props: {
          items: [
            { question: "Do I need any equipment?", answer: "No — programs are designed around what's available at a standard gym." },
            { question: "I've never trained before, is that OK?", answer: "Yes, most clients start here. Every program begins with an assessment." },
          ],
        },
      },
      { type: CONTACTDETAILS_BLOCK_TYPE, props: { heading: "Start your first week free", email: "hello@forgefitness.example", phone: "+1 (555) 010-5500", address: "" } },
      { type: FOOTER_BLOCK_TYPE, props: { text: "© Forge Fitness Coaching", links: [] } },
    ],
  },
  {
    id: "agency",
    siteName: "Northwind Digital",
    theme: theme(
      {
        background: "#ffffff",
        foreground: "#1e1b3a",
        surface: "#f4f2fb",
        "surface-foreground": "#1e1b3a",
        border: "#e3ddf7",
        accent: "#6d28d9",
        "accent-foreground": "#ffffff",
        muted: "#e3ddf7",
        "muted-foreground": "#433d5e",
      },
      { card: "0.5rem", control: "0.375rem" },
    ),
    blocks: [
      { type: NAV_BLOCK_TYPE, props: { brand: "Northwind Digital", links: [{ label: "Services", href: "#services" }, { label: "Work", href: "#work" }, { label: "Contact", href: "#contact" }] } },
      {
        type: HERO_BLOCK_TYPE,
        props: {
          heading: "A small studio for product design and web development",
          subheading: "We work with teams of 3 to 30 who need a shipped product, not a slide deck.",
          ctaLabel: "Start a project",
          ctaHref: "#contact",
          background: "background",
        },
      },
      { type: HEADING_BLOCK_TYPE, props: { text: "Services", level: "h2", size: "heading", align: "left" } },
      {
        type: CARDGRID_BLOCK_TYPE,
        props: {
          columns: 3,
          cards: [
            { title: "Product design", body: "From a rough idea to a tested, buildable interface.", href: "" },
            { title: "Web development", body: "Fast, accessible, maintainable sites and web apps.", href: "" },
            { title: "Brand identity", body: "A visual system your team can actually keep using.", href: "" },
          ],
        },
      },
      { type: HEADING_BLOCK_TYPE, props: { text: "Selected work", level: "h2", size: "heading", align: "left" } },
      {
        type: CARDGRID_BLOCK_TYPE,
        props: {
          columns: 3,
          cards: [
            { title: "Fieldnote", body: "Redesigned onboarding for a field-services SaaS, cutting drop-off by 30%.", href: "" },
            { title: "Harbor Goods", body: "A new storefront and brand for a home-goods retailer.", href: "" },
            { title: "Loop Transit", body: "A real-time transit tracker used by four regional agencies.", href: "" },
          ],
        },
      },
      {
        type: TESTIMONIAL_BLOCK_TYPE,
        props: {
          quote: "Northwind shipped in six weeks what our last agency quoted eighteen for.",
          author: "Sam Okafor",
          role: "CEO, Harbor Goods",
        },
      },
      { type: CONTACTDETAILS_BLOCK_TYPE, props: { heading: "Start a project", email: "hello@northwinddigital.example", phone: "+1 (555) 010-6600", address: "" } },
      { type: FOOTER_BLOCK_TYPE, props: { text: "© Northwind Digital", links: [] } },
    ],
  },
  {
    id: "event",
    siteName: "Riverside Summer Fest",
    theme: theme(
      {
        background: "#fff8f0",
        foreground: "#3a1d1d",
        surface: "#ffe9d6",
        "surface-foreground": "#3a1d1d",
        border: "#ffd3ab",
        accent: "#9a3412",
        "accent-foreground": "#ffffff",
        muted: "#ffd3ab",
        "muted-foreground": "#6b4530",
      },
      { card: "1rem", control: "9999px" },
    ),
    blocks: [
      { type: NAV_BLOCK_TYPE, props: { brand: "Riverside Summer Fest", links: [{ label: "Schedule", href: "#schedule" }, { label: "Venue", href: "#venue" }] } },
      {
        type: HERO_BLOCK_TYPE,
        props: {
          heading: "Riverside Summer Fest — August 22, 2026",
          subheading: "One day, three stages, food trucks and a river view. All ages welcome.",
          ctaLabel: "Get tickets",
          ctaHref: "#contact",
          background: "background",
        },
      },
      { type: HEADING_BLOCK_TYPE, props: { text: "Schedule", level: "h2", size: "heading", align: "left" } },
      {
        type: RICHTEXT_BLOCK_TYPE,
        props: {
          html: "12:00 — Gates open, food trucks and market stalls\n\n14:00 — Main stage opening set\n\n17:00 — Community stage: local bands and spoken word\n\n20:00 — Headline performance, riverside stage",
          size: "body",
          align: "left",
        },
      },
      { type: HEADING_BLOCK_TYPE, props: { text: "Highlights", level: "h2", size: "heading", align: "left" } },
      {
        type: CARDGRID_BLOCK_TYPE,
        props: {
          columns: 3,
          cards: [
            { title: "Three stages", body: "Main, community and riverside stages running all day.", href: "" },
            { title: "Food trucks", body: "A dozen local vendors, plus a dedicated kids' food area.", href: "" },
            { title: "Free parking", body: "Shuttle buses run every 20 minutes from the north car park.", href: "" },
          ],
        },
      },
      { type: MAPEMBED_BLOCK_TYPE, props: { query: "Riverside Park amphitheatre", height: "md" } },
      { type: CONTACTDETAILS_BLOCK_TYPE, props: { heading: "Questions for organisers", email: "hello@riversidesummerfest.example", phone: "", address: "Riverside Park" } },
      { type: FOOTER_BLOCK_TYPE, props: { text: "© Riverside Summer Fest", links: [] } },
    ],
  },
  {
    id: "personal-brand",
    siteName: "Jordan Blake",
    theme: theme(
      {
        background: "#fbfaf8",
        foreground: "#1c1c1a",
        surface: "#f1efe9",
        "surface-foreground": "#1c1c1a",
        border: "#e3e0d8",
        accent: "#1c1c1a",
        "accent-foreground": "#fbfaf8",
        muted: "#e3e0d8",
        "muted-foreground": "#454239",
      },
      { card: "0.25rem", control: "0.25rem" },
    ),
    blocks: [
      { type: NAV_BLOCK_TYPE, props: { brand: "Jordan Blake", links: [{ label: "About", href: "#about" }, { label: "Writing", href: "#writing" }, { label: "Contact", href: "#contact" }] } },
      {
        type: HERO_BLOCK_TYPE,
        props: {
          heading: "Jordan Blake",
          subheading: "Writer and speaker on the future of remote work.",
          ctaLabel: "Get in touch",
          ctaHref: "#contact",
          background: "background",
        },
      },
      { type: HEADING_BLOCK_TYPE, props: { text: "About", level: "h2", size: "heading", align: "left" } },
      {
        type: RICHTEXT_BLOCK_TYPE,
        props: {
          html: "I write and speak about how distributed teams actually work — not the theory, the practice. My newsletter reaches 40,000 readers a week, and I've spoken at conferences on four continents.\n\nPreviously: head of remote at two Series B startups, one very long stint as an actual remote employee.",
          size: "body",
          align: "left",
        },
      },
      { type: HEADING_BLOCK_TYPE, props: { text: "Recent writing", level: "h2", size: "heading", align: "left" } },
      {
        type: CARDGRID_BLOCK_TYPE,
        props: {
          columns: 3,
          cards: [
            { title: "The Async Trap", body: "Why 'async by default' quietly makes decisions slower, not faster.", href: "" },
            { title: "Hiring Without a Room", body: "A field guide to interviewing well over video.", href: "" },
            { title: "Time Zones Are a Feature", body: "Reframing the thing everyone complains about.", href: "" },
          ],
        },
      },
      {
        type: TESTIMONIAL_BLOCK_TYPE,
        props: {
          quote: "Jordan is one of the few people writing about remote work who has actually managed a remote team.",
          author: "Renee Ostrowski",
          role: "VP Engineering, Fieldnote",
        },
      },
      { type: CONTACTDETAILS_BLOCK_TYPE, props: { heading: "Get in touch", email: "hello@jordanblake.example", phone: "", address: "" } },
      { type: FOOTER_BLOCK_TYPE, props: { text: "© Jordan Blake", links: [] } },
    ],
  },
  {
    id: "wellness-studio",
    siteName: "Still Water Yoga",
    // A dedicated theme object, not the shared `theme()` helper above — this
    // template varies fontFamily and spacing too (the helper only covers
    // color/radius), and both matter here: a restrained serif/sans pairing
    // and a wider section rhythm are the whole point of the "editorial
    // design discipline" this template exists to demonstrate (KAN-1128).
    theme: {
      ...DEFAULT_THEME_TOKENS,
      color: {
        background: "#f7f5f0",
        foreground: "#2b2b26",
        surface: "#eeece3",
        "surface-foreground": "#2b2b26",
        border: "#ded9c9",
        accent: "#5c6e58",
        "accent-foreground": "#f7f5f0",
        muted: "#ded9c9",
        "muted-foreground": "#5c584d",
      },
      fontFamily: {
        heading: "Georgia, 'Times New Roman', serif",
        body: "'Segoe UI', -apple-system, sans-serif",
      },
      spacing: { ...DEFAULT_THEME_TOKENS.spacing, section: "6rem" },
      radius: { ...DEFAULT_THEME_TOKENS.radius, card: "0.25rem", control: "0.25rem" },
    },
    blocks: [
      { type: NAV_BLOCK_TYPE, props: { brand: "Still Water Yoga", links: [{ label: "Classes", href: "#classes" }, { label: "Philosophy", href: "#philosophy" }, { label: "Visit", href: "#contact" }] } },
      {
        type: HERO_BLOCK_TYPE,
        props: {
          heading: "Slow down. Show up. Breathe.",
          subheading: "Vinyasa, restorative and breathwork classes in a small studio built for quiet attention.",
          ctaLabel: "See class times",
          ctaHref: "#classes",
          background: "background",
          backgroundImage: "https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?w=1200&q=70",
        },
      },
      { type: HEADING_BLOCK_TYPE, props: { text: "Our philosophy", level: "h2", size: "heading", align: "left" } },
      {
        type: RICHTEXT_BLOCK_TYPE,
        props: {
          html: "We keep classes small and unhurried. No mirrors, no music you can't think over — just enough people in a room to notice each other's breathing.\n\nMost students start with one class a week and stay for years. There's no six-week transformation here, just a quiet, ongoing one.",
          size: "body",
          align: "left",
        },
      },
      { type: HEADING_BLOCK_TYPE, props: { text: "Classes", level: "h2", size: "heading", align: "left" } },
      {
        type: CARDGRID_BLOCK_TYPE,
        props: {
          columns: 3,
          cards: [
            { title: "Vinyasa Flow", body: "A moving, breath-led practice. Mornings and early evenings, all levels.", href: "" },
            { title: "Restorative", body: "Long holds, blankets and bolsters — the class students describe as the best hour of their week.", href: "" },
            { title: "Breathwork & Meditation", body: "Twenty minutes of breathing, twenty minutes of stillness. No mat required.", href: "" },
          ],
        },
      },
      {
        type: GALLERY_BLOCK_TYPE,
        props: {
          columns: 3,
          images: [
            { src: "https://images.unsplash.com/photo-1545205597-3d9d02c29597?w=900&q=80", alt: "A group class in tree pose on the beach at low tide" },
            { src: "https://images.unsplash.com/photo-1506126613408-eca07ce68773?w=900&q=80", alt: "A student seated in meditation as the sun rises behind them" },
            { src: "https://images.unsplash.com/photo-1552196563-55cd4e45efb3?w=900&q=80", alt: "A student in a seated stretch on a sunlit wooden studio floor" },
          ],
        },
      },
      {
        type: TESTIMONIAL_BLOCK_TYPE,
        props: {
          quote: "I've tried a dozen studios in this city. This is the only one where I actually stopped checking the clock.",
          author: "Priya Nandan",
          role: "Student since 2019",
        },
      },
      {
        type: FAQ_BLOCK_TYPE,
        props: {
          items: [
            { question: "Do I need to bring my own mat?", answer: "No — mats, blankets and bolsters are all provided, freshly cleaned after every class." },
            { question: "I've never done yoga before. Is that a problem?", answer: "Most of our students hadn't either. Every class is taught to the person who's never been, not around them." },
            { question: "What should I wear?", answer: "Whatever you can move in. There's no dress code here." },
          ],
        },
      },
      { type: CONTACTDETAILS_BLOCK_TYPE, props: { heading: "Visit the studio", email: "hello@stillwateryoga.example", phone: "+1 (555) 010-7733", address: "142 Birch Lane, Studio 2" } },
      { type: FOOTER_BLOCK_TYPE, props: { text: "© Still Water Yoga", links: [] } },
    ],
  },
];

// A distinct CTA button on every template's hero-adjacent section would be
// nice, but the button block is already exercised elsewhere in the block
// library e2e (block-library.spec.ts) — templates lean on Hero's own
// built-in ctaLabel/ctaHref instead of a separate Button block, keeping
// each page's block count realistic rather than padded.
void BUTTON_BLOCK_TYPE;

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function generateTemplate(spec: TemplateSpec): Promise<void> {
  const siteId = newUlid();
  const pageId = newUlid();

  const blocks: BlockNode[] = spec.blocks.map((b, index) => ({
    id: newUlid(),
    type: b.type,
    parent: null,
    order: (index + 1) * ORDER_GAP,
    schemaVersion: 1,
    props: b.props,
    responsive: {},
  }));

  const page: PageDocument = {
    id: pageId,
    siteId,
    slug: "home",
    title: "Home",
    schemaVersion: 1,
    version: 0,
    blocks,
  };

  const dir = path.join(ROOT, spec.id);
  await writeJson(path.join(dir, "site.json"), { id: siteId, slug: spec.id, name: spec.siteName });
  await writeJson(path.join(dir, "theme.json"), { schemaVersion: 1, tokens: spec.theme });
  await writeJson(path.join(dir, "pages", "home.json"), page);
}

for (const spec of TEMPLATES) {
  await generateTemplate(spec);
  console.log(`generated templates/${spec.id}/ (${spec.blocks.length} blocks)`);
}
