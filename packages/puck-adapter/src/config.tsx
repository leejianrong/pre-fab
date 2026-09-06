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
import { ProductGrid, PRODUCTGRID_BLOCK_TYPE, productGridDefaultProps } from "@prefab/blocks";
import { ProductDetail, PRODUCTDETAIL_BLOCK_TYPE, productDetailDefaultProps } from "@prefab/blocks";
import { Form, FORM_BLOCK_TYPE, formDefaultProps } from "@prefab/blocks";
import { Booking, BOOKING_BLOCK_TYPE, bookingDefaultProps } from "@prefab/blocks";
import { EventSignup, EVENTSIGNUP_BLOCK_TYPE, eventSignupDefaultProps } from "@prefab/blocks";
import { Payment, PAYMENT_BLOCK_TYPE, paymentDefaultProps } from "@prefab/blocks";
import { Subscription, SUBSCRIPTION_BLOCK_TYPE, subscriptionDefaultProps } from "@prefab/blocks";
import { CartDrawer, CARTDRAWER_BLOCK_TYPE, cartDrawerDefaultProps } from "@prefab/blocks";
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
import { productGridFields } from "./productgrid-fields.js";
import { productDetailFields } from "./productdetail-fields.js";
import { formFields } from "./form-fields.js";
import { bookingFields } from "./booking-fields.js";
import { eventSignupFields } from "./eventsignup-fields.js";
import { paymentFields } from "./payment-fields.js";
import { subscriptionFields } from "./subscription-fields.js";
import { cartDrawerFields } from "./cartdrawer-fields.js";

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
  /**
   * KAN-1207: a plain unicode glyph/emoji, matching the "no icon font/SVG
   * set loaded" call apps/editor/src/ui/IconButton.tsx already made for
   * this app's own chrome. Puck's `ComponentConfig` (@puckeditor/core
   * 0.23.0) has no icon field — confirmed against its shipped .d.ts, and
   * `label` is typed strictly `string` — so this never reaches Puck itself
   * (`registerBlock` below doesn't forward it into the `ComponentConfig` it
   * builds). It exists purely to be exported as `BLOCK_ICONS`, keyed by
   * `entry.type`, for apps/editor to look up inside the `overrides.drawerItem`
   * render function — the only extension point Puck exposes for a
   * per-component-list-row render.
   */
  icon: string;
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
  { type: HERO_BLOCK_TYPE, label: "Hero", icon: "🦸", fields: heroFields, defaultProps: heroDefaultProps, Component: Hero },
  {
    type: HEADING_BLOCK_TYPE,
    label: "Heading",
    icon: "🔤",
    fields: headingFields,
    defaultProps: headingDefaultProps,
    Component: Heading,
  },
  {
    type: BUTTON_BLOCK_TYPE,
    label: "Button",
    icon: "🔘",
    fields: buttonFields,
    defaultProps: buttonDefaultProps,
    Component: Button,
  },
  {
    type: EMBED_BLOCK_TYPE,
    label: "Embed (raw HTML)",
    icon: "</>",
    fields: embedFields,
    defaultProps: embedDefaultProps,
    Component: Embed,
  },
  {
    type: SPACER_BLOCK_TYPE,
    label: "Spacer",
    icon: "↕",
    fields: spacerFields,
    defaultProps: spacerDefaultProps,
    Component: Spacer,
  },
  {
    type: RICHTEXT_BLOCK_TYPE,
    label: "Rich text",
    icon: "📝",
    fields: richTextFields,
    defaultProps: richTextDefaultProps,
    Component: RichText,
  },
  {
    type: FOOTER_BLOCK_TYPE,
    label: "Footer",
    icon: "🦶",
    fields: footerFields,
    defaultProps: footerDefaultProps,
    Component: Footer,
  },
  { type: NAV_BLOCK_TYPE, label: "Nav", icon: "🧭", fields: navFields, defaultProps: navDefaultProps, Component: Nav },
  {
    type: TESTIMONIAL_BLOCK_TYPE,
    label: "Testimonial",
    icon: "💬",
    fields: testimonialFields,
    defaultProps: testimonialDefaultProps,
    Component: Testimonial,
  },
  { type: FAQ_BLOCK_TYPE, label: "FAQ", icon: "❓", fields: faqFields, defaultProps: faqDefaultProps, Component: Faq },
  {
    type: CONTACTDETAILS_BLOCK_TYPE,
    label: "Contact details",
    icon: "📇",
    fields: contactdetailsFields,
    defaultProps: contactdetailsDefaultProps,
    Component: ContactDetails,
  },
  {
    type: MAPEMBED_BLOCK_TYPE,
    label: "Map embed",
    icon: "🗺️",
    fields: mapembedFields,
    defaultProps: mapembedDefaultProps,
    Component: MapEmbed,
  },
  {
    type: IMAGE_BLOCK_TYPE,
    label: "Image",
    icon: "🖼️",
    fields: imageFields,
    defaultProps: imageDefaultProps,
    Component: Image,
  },
  {
    type: GALLERY_BLOCK_TYPE,
    label: "Gallery",
    icon: "🎞️",
    fields: galleryFields,
    defaultProps: galleryDefaultProps,
    Component: Gallery,
  },
  {
    type: COLUMNS_BLOCK_TYPE,
    label: "Columns",
    icon: "▥",
    fields: columnsFields,
    defaultProps: columnsDefaultProps,
    Component: Columns,
  },
  {
    type: CARDGRID_BLOCK_TYPE,
    label: "Card grid",
    icon: "▦",
    fields: cardGridFields,
    defaultProps: cardGridDefaultProps,
    Component: CardGrid,
  },
  {
    type: POSTLIST_BLOCK_TYPE,
    label: "Post list",
    icon: "📚",
    fields: postListFields,
    defaultProps: postListDefaultProps,
    Component: PostList,
  },
  {
    type: POSTDETAIL_BLOCK_TYPE,
    label: "Post detail",
    icon: "📄",
    fields: postDetailFields,
    defaultProps: postDetailDefaultProps,
    Component: PostDetail,
  },
  {
    type: PRODUCTGRID_BLOCK_TYPE,
    label: "Product grid",
    icon: "🛍️",
    fields: productGridFields,
    defaultProps: productGridDefaultProps,
    Component: ProductGrid,
  },
  {
    type: PRODUCTDETAIL_BLOCK_TYPE,
    label: "Product detail",
    icon: "🏷️",
    fields: productDetailFields,
    defaultProps: productDetailDefaultProps,
    Component: ProductDetail,
  },
  { type: FORM_BLOCK_TYPE, label: "Form", icon: "📋", fields: formFields, defaultProps: formDefaultProps, Component: Form },
  {
    type: BOOKING_BLOCK_TYPE,
    label: "Booking",
    icon: "📅",
    fields: bookingFields,
    defaultProps: bookingDefaultProps,
    Component: Booking,
  },
  {
    type: EVENTSIGNUP_BLOCK_TYPE,
    label: "Event sign-up",
    icon: "🎟️",
    fields: eventSignupFields,
    defaultProps: eventSignupDefaultProps,
    Component: EventSignup,
  },
  {
    type: PAYMENT_BLOCK_TYPE,
    label: "Payment",
    icon: "💳",
    fields: paymentFields,
    defaultProps: paymentDefaultProps,
    Component: Payment,
  },
  {
    type: SUBSCRIPTION_BLOCK_TYPE,
    label: "Subscription",
    icon: "🔁",
    fields: subscriptionFields,
    defaultProps: subscriptionDefaultProps,
    Component: Subscription,
  },
  {
    type: CARTDRAWER_BLOCK_TYPE,
    label: "Cart drawer",
    icon: "🛒",
    fields: cartDrawerFields,
    defaultProps: cartDrawerDefaultProps,
    Component: CartDrawer,
  },
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

