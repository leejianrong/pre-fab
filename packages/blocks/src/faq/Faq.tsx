import type { CSSProperties } from "react";
import { cssVar } from "../theme-css.js";
import { ResponsiveStyle, type BlockRenderProps } from "../responsive.js";
import type { FaqProps } from "./schema.js";

const summaryStyle: CSSProperties = {
  fontSize: cssVar("fontSize", "body"),
  lineHeight: cssVar("lineHeight", "body"),
  fontWeight: "600",
  color: cssVar("color", "foreground"),
  cursor: "pointer",
};

const answerStyle: CSSProperties = {
  color: cssVar("color", "muted-foreground"),
  fontSize: cssVar("fontSize", "sm"),
  lineHeight: cssVar("lineHeight", "sm"),
};

const itemStyle: CSSProperties = {
  padding: `${cssVar("spacing", "sm")} 0`,
  borderBottom: `1px solid ${cssVar("color", "border")}`,
};

/**
 * Native `<details>/<summary>` disclosure widgets — no client state, no JS,
 * stays SSR-safe with zero client JS (ADR-0004), which is exactly right for
 * a static block.
 */
export function Faq(props: FaqProps & BlockRenderProps) {
  const { items, blockId, responsive } = props;

  return (
    <div className="pf-block pf-faq" data-pf-block-type="faq" data-pf-block-id={blockId}>
      <ResponsiveStyle blockId={blockId ?? ""} responsive={responsive ?? {}} />
      {items.map((item, index) => (
        <details key={index} className="pf-faq-item" style={itemStyle}>
          <summary className="pf-faq-question" style={summaryStyle}>
            {item.question}
          </summary>
          <p className="pf-faq-answer" style={answerStyle}>
            {item.answer}
          </p>
        </details>
      ))}
    </div>
  );
}
