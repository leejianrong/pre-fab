import type { ComponentType } from "react";
import { BlockRegistry, type BlockTypeDefinition } from "@prefab/schema";
import { Hero } from "./hero/Hero.js";
import { heroBlockDefinition, type HeroProps } from "./hero/schema.js";
import { Heading } from "./heading/Heading.js";
import { headingBlockDefinition, type HeadingProps } from "./heading/schema.js";
import { Button } from "./button/Button.js";
import { buttonBlockDefinition, type ButtonProps } from "./button/schema.js";
import { Embed } from "./embed/Embed.js";
import { embedBlockDefinition, type EmbedProps } from "./embed/schema.js";
import { Spacer } from "./spacer/Spacer.js";
import { spacerBlockDefinition, type SpacerProps } from "./spacer/schema.js";
import { RichText } from "./richtext/RichText.js";
import { richTextBlockDefinition, type RichTextProps } from "./richtext/schema.js";
import { Footer } from "./footer/Footer.js";
import { footerBlockDefinition, type FooterProps } from "./footer/schema.js";
import { Nav } from "./nav/Nav.js";
import { navBlockDefinition, type NavProps } from "./nav/schema.js";
import { Testimonial } from "./testimonial/Testimonial.js";
import { testimonialBlockDefinition, type TestimonialProps } from "./testimonial/schema.js";
import { Faq } from "./faq/Faq.js";
import { faqBlockDefinition, type FaqProps } from "./faq/schema.js";
import { ContactDetails } from "./contactdetails/ContactDetails.js";
import { contactdetailsBlockDefinition, type ContactDetailsProps } from "./contactdetails/schema.js";
import { MapEmbed } from "./mapembed/MapEmbed.js";
import { mapembedBlockDefinition, type MapEmbedProps } from "./mapembed/schema.js";
import { Image } from "./image/Image.js";
import { imageBlockDefinition, type ImageProps } from "./image/schema.js";
import { Gallery } from "./gallery/Gallery.js";
import { galleryBlockDefinition, type GalleryProps } from "./gallery/schema.js";
import { Columns } from "./columns/Columns.js";
import { columnsBlockDefinition, type ColumnsProps } from "./columns/schema.js";
import { CardGrid } from "./cardgrid/CardGrid.js";
import { cardGridBlockDefinition, type CardGridProps } from "./cardgrid/schema.js";
import { PostList } from "./postlist/PostList.js";
import { postListBlockDefinition, type PostListProps } from "./postlist/schema.js";
import { PostDetail } from "./postdetail/PostDetail.js";
import { postDetailBlockDefinition, type PostDetailProps } from "./postdetail/schema.js";
import { Form } from "./form/Form.js";
import { formBlockDefinition, type FormProps } from "./form/schema.js";
import { Booking } from "./booking/Booking.js";
import { bookingBlockDefinition, type BookingProps } from "./booking/schema.js";
import { EventSignup } from "./eventsignup/EventSignup.js";
import { eventSignupBlockDefinition, type EventSignupProps } from "./eventsignup/schema.js";
import { Payment } from "./payment/Payment.js";
import { paymentBlockDefinition, type PaymentProps } from "./payment/schema.js";

/**
 * One entry per first-party block: its schema-half definition
 * (@prefab/schema's validate/migrate machinery), its component, and a
 * one-line summary function for `site outline` (R14). Adding a block is
 * adding one entry here — the three exports below (`blockSchemaRegistry`,
 * `blockComponents`, `blockSummaries`) are derived, not hand-maintained in
 * parallel, so they can't drift out of sync with each other.
 */
// Heterogeneous by design — see BlockRegistry's own note in @prefab/schema.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface BlockEntry<P extends Record<string, unknown> = any> {
  definition: BlockTypeDefinition<P>;
  Component: ComponentType<P>;
  summary: (props: P) => string;
}

