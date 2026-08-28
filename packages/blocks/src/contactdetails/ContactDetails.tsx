import type { CSSProperties } from "react";
import { cssVar } from "../theme-css.js";
import { ResponsiveStyle, type BlockRenderProps } from "../responsive.js";
import type { ContactDetailsProps } from "./schema.js";

const rowStyle: CSSProperties = {
  padding: `${cssVar("spacing", "xs")} 0`,
  color: cssVar("color", "foreground"),
};

export function ContactDetails(props: ContactDetailsProps & BlockRenderProps) {
  const { heading, email, phone, address, blockId, responsive } = props;

  return (
    <div
      className="pf-block pf-contactdetails"
      data-pf-block-type="contactdetails"
      data-pf-block-id={blockId}
    >
      <ResponsiveStyle blockId={blockId ?? ""} responsive={responsive ?? {}} />
      <h3
        className="pf-contactdetails-heading"
        style={{ fontSize: cssVar("fontSize", "lg"), color: cssVar("color", "foreground"), margin: 0 }}
      >
        {heading}
      </h3>
      {email ? (
        <div className="pf-contactdetails-email" style={rowStyle}>
          <a href={`mailto:${email}`} style={{ color: cssVar("color", "accent") }}>
            {email}
          </a>
        </div>
      ) : null}
      {phone ? (
        <div className="pf-contactdetails-phone" style={rowStyle}>
          <a href={`tel:${phone}`} style={{ color: cssVar("color", "accent") }}>
            {phone}
          </a>
        </div>
      ) : null}
      {address ? (
        <div className="pf-contactdetails-address" style={{ ...rowStyle, whiteSpace: "pre-line" }}>
          {address}
        </div>
      ) : null}
    </div>
  );
}
