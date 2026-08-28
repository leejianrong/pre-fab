import type { ComponentConfig, Config, DefaultRootRenderProps, Fields } from "@puckeditor/core";
import type { ComponentType } from "react";
import { Hero, HERO_BLOCK_TYPE, heroDefaultProps, resolveThemeTokens, themeRootStyle } from "@prefab/blocks";
import { Heading, HEADING_BLOCK_TYPE, headingDefaultProps } from "@prefab/blocks";
import { Button, BUTTON_BLOCK_TYPE, buttonDefaultProps } from "@prefab/blocks";
import { Embed, EMBED_BLOCK_TYPE, embedDefaultProps } from "@prefab/blocks";
import { Spacer, SPACER_BLOCK_TYPE, spacerDefaultProps } from "@prefab/blocks";
import { RichText, RICHTEXT_BLOCK_TYPE, richTextDefaultProps } from "@prefab/blocks";
import { Footer, FOOTER_BLOCK_TYPE, footerDefaultProps } from "@prefab/blocks";
import { Nav, NAV_BLOCK_TYPE, navDefaultProps } from "@prefab/blocks";
import { Testimonial, TESTIMONIAL_BLOCK_TYPE, testimonialDefaultProps } from "@prefab/blocks";
import { Faq, FAQ_BLOCK_TYPE, faqDefaultProps } from "@prefab/blocks";
import { ContactDetails, CONTACTDETAILS_BLOCK_TYPE, contactdetailsDefaultProps } from "@prefab/blocks";
import { MapEmbed, MAPEMBED_BLOCK_TYPE, mapembedDefaultProps } from "@prefab/blocks";
import { Image, IMAGE_BLOCK_TYPE, imageDefaultProps } from "@prefab/blocks";
import { Gallery, GALLERY_BLOCK_TYPE, galleryDefaultProps } from "@prefab/blocks";
import { Columns, COLUMNS_BLOCK_TYPE, columnsDefaultProps } from "@prefab/blocks";
import { CardGrid, CARDGRID_BLOCK_TYPE, cardGridDefaultProps } from "@prefab/blocks";
import { PostList, POSTLIST_BLOCK_TYPE, postListDefaultProps } from "@prefab/blocks";
import { PostDetail, POSTDETAIL_BLOCK_TYPE, postDetailDefaultProps } from "@prefab/blocks";
import { Form, FORM_BLOCK_TYPE, formDefaultProps } from "@prefab/blocks";
import type { ThemeTokens } from "@prefab/schema";
import { heroFields } from "./hero-fields.js";
import { headingFields } from "./heading-fields.js";
import { buttonFields } from "./button-fields.js";
import { embedFields } from "./embed-fields.js";
import { spacerFields } from "./spacer-fields.js";
import { richTextFields } from "./richtext-fields.js";
import { footerFields } from "./footer-fields.js";
import { navFields } from "./nav-fields.js";
import { testimonialFields } from "./testimonial-fields.js";
import { faqFields } from "./faq-fields.js";
import { contactdetailsFields } from "./contactdetails-fields.js";
import { mapembedFields } from "./mapembed-fields.js";
import { imageFields } from "./image-fields.js";
import { galleryFields } from "./gallery-fields.js";
import { columnsFields } from "./columns-fields.js";
import { cardGridFields } from "./cardgrid-fields.js";
import { postListFields } from "./postlist-fields.js";
import { postDetailFields } from "./postdetail-fields.js";
import { formFields } from "./form-fields.js";

/**
 * The only file besides apps/editor allowed to import @puckeditor/core
 * (enforced by tools/checks). Its whole job is absorbing Puck's context:
 * Puck injects `id`, `puck` (drop-zone renderer, edit-mode flag, ...) and
 * `editMode` into every render call — none of that reaches @prefab/blocks
 * components, which stay plain, SSR-safe React (ADR-0004).
 *
 * `root.render` wraps everything Puck renders inside the canvas (including
 * inside its default iframe) with the theme's CSS variables, exactly as
 * the published page's own layout does — this is what makes the canvas
 * render the same tokens the live site resolves, the concrete form of the
 * WYSIWYG guarantee this slice tests.
 *
 * Adding a first-party block only ever means adding one entry to
 * BLOCK_ENTRIES below — `registerBlock` is the one place that strips
 * Puck's injected props and forwards the rest to the block component. The
 * canvas deliberately never forwards `id` as `blockId`: there is no
 * per-breakpoint-override widget in this slice's canvas, so what the
 * canvas renders is a block's unconditional base styling, byte-identical
 * to calling the component directly with no id (proven by
 * config.test.tsx) — the published page (@prefab/publish) is what always
 * supplies blockId/responsive.
 */
interface BlockEntry<P extends Record<string, unknown>> {
  type: string;
  label: string;
  fields: Fields<P>;
  defaultProps: P;
  Component: ComponentType<P>;
}

