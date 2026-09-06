import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Hero, heroDefaultProps, blockSchemaRegistry } from "@prefab/blocks";
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

  it("registers a Puck config entry for every block type in @prefab/blocks' schema registry", () => {
    // Regression check for KAN-1244/KAN-1245: a block can be fully wired
    // into @prefab/blocks' registry.ts (schema, component, CLI/API/MCP
    // parity) and still be un-placeable in the editor canvas if nobody
    // added the matching entry to this package's BLOCK_ENTRIES. Comparing
    // against blockSchemaRegistry.types() — the schema half's own list of
    // every registered block type — catches that gap without needing to
    // know each block type's name up front.
    const config = createPuckConfig(DEFAULT_THEME_TOKENS);
    const registeredTypes = blockSchemaRegistry.types().sort();
    const puckTypes = Object.keys(config.components ?? {}).sort();
    expect(puckTypes).toEqual(registeredTypes);
  });
});
