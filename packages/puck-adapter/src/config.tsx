import type { ComponentConfig, Config, DefaultRootRenderProps, Fields } from "@puckeditor/core";
import type { ComponentType } from "react";
import { Hero, HERO_BLOCK_TYPE, heroDefaultProps, resolveThemeTokens, themeTokensToStyleVars } from "@prefab/blocks";
import { Heading, HEADING_BLOCK_TYPE, headingDefaultProps } from "@prefab/blocks";
import { Button, BUTTON_BLOCK_TYPE, buttonDefaultProps } from "@prefab/blocks";
import type { ThemeTokens } from "@prefab/schema";
import { heroFields } from "./hero-fields.js";
import { headingFields } from "./heading-fields.js";
import { buttonFields } from "./button-fields.js";

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
        <div style={themeTokensToStyleVars(resolvedTokens)}>{children}</div>
      ),
    },
    components: Object.fromEntries(BLOCK_ENTRIES.map((entry) => [entry.type, registerBlock(entry)])),
  };
}

/** The set of block types the Puck canvas can render — everything else is an "unknown block" (R19). */
export const PUCK_KNOWN_TYPES = new Set(BLOCK_ENTRIES.map((entry) => entry.type));
