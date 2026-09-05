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

type BlockSpec = { type: string; props: Record<string, unknown>; scrollReveal?: boolean };

interface TemplateSpec {
  id: string;
  siteName: string;
  theme: ThemeTokens;
  blocks: BlockSpec[];
}

// The `theme(color, radius)` shortcut every template used to share (only
// overriding color/radius, everything else left at DEFAULT_THEME_TOKENS) is
// gone (KAN-1152 thread 1): every template now also sets its own fontFamily
// and section spacing, so each spec below builds its full ThemeTokens
// literal directly — the same shape wellness-studio's spec already used.

const TEMPLATES: TemplateSpec[] = [
  {
    id: "consultant",
    siteName: "Ada Consulting",
    theme: {
      ...DEFAULT_THEME_TOKENS,
      color: {
        background: "#ffffff",
        foreground: "#0f172a",
        surface: "#f8fafc",
        "surface-foreground": "#0f172a",
        border: "#e2e8f0",
        accent: "#4f46e5",
        "accent-foreground": "#ffffff",
        muted: "#e2e8f0",
        "muted-foreground": "#475569",
      },
      fontFamily: {
        heading: "'Helvetica Neue', Arial, sans-serif",
        body: "system-ui, sans-serif",
      },
      spacing: { ...DEFAULT_THEME_TOKENS.spacing, section: "5rem" },
      radius: { ...DEFAULT_THEME_TOKENS.radius, control: "0.375rem", card: "0.5rem" },
    },
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
          // No hero image (KAN-1152 thread 1, deliberate restraint): a
          // generic stock "consulting" photo reads as filler on a one-person
          // services site — this template stays text/color-led on purpose.
        },
        scrollReveal: true,
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
    theme: {
      ...DEFAULT_THEME_TOKENS,
      color: {
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
      // fontFamily deliberately stays the system-ui default (KAN-1152 thread
      // 1): a named serif/sans pairing (Georgia, Helvetica Neue, even just
      // one axis) was tried and measurably, reproducibly cost 10+ Lighthouse
      // performance points in this template specifically — its own 6-image
      // gallery already spends most of its R3 headroom, and a headless
      // Chromium resolving an uninstalled named font down its fallback
      // chain is real, non-trivial main-thread cost under mobile CPU
      // throttling. A neutral system sans is also a defensible fit for this
      // template's "let the photography speak" stark-minimalism anyway —
      // see the PR description for the full measurement trail.
      fontFamily: {
        heading: "system-ui, sans-serif",
        body: "system-ui, sans-serif",
      },
      spacing: { ...DEFAULT_THEME_TOKENS.spacing, section: "5rem" },
      radius: { ...DEFAULT_THEME_TOKENS.radius, card: "0.25rem", control: "0.25rem" },
    },
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
          // No hero backgroundImage here (KAN-1152 thread 1): tried, but this
          // template's own 6-image gallery already sits close to the R3
          // Lighthouse floor, and a full-bleed hero image (any size — bytes
          // were not the driver; see the PR description) reliably pushed it
          // below 90. Backed off per the card's own instructions rather than
          // ship a regression.
        },
        scrollReveal: true,
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
    theme: {
      ...DEFAULT_THEME_TOKENS,
      color: {
        background: "#ffffff",
        foreground: "#0c2340",
        surface: "#eef4fb",
        "surface-foreground": "#0c2340",
        border: "#d7e6f5",
        accent: "#0c6b81",
        "accent-foreground": "#ffffff",
        muted: "#d7e6f5",
        "muted-foreground": "#2d5069",
      },
      fontFamily: {
        heading: "Charter, Cambria, Georgia, serif",
        body: "-apple-system, 'Segoe UI', system-ui, sans-serif",
      },
      spacing: { ...DEFAULT_THEME_TOKENS.spacing, section: "5rem" },
      radius: { ...DEFAULT_THEME_TOKENS.radius, control: "0.5rem", card: "1rem" },
    },
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
          // No hero image (KAN-1152 thread 1, deliberate restraint): a
          // tutoring service working with minors is a poor fit for a
          // generic stock "student" photo, so this template stays
          // text/color-led rather than force a full-bleed image where it
          // doesn't earn its place.
        },
        scrollReveal: true,
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
    theme: {
      ...DEFAULT_THEME_TOKENS,
      color: {
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
      // fontFamily deliberately stays the system-ui default (KAN-1152 thread
      // 1): a warm serif heading (Palatino/Georgia) was tried and measured
      // (see PR description) to cost 10+ Lighthouse performance points here
      // often enough to fail R3 — this page's own 3-image gallery already
      // spends meaningful headroom, same root cause as photographer's. The
      // warmth stays expressed through color (cream/terracotta) and the
      // more generous radius/spacing below instead.
      fontFamily: {
        heading: "system-ui, sans-serif",
        body: "system-ui, sans-serif",
      },
      spacing: { ...DEFAULT_THEME_TOKENS.spacing, section: "5rem" },
      radius: { ...DEFAULT_THEME_TOKENS.radius, control: "0.75rem", card: "1.25rem" },
    },
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
          // No hero image (KAN-1152 thread 1): tried a full-bleed interior
          // photo here, but combined with this page's own 3-image gallery
          // it reliably cost 10+ Lighthouse performance points. Backed off
          // per the card's own instructions; the gallery below already
          // carries this template's photography.
        },
        scrollReveal: true,
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
    theme: {
      ...DEFAULT_THEME_TOKENS,
      color: {
        background: "#0e0e10",
        foreground: "#f4f4f5",
        surface: "#1a1a1d",
        "surface-foreground": "#f4f4f5",
        border: "#2a2a2e",
        accent: "#f4536b",
        "accent-foreground": "#1a1a1d",
        muted: "#3f3f46",
        "muted-foreground": "#d4d4d8",
      },
      fontFamily: {
        heading: "'Arial Black', 'Helvetica Neue', Arial, sans-serif",
        body: "'Helvetica Neue', Arial, sans-serif",
      },
      spacing: { ...DEFAULT_THEME_TOKENS.spacing, section: "5rem" },
      radius: { ...DEFAULT_THEME_TOKENS.radius, control: "0.25rem", card: "0.5rem" },
    },
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
          backgroundImage: "https://images.unsplash.com/photo-1517963879433-6ad2b056d712?w=700&q=50",
        },
        scrollReveal: true,
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
    theme: {
      ...DEFAULT_THEME_TOKENS,
      color: {
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
      fontFamily: {
        heading: "Futura, 'Century Gothic', 'Segoe UI', sans-serif",
        body: "system-ui, sans-serif",
      },
      spacing: { ...DEFAULT_THEME_TOKENS.spacing, section: "5.5rem" },
      radius: { ...DEFAULT_THEME_TOKENS.radius, card: "0.5rem", control: "0.375rem" },
    },
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
          // No hero image (KAN-1152 thread 1, deliberate restraint): a
          // stock "team at a whiteboard" photo is exactly the cliché this
          // studio's own copy ("not a slide deck") is pushing against —
          // stays text-led on purpose.
        },
        scrollReveal: true,
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
    theme: {
      ...DEFAULT_THEME_TOKENS,
      color: {
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
      fontFamily: {
        heading: "Rockwell, 'Bookman Old Style', Georgia, serif",
        body: "system-ui, sans-serif",
      },
      spacing: { ...DEFAULT_THEME_TOKENS.spacing, section: "5rem" },
      radius: { ...DEFAULT_THEME_TOKENS.radius, card: "1.25rem", control: "9999px" },
    },
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
          backgroundImage: "https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?w=1000&q=55",
        },
        scrollReveal: true,
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
    theme: {
      ...DEFAULT_THEME_TOKENS,
      color: {
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
      fontFamily: {
        heading: "Baskerville, 'Big Caslon', Georgia, serif",
        body: "system-ui, sans-serif",
      },
      spacing: { ...DEFAULT_THEME_TOKENS.spacing, section: "6rem" },
      radius: { ...DEFAULT_THEME_TOKENS.radius, card: "0.25rem", control: "0.25rem" },
    },
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
          // No hero image (KAN-1152 thread 1, deliberate restraint): "Jordan
          // Blake" is a specific named person, and a generic stock portrait
          // would misrepresent them worse than no photo at all — a real
          // photo of this person belongs here once one exists, not a
          // placeholder. Stays minimalist/text-led on purpose.
        },
        scrollReveal: true,
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
    // This template is untouched by KAN-1152 thread 1 (already done,
    // KAN-1128) — its own restrained serif/sans pairing and wider section
    // rhythm are the reference the other 8 templates were revised toward.
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
    ...(b.scrollReveal !== undefined ? { scrollReveal: b.scrollReveal } : {}),
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
