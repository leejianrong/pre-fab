import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Hero, heroDefaultProps } from "@prefab/blocks";
import { DEFAULT_THEME_TOKENS } from "@prefab/schema";
import { createPuckConfig } from "../src/config.js";

describe("createPuckConfig", () => {
  it("strips Puck's injected id/puck/editMode before handing props to the block component", () => {
    const config = createPuckConfig(DEFAULT_THEME_TOKENS);
    const heroConfig = config.components?.hero;
    expect(heroConfig).toBeDefined();

    const puckInjectedProps = {
      id: "hero-abc123",
      puck: { renderDropZone: () => null, metadata: {}, isEditing: true, dragRef: null },
      editMode: false,
      ...heroDefaultProps,
    };

    const rendered = renderToStaticMarkup(
      // @ts-expect-error -- render's declared type is Puck's own component signature
      heroConfig!.render!(puckInjectedProps),
    );
    const plain = renderToStaticMarkup(createElement(Hero, heroDefaultProps));

    expect(rendered).toBe(plain);
  });

  it("ships defaultProps and fields matching HeroProps", () => {
    const config = createPuckConfig(DEFAULT_THEME_TOKENS);
    const heroConfig = config.components?.hero;
    expect(heroConfig?.defaultProps).toEqual(heroDefaultProps);
    expect(Object.keys(heroConfig?.fields ?? {}).sort()).toEqual(
      Object.keys(heroDefaultProps).sort(),
    );
  });

  it("wraps the canvas root with the theme's CSS variables, so it resolves the same tokens the published page does", () => {
    const config = createPuckConfig(DEFAULT_THEME_TOKENS);
    const rootRender = config.root?.render;
    expect(rootRender).toBeDefined();

    const html = renderToStaticMarkup(
      // @ts-expect-error -- root render's declared type carries Puck's own root props
      rootRender!({ children: createElement("span", null, "content") }),
    );
    expect(html).toContain(`--pf-color-background:${DEFAULT_THEME_TOKENS.color.background}`);
  });
});