// Heterogeneous by design, same as @prefab/schema's BlockRegistry — each
// entry's Props type differs, so the array element type can't be narrower
// than `any` without being unsound for whichever entry isn't the one you
// happened to pick.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const BLOCK_ENTRIES: BlockEntry<any>[] = [
  { type: HERO_BLOCK_TYPE, label: "Hero", fields: heroFields, defaultProps: heroDefaultProps, Component: Hero },
  {
    type: HEADING_BLOCK_TYPE,
    label: "Heading",
    fields: headingFields,
    defaultProps: headingDefaultProps,
    Component: Heading,
  },
  {
    type: BUTTON_BLOCK_TYPE,
    label: "Button",
    fields: buttonFields,
    defaultProps: buttonDefaultProps,
    Component: Button,
  },
  {
    type: EMBED_BLOCK_TYPE,
    label: "Embed (raw HTML)",
    fields: embedFields,
    defaultProps: embedDefaultProps,
    Component: Embed,
  },
  { type: SPACER_BLOCK_TYPE, label: "Spacer", fields: spacerFields, defaultProps: spacerDefaultProps, Component: Spacer },
  {
    type: RICHTEXT_BLOCK_TYPE,
    label: "Rich text",
    fields: richTextFields,
    defaultProps: richTextDefaultProps,
    Component: RichText,
  },
  { type: FOOTER_BLOCK_TYPE, label: "Footer", fields: footerFields, defaultProps: footerDefaultProps, Component: Footer },
  { type: NAV_BLOCK_TYPE, label: "Nav", fields: navFields, defaultProps: navDefaultProps, Component: Nav },
  {
    type: TESTIMONIAL_BLOCK_TYPE,
    label: "Testimonial",
    fields: testimonialFields,
    defaultProps: testimonialDefaultProps,
    Component: Testimonial,
  },
  { type: FAQ_BLOCK_TYPE, label: "FAQ", fields: faqFields, defaultProps: faqDefaultProps, Component: Faq },
  {
    type: CONTACTDETAILS_BLOCK_TYPE,
    label: "Contact details",
    fields: contactdetailsFields,
    defaultProps: contactdetailsDefaultProps,
    Component: ContactDetails,
  },
  {
    type: MAPEMBED_BLOCK_TYPE,
    label: "Map embed",
    fields: mapembedFields,
    defaultProps: mapembedDefaultProps,
    Component: MapEmbed,
  },
  { type: IMAGE_BLOCK_TYPE, label: "Image", fields: imageFields, defaultProps: imageDefaultProps, Component: Image },
  {
    type: GALLERY_BLOCK_TYPE,
    label: "Gallery",
    fields: galleryFields,
    defaultProps: galleryDefaultProps,
    Component: Gallery,
  },
  {
    type: COLUMNS_BLOCK_TYPE,
    label: "Columns",
    fields: columnsFields,
    defaultProps: columnsDefaultProps,
    Component: Columns,
  },
  {
    type: CARDGRID_BLOCK_TYPE,
    label: "Card grid",
    fields: cardGridFields,
    defaultProps: cardGridDefaultProps,
    Component: CardGrid,
  },
  {
    type: POSTLIST_BLOCK_TYPE,
    label: "Post list",
    fields: postListFields,
    defaultProps: postListDefaultProps,
    Component: PostList,
  },
  {
    type: POSTDETAIL_BLOCK_TYPE,
    label: "Post detail",
    fields: postDetailFields,
    defaultProps: postDetailDefaultProps,
    Component: PostDetail,
  },
  { type: FORM_BLOCK_TYPE, label: "Form", fields: formFields, defaultProps: formDefaultProps, Component: Form },
];

// Puck's ComponentConfig<P> constrains P more tightly than a plain object
// type (it must satisfy Puck's own DefaultComponentProps shape rules) —
// exactly the kind of constraint BlockEntry<any> above already opts out of
// for the same reason the schema registry does. `any` here is the same
// deliberate opt-out, not a narrower type happening to be inconvenient.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function registerBlock(entry: BlockEntry<any>): ComponentConfig<any> {
  return {
    label: entry.label,
    fields: entry.fields,
    defaultProps: entry.defaultProps,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    render: (puckProps: any) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { id, puck, editMode, ...rest } = puckProps;
      return <entry.Component {...rest} />;
    },
  };
}

export function createPuckConfig(tokens: ThemeTokens): Config {
  const resolvedTokens = resolveThemeTokens(tokens);
  return {
    root: {
      render: ({ children }: DefaultRootRenderProps) => (
        <div data-pf-theme-root="" style={themeRootStyle(resolvedTokens)}>
          {children}
        </div>
      ),
    },
    components: Object.fromEntries(BLOCK_ENTRIES.map((entry) => [entry.type, registerBlock(entry)])),
  };
}

/** The set of block types the Puck canvas can render — everything else is an "unknown block" (R19). */
export const PUCK_KNOWN_TYPES = new Set(BLOCK_ENTRIES.map((entry) => entry.type));
