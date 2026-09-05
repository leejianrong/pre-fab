import {
  createContext,
  useContext,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { usePuck } from "@puckeditor/core";
import type { FreeRect } from "@prefab/schema";
import type { PuckIdBridge } from "./id-bridge.js";
import {
  angleFromCenter,
  moveRectBy,
  resolveFreeRect,
  resizeRectBy,
  rotateRectTo,
  type ResizeHandle,
} from "./free-layout.js";

/**
 * ADR-0014 / KAN-1129 "Canvas (Puck adapter)": the free-positioning
 * overlay's live-editing state — everything Puck's own `Data`/`usePuck`
 * doesn't carry, since `position` deliberately never becomes a Puck prop
 * (see convert.ts). Provided by apps/editor's SiteEditor around its
 * `<Puck>` element; consumed by FreeCanvasPreview below, which Puck invokes
 * as its `overrides.preview` render function regardless of layoutMode — so
 * a page with no provider, or a "flow" page, always falls through to
 * Puck's own untouched rendering (`children`), never this overlay.
 */
export interface FreeCanvasContextValue {
  layoutMode: "flow" | "free";
  /** Live rect per root block id, in this editing session. Source of truth for both the overlay's rendering and the save-path merge (free-layout.ts's applyFreePositions). */
  positions: Map<string, FreeRect>;
  onRectChange: (blockId: string, rect: FreeRect) => void;
  /** Same bridge SiteEditor's save path uses — resolving a Puck-content item's raw id to our block id must be consistent across both, or the two would disagree on which block a live-edited rect belongs to. */
  idBridge: PuckIdBridge;
}

export const FreeCanvasContext = createContext<FreeCanvasContextValue | null>(null);

interface DragState {
  mode: "move" | "rotate" | ResizeHandle;
  startClientX: number;
  startClientY: number;
  startRect: FreeRect;
  containerRect: DOMRect;
  moved: boolean;
}

const HANDLE_SIZE = 10;

function resizeHandleStyle(handle: ResizeHandle): CSSProperties {
  const half = HANDLE_SIZE / 2;
  const base: CSSProperties = {
    position: "absolute",
    width: HANDLE_SIZE,
    height: HANDLE_SIZE,
    background: "var(--md-sys-color-primary, #6750a4)",
    border: "1px solid white",
    borderRadius: 2,
    boxSizing: "border-box",
  };
  const top = handle === "nw" || handle === "ne";
  const left = handle === "nw" || handle === "sw";
  return {
    ...base,
    top: top ? -half : undefined,
    bottom: top ? undefined : -half,
    left: left ? -half : undefined,
    right: left ? undefined : -half,
    cursor: handle === "nw" || handle === "se" ? "nwse-resize" : "nesw-resize",
  };
}

const ROTATE_HANDLE_STYLE: CSSProperties = {
  position: "absolute",
  top: -28,
  left: "50%",
  transform: "translateX(-50%)",
  width: HANDLE_SIZE,
  height: HANDLE_SIZE,
  borderRadius: "50%",
  background: "var(--md-sys-color-secondary, #625b71)",
  border: "1px solid white",
  cursor: "grab",
};

function clampField(name: keyof FreeRect, value: number): number {
  if (name === "rotate") return Math.min(180, Math.max(-180, value));
  if (name === "opacity") return Math.min(1, Math.max(0, value));
  return Math.min(100, Math.max(0, value));
}

/**
 * The accessible, keyboard/Playwright-friendly alternative to pure pointer
 * drag the brief calls out explicitly: numeric x/y/w/h/rotate fields plus
 * an opacity slider for whichever block is currently selected. Also just a
 * more precise way to nudge a value than a mouse drag, independent of test
 * concerns.
 */
function FreeCanvasToolbar({
  blockId,
  rect,
  onRectChange,
}: {
  blockId: string;
  rect: FreeRect;
  onRectChange: (rect: FreeRect) => void;
}) {
  function numberField(name: "x" | "y" | "w" | "h" | "rotate", label: string, min: number, max: number) {
    return (
      <label
        key={name}
        style={{ display: "flex", flexDirection: "column", fontSize: 10, gap: 2, color: "var(--md-sys-color-on-surface, #1d1b20)" }}
      >
        {label}
        <input
          type="number"
          min={min}
          max={max}
          step={1}
          value={Math.round(rect[name] * 100) / 100}
          data-pf-free-field={name}
          aria-label={`${label} for positioned block`}
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => {
            const value = Number(e.target.value);
            if (Number.isNaN(value)) return;
            onRectChange({ ...rect, [name]: clampField(name, value) });
          }}
          style={{ width: 52 }}
        />
      </label>
    );
  }

  return (
    <div
      data-pf-free-toolbar={blockId}
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        position: "absolute",
        top: -40,
        left: 0,
        display: "flex",
        gap: 6,
        alignItems: "flex-end",
        background: "var(--md-sys-color-surface-container-highest, #ffffff)",
        padding: "4px 6px",
        borderRadius: 4,
        boxShadow: "0 1px 4px rgba(0,0,0,0.25)",
        zIndex: 20,
        whiteSpace: "nowrap",
      }}
    >
      {numberField("x", "X%", 0, 100)}
      {numberField("y", "Y%", 0, 100)}
      {numberField("w", "W%", 1, 100)}
      {numberField("h", "H%", 1, 100)}
      {numberField("rotate", "Rotate°", -180, 180)}
      <label style={{ display: "flex", flexDirection: "column", fontSize: 10, gap: 2 }}>
        Opacity
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={rect.opacity}
          data-pf-free-field="opacity"
          aria-label="Opacity for positioned block"
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => onRectChange({ ...rect, opacity: Number(e.target.value) })}
        />
      </label>
    </div>
  );
}