// ADR-0014 / KAN-1129: Puck's `overrides` (including `preview`, which
// FreeCanvasPreview replaces) is a prop on the `<Puck>` component itself,
// not part of `Config` — re-exported here so apps/editor's SiteEditor has
// one place (`@prefab/puck-adapter`) to import both the config and the
// override it must pass alongside it, rather than reaching into
// free-canvas.ts directly.
export { FreeCanvasPreview } from "./free-canvas.js";

/** The set of block types the Puck canvas can render — everything else is an "unknown block" (R19). */
export const PUCK_KNOWN_TYPES = new Set(BLOCK_ENTRIES.map((entry) => entry.type));

/**
 * KAN-1207: `type -> icon` lookup for apps/editor's `overrides.drawerItem`
 * (docs/adr/0017). Puck has nowhere on `ComponentConfig` to put this, so it
 * travels out of band from the same `BLOCK_ENTRIES` the Puck config itself
 * is built from — one array stays the single source of truth for a block
 * type's label, icon and default render, rather than a second, separately
 * maintained icon table apps/editor would otherwise have to keep in sync.
 */
export const BLOCK_ICONS: Record<string, string> = Object.fromEntries(BLOCK_ENTRIES.map((entry) => [entry.type, entry.icon]));

/**
 * KAN-1207: `type -> { Component, defaultProps }` for the drawer's hover
 * preview. Every block is already a plain, SSR-safe React component with a
 * `defaultProps` object sitting right here in `BLOCK_ENTRIES` — rendering
 * `<Component {...defaultProps} />` at a small scale is the actual block,
 * not a hand-drawn stand-in, so it can never drift from what dragging the
 * same entry onto the canvas produces. Exported as a slim `{ Component,
 * defaultProps }` pair rather than the whole `BlockEntry` so apps/editor
 * doesn't also pull in each block's Puck `fields` config it has no use for
 * here.
 */
export interface BlockPreview {
  Component: ComponentType<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  defaultProps: Record<string, unknown>;
}
export const BLOCK_PREVIEWS: Record<string, BlockPreview> = Object.fromEntries(
  BLOCK_ENTRIES.map((entry) => [entry.type, { Component: entry.Component, defaultProps: entry.defaultProps }]),
);

/**
 * KAN-1207: the same theme-CSS-variable wrapper `createPuckConfig`'s
 * `root.render` applies inside the canvas (see that function's own comment),
 * exposed standalone so the drawer's hover preview — rendered outside the
 * canvas entirely, in `overrides.drawerItem` — isn't unstyled default black-
 * on-white. Returns a plain `Record<string, string>` (not a typed
 * `CSSProperties`) for the same reason `themeRootStyle` itself does: it's
 * assigned straight into a `style` prop, same as `root.render` already does.
 */
export function previewRootStyle(tokens: ThemeTokens): Record<string, string> {
  return themeRootStyle(resolveThemeTokens(tokens));
}
