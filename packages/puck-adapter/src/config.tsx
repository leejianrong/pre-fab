import type { Config, DefaultRootRenderProps } from "@puckeditor/core";
import { Hero, HERO_BLOCK_TYPE, heroDefaultProps, resolveThemeTokens, themeTokensToStyleVars, type HeroProps } from "@prefab/blocks";
import type { ThemeTokens } from "@prefab/schema";
import { heroFields } from "./hero-fields.js";

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
 */
export function createPuckConfig(tokens: ThemeTokens): Config {
  const resolvedTokens = resolveThemeTokens(tokens);
  return {
    root: {
      render: ({ children }: DefaultRootRenderProps) => (
        <div style={themeTokensToStyleVars(resolvedTokens)}>{children}</div>
      ),
    },
    components: {
      [HERO_BLOCK_TYPE]: {
        label: "Hero",
        fields: heroFields,
        defaultProps: heroDefaultProps,
        render: (puckProps) => {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { id, puck, editMode, ...heroProps } = puckProps;
          return <Hero {...(heroProps as HeroProps)} />;
        },
      },
    },
  };
}