function FreeCanvasBlock({
  blockId,
  rect,
  selected,
  onSelect,
  onRectChange,
  children,
}: {
  blockId: string;
  rect: FreeRect;
  selected: boolean;
  onSelect: () => void;
  onRectChange: (rect: FreeRect) => void;
  children: ReactNode;
}) {
  const dragState = useRef<DragState | null>(null);

  function beginDrag(e: ReactPointerEvent<HTMLDivElement>, mode: DragState["mode"]) {
    e.stopPropagation();
    const container = (e.currentTarget.closest("[data-pf-free-canvas]") as HTMLElement | null) ?? e.currentTarget.parentElement;
    const containerRect = container?.getBoundingClientRect();
    if (!containerRect) return;
    dragState.current = {
      mode,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startRect: rect,
      containerRect,
      moved: false,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onDragMove(e: ReactPointerEvent<HTMLDivElement>) {
    const state = dragState.current;
    if (!state) return;
    const dxPx = e.clientX - state.startClientX;
    const dyPx = e.clientY - state.startClientY;
    if (Math.abs(dxPx) > 3 || Math.abs(dyPx) > 3) state.moved = true;
    const dxPct = (dxPx / state.containerRect.width) * 100;
    const dyPct = (dyPx / state.containerRect.height) * 100;

    if (state.mode === "move") {
      onRectChange(moveRectBy(state.startRect, dxPct, dyPct));
    } else if (state.mode === "rotate") {
      const centerX = state.containerRect.left + ((state.startRect.x + state.startRect.w / 2) / 100) * state.containerRect.width;
      const centerY = state.containerRect.top + ((state.startRect.y + state.startRect.h / 2) / 100) * state.containerRect.height;
      onRectChange(rotateRectTo(state.startRect, angleFromCenter(centerX, centerY, e.clientX, e.clientY)));
    } else {
      onRectChange(resizeRectBy(state.startRect, state.mode, dxPct, dyPct));
    }
  }

  function endDrag(e: ReactPointerEvent<HTMLDivElement>) {
    const state = dragState.current;
    dragState.current = null;
    if (state && !state.moved) onSelect();
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  }

  return (
    <div
      data-pf-free-block={blockId}
      role="group"
      aria-label="Positioned block"
      aria-selected={selected}
      onPointerDown={(e) => beginDrag(e, "move")}
      onPointerMove={onDragMove}
      onPointerUp={endDrag}
      // Puck's own canvas wrapper has a plain `onClick` (not pointer-event)
      // deselect-on-click-outside handler keyed on `data-puck-component`/
      // `data-puck-dropzone` (packages/core's Preview/Canvas component) —
      // our blocks carry neither attribute, so without this the click
      // event this component's own pointerdown/pointerup already handled
      // would otherwise keep bubbling past it and immediately clear the
      // selection setUi just made.
      onClick={(e) => e.stopPropagation()}
      style={{
        position: "absolute",
        left: `${rect.x}%`,
        top: `${rect.y}%`,
        width: `${rect.w}%`,
        height: `${rect.h}%`,
        transform: `rotate(${rect.rotate}deg)`,
        transformOrigin: "center",
        opacity: rect.opacity,
        boxSizing: "border-box",
        outline: selected ? "2px solid var(--md-sys-color-primary, #6750a4)" : "1px dashed rgba(0,0,0,0.25)",
        cursor: "move",
        touchAction: "none",
      }}
    >
      <div style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}>{children}</div>
      {selected
        ? (["nw", "ne", "sw", "se"] as const).map((handle) => (
            <div
              key={handle}
              data-pf-resize-handle={handle}
              onPointerDown={(e) => beginDrag(e, handle)}
              onPointerMove={onDragMove}
              onPointerUp={endDrag}
              style={{ ...resizeHandleStyle(handle), touchAction: "none" }}
            />
          ))
        : null}
      {selected ? (
        <div
          data-pf-rotate-handle=""
          onPointerDown={(e) => beginDrag(e, "rotate")}
          onPointerMove={onDragMove}
          onPointerUp={endDrag}
          style={{ ...ROTATE_HANDLE_STYLE, touchAction: "none" }}
        />
      ) : null}
      {selected ? <FreeCanvasToolbar blockId={blockId} rect={rect} onRectChange={onRectChange} /> : null}
    </div>
  );
}

/**
 * Puck's own internal root-zone id (`packages/core/lib/root-droppable-id`,
 * not part of its public export surface). Used only as the last-resort
 * fallback for inserting the very first block onto an empty "free" page,
 * where there is no existing item to read a real zone id off of via the
 * public `getSelectorForId` API below. Puck's version is pinned exactly
 * (CLAUDE.md) specifically because internals like this one can move
 * between minors — if this ever needs to change, it broke because that pin
 * moved, not silently.
 */
const ROOT_ZONE_FALLBACK = "root:default-zone";

/**
 * Puck's normal drag-from-drawer insertion relies on a DropZone as the
 * actual dnd-kit drop target — which this override's replacement preview
 * does not render while `layoutMode === "free"` (see FreeCanvasPreview).
 * This is the free-canvas's own equivalent: pick a registered block type,
 * append it via Puck's public `dispatch({type: "insert", ...})` action
 * (the same action a successful drawer-drag would have dispatched), and
 * FreeCanvasPreview picks up the new content item next render with a
 * default rect, same as it would for any other not-yet-positioned block.
 */
function AddBlockControl({
  types,
  onAdd,
}: {
  types: string[];
  onAdd: (componentType: string) => void;
}) {
  const [selected, setSelected] = useState(types[0] ?? "");
  if (types.length === 0) return null;
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", padding: "6px 8px", fontSize: 12 }}>
      <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
        Add block
        <select
          aria-label="Block type to add"
          data-pf-free-add-type=""
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
        >
          {types.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
      </label>
      <button type="button" data-pf-free-add-button="" onClick={() => onAdd(selected)}>
        Add
      </button>
    </div>
  );
}

/**
 * Puck `overrides.preview` implementation (config.tsx wires this in for
 * every page, unconditionally — the mode check below is what keeps a
 * "flow" page byte-identical to Puck's own rendering). Replaces Puck's
 * list-based drop-zone preview with an absolute-position canvas for
 * root-level blocks when `layoutMode === "free"`, per ADR-0014's "Canvas
 * (Puck adapter)" section: drag-to-move, resize handles and a rotate
 * control write straight into this component's own state (via
 * FreeCanvasContext), never through Puck's internal DnD reducer. Puck
 * still owns the properties inspector and undo/redo — clicking a block
 * here dispatches `setUi` to select it, exactly as clicking it in Puck's
 * own list view would, so its Fields panel (rendered elsewhere in Puck's
 * chrome, untouched by this override) edits that block's props as normal.
 */
export function FreeCanvasPreview({ children }: { children: ReactNode }) {
  const ctx = useContext(FreeCanvasContext);
  const { appState, config, dispatch, getSelectorForId } = usePuck();

  if (!ctx || ctx.layoutMode !== "free") {
    return <>{children}</>;
  }

  const content = appState.data.content;
  const total = content.length;
  const selectedIndex = appState.ui.itemSelector?.index;
  const availableTypes = Object.keys(config.components ?? {});

  function handleAdd(componentType: string) {
    const lastItem = content[content.length - 1];
    const lastId = lastItem ? ctx?.idBridge.resolve((lastItem.props as { id: string }).id) : undefined;
    const lastSelector = lastId ? getSelectorForId(lastId) : undefined;
    const destinationZone = lastSelector?.zone ?? ROOT_ZONE_FALLBACK;
    dispatch({
      type: "insert",
      componentType,
      destinationZone,
      destinationIndex: content.length,
    });
  }

  const canvas = (
    <div>
      <AddBlockControl types={availableTypes} onAdd={handleAdd} />
      <div
        data-pf-free-canvas=""
        style={{
          position: "relative",
          width: "100%",
          minHeight: 560,
          background: "var(--md-sys-color-surface-container-low, #f2f2f2)",
          overflow: "hidden",
        }}
      >
        {content.map((item, index) => {
          const rawId = (item.props as { id: string }).id;
          const blockId = ctx.idBridge.resolve(rawId);
          const rect = resolveFreeRect(blockId, index, total, ctx.positions, new Map());
          const componentConfig = config.components?.[item.type];
          return (
            <FreeCanvasBlock
              key={blockId}
              blockId={blockId}
              rect={rect}
              selected={selectedIndex === index}
              onSelect={() => {
                const selector = getSelectorForId(blockId);
                if (selector) dispatch({ type: "setUi", ui: { itemSelector: selector } });
              }}
              onRectChange={(next) => ctx.onRectChange(blockId, next)}
            >
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any -- same heterogeneous-registry cast config.tsx's registerBlock already makes */}
              {componentConfig?.render ? (componentConfig.render as any)(item.props) : null}
            </FreeCanvasBlock>
          );
        })}
      </div>
    </div>
  );

  // Puck's own preview (`Preview2`, the `children` this component receives
  // in "flow" mode) is what normally invokes `config.root.render` to wrap
  // the canvas with the theme's CSS custom properties
  // (packages/puck-adapter/src/config.tsx's `data-pf-theme-root`) — since
  // "free" mode never renders `children` (that's also what supplies Puck's
  // iframe wrapper; see the FRICTION note in this slice's PR body), this
  // component must invoke that same root render itself, or every block on
  // a "free" page would render with none of the theme's tokens in scope.
  const rootRender = config.root?.render;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- DefaultRootRenderProps carries more than {children}, all optional; a real Config's root.render (config.tsx) only reads `children`.
  return rootRender ? (rootRender as any)({ children: canvas }) : canvas;
}