const BLOCK_ENTRIES: BlockEntry[] = [
  { definition: heroBlockDefinition, Component: Hero, summary: (props: HeroProps) => props.heading },
  { definition: headingBlockDefinition, Component: Heading, summary: (props: HeadingProps) => props.text },
  { definition: buttonBlockDefinition, Component: Button, summary: (props: ButtonProps) => props.label },
  {
    definition: embedBlockDefinition,
    Component: Embed,
    summary: (props: EmbedProps) => (props.html.trim() ? "embedded content" : "empty embed"),
  },
  { definition: spacerBlockDefinition, Component: Spacer, summary: (props: SpacerProps) => `spacer (${props.height})` },
  {
    definition: richTextBlockDefinition,
    Component: RichText,
    summary: (props: RichTextProps) => props.html.slice(0, 60),
  },
  { definition: footerBlockDefinition, Component: Footer, summary: (props: FooterProps) => props.text },
  { definition: navBlockDefinition, Component: Nav, summary: (props: NavProps) => props.brand },
  {
    definition: testimonialBlockDefinition,
    Component: Testimonial,
    summary: (props: TestimonialProps) => props.quote.slice(0, 60),
  },
  { definition: faqBlockDefinition, Component: Faq, summary: (props: FaqProps) => `${props.items.length} FAQ items` },
  {
    definition: contactdetailsBlockDefinition,
    Component: ContactDetails,
    summary: (props: ContactDetailsProps) => props.heading,
  },
  {
    definition: mapembedBlockDefinition,
    Component: MapEmbed,
    summary: (props: MapEmbedProps) => props.query || "no location set",
  },
  { definition: imageBlockDefinition, Component: Image, summary: (props: ImageProps) => props.alt || props.src },
  {
    definition: galleryBlockDefinition,
    Component: Gallery,
    summary: (props: GalleryProps) => `${props.images.length} images`,
  },
  {
    definition: columnsBlockDefinition,
    Component: Columns,
    summary: (props: ColumnsProps) => `${props.count} columns`,
  },
  {
    definition: cardGridBlockDefinition,
    Component: CardGrid,
    summary: (props: CardGridProps) => `${props.cards.length} cards`,
  },
  {
    definition: postListBlockDefinition,
    Component: PostList,
    summary: (props: PostListProps) => `post list (${props.postsPerPage}/page)`,
  },
  {
    definition: postDetailBlockDefinition,
    summary: (_props: PostDetailProps) => "post detail template",
    Component: PostDetail,
  },
  {
    definition: formBlockDefinition,
    Component: Form,
    summary: (props: FormProps) => `form (${props.fields.length} field${props.fields.length === 1 ? "" : "s"})`,
  },
  {
    definition: bookingBlockDefinition,
    Component: Booking,
    summary: (props: BookingProps) => props.heading || "booking widget",
  },
  {
    definition: eventSignupBlockDefinition,
    Component: EventSignup,
    summary: (props: EventSignupProps) => `${props.heading || "event sign-up"} (capacity ${props.capacity ?? "unlimited"})`,
  },
  {
    definition: paymentBlockDefinition,
    Component: Payment,
    summary: (props: PaymentProps) => `${props.heading} (${(props.amount / 100).toFixed(2)} ${props.currency.toUpperCase()})`,
  },
];

/**
 * The schema half, ready to hand to @prefab/schema's validate/migrate
 * functions. Every first-party block registers itself here.
 */
export const blockSchemaRegistry = BLOCK_ENTRIES.reduce(
  (registry, entry) => registry.register(entry.definition),
  new BlockRegistry(),
);

/**
 * The render half. Kept as a plain map rather than folded into the schema
 * registry, because the schema registry must stay importable from packages
 * that do not want React in their dependency graph (e.g. a future CLI-only
 * validation path).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const blockComponents: Record<string, ComponentType<any>> = Object.fromEntries(
  BLOCK_ENTRIES.map((entry) => [entry.definition.type, entry.Component]),
);

/** One-line summary per block type, for `site outline` (R14) — an agent orients without opening every page. */
export const blockSummaries: Record<string, (props: Record<string, unknown>) => string> = Object.fromEntries(
  BLOCK_ENTRIES.map((entry) => [entry.definition.type, entry.summary as (props: Record<string, unknown>) => string]),
);

