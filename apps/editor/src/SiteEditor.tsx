import { useEffect, useMemo, useRef, useState } from "react";
import { Puck, type Data } from "@puckeditor/core";
import {
  applyFreePositions,
  createPuckConfig,
  FreeCanvasContext,
  FreeCanvasPreview,
  initialPositionsFromBlocks,
  pageDocumentToPuckData,
  puckDataToPageDocument,
  PuckIdBridge,
  PUCK_KNOWN_TYPES,
} from "@prefab/puck-adapter";
import { ApiClientError, type PageDocument, type SiteSummary, type ThemeDocument, type ThemeTokens } from "@prefab/api-client";
import type { BlockNode, FreeRect, LayoutMode } from "@prefab/schema";
import { UnknownBlockList } from "./UnknownBlockList.js";
import { ThemeEditor } from "./ThemeEditor.js";
import { DomainsPanel } from "./DomainsPanel.js";
import { BlogPanel } from "./BlogPanel.js";
import { SubmissionsPanel } from "./SubmissionsPanel.js";
import { api } from "./api.js";
import {
  Dialog,
  FilledButton,
  IconButton,
  LoadingIndicator,
  OutlinedButton,
  SelectField,
  StatusBadge,
  TextButton,
  TopAppBar,
} from "./ui/index.js";

type Status = "idle" | "saving" | "saved" | "publishing" | "published";

export function SiteEditor({
  siteId,
  firstRun,
  onBack,
}: {
  siteId: string;
  firstRun?: boolean;
  onBack: () => void;
}) {
  const [site, setSite] = useState<SiteSummary | null>(null);
  const [theme, setTheme] = useState<ThemeDocument | null>(null);
  const [page, setPage] = useState<PageDocument | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [showFirstRunBanner, setShowFirstRunBanner] = useState(Boolean(firstRun));
  // Whether this site had ever gone live before this component mounted —
  // set once, from the publish history fetched alongside the page. Drives
  // the one-time celebration below: a site's first publish only, never a
  // republish (SLICES.md: "a guided first edit and a publish celebration
  // moment").
  const hadPublishBefore = useRef(false);
  const [celebration, setCelebration] = useState<{ liveUrl: string } | null>(null);

  // Puck owns live editing state internally once mounted (an "initial
  // value" component, not a fully controlled one) — these track what the
  // canvas holds and what the server last accepted, independently of
  // React re-renders, so a save never resets what the user is mid-editing.
  const idBridge = useRef(new PuckIdBridge()).current;
  const latestPuckData = useRef<Data | null>(null);
  const unknownBlocksRef = useRef<BlockNode[]>([]);
  const expectedVersionRef = useRef(0);
  // Mirrors unknownBlocksRef into render-visible state (R19: "shows a
  // placeholder in the editor") — the ref alone drives handleSave's
  // reconstruction of the document but doesn't itself trigger a re-render.
  const [unknownBlocks, setUnknownBlocks] = useState<BlockNode[]>([]);
  // ADR-0014 / KAN-1129: local UI state only until Save is pressed, same as
  // everything else Puck edits — `layoutMode` starts at the loaded page's
  // own value, and `positions` starts pre-seeded from whatever `position`
  // its root blocks already carry (initialPositionsFromBlocks), so toggling
  // free -> flow -> free within one session doesn't lose a block's last
  // rect even though nothing has been saved in between. The free-canvas
  // overlay (packages/puck-adapter/src/free-canvas.tsx) reads and writes
  // this same `positions` map live via FreeCanvasContext below; handleSave
  // folds it into the saved document via applyFreePositions.
  const [layoutMode, setLayoutMode] = useState<LayoutMode>("flow");
  const [positions, setPositions] = useState<Map<string, FreeRect>>(new Map());
  const [themeEditorOpen, setThemeEditorOpen] = useState(false);
  const [domainsPanelOpen, setDomainsPanelOpen] = useState(false);
  const [blogPanelOpen, setBlogPanelOpen] = useState(false);
  const [submissionsPanelOpen, setSubmissionsPanelOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [s, t, pages, publishes] = await Promise.all([
        api.getSite(siteId),
        api.getTheme(siteId),
        api.listPages(siteId),
        api.listPublishes(siteId),
      ]);
      const firstPage = pages[0];
      if (!firstPage) throw new Error("this site has no pages yet");
      const p = await api.getPage(siteId, firstPage.id);
      if (cancelled) return;
      hadPublishBefore.current = publishes.length > 0;
      setSite(s);
      setTheme(t);
      setPage(p);
      expectedVersionRef.current = p.version;
    })().catch((err) => setError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, [siteId]);

  const config = useMemo(() => (theme ? createPuckConfig(theme.tokens) : null), [theme]);

  // Keyed on page.id only, deliberately — recomputing this on every
  // `page` state change (e.g. after a save) would hand Puck a fresh `data`
  // object and reset whatever the user is mid-editing.
  const initialPuckData = useMemo(() => {
    if (!page) return null;
    const { puckData, unknownBlocks: unknown } = pageDocumentToPuckData(page, PUCK_KNOWN_TYPES);
    unknownBlocksRef.current = unknown;
    return puckData;
  }, [page?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mirrors the ref into state once the memo above has run, so the
  // placeholder list (R19) re-renders when a newly loaded page has
  // unknown-typed blocks — a plain useMemo can't itself trigger a render.
  useEffect(() => {
    setUnknownBlocks(unknownBlocksRef.current);
  }, [page?.id]);

  // ADR-0014 / KAN-1129: (re-)seeds layoutMode/positions whenever a
  // *different* page loads — deliberately keyed on page.id alone, same
  // reasoning as initialPuckData above, so an in-progress toggle (not yet
  // saved) survives whatever re-renders happen while editing this same
  // page, and only resets when the editor actually navigates to another
  // page's document.
  useEffect(() => {
    if (!page) return;
    setLayoutMode(page.layoutMode);
    setPositions(initialPositionsFromBlocks(page.blocks));
  }, [page?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleRectChange(blockId: string, rect: FreeRect) {
    setPositions((prev) => {
      const next = new Map(prev);
      next.set(blockId, rect);
      return next;
    });
  }

  async function handleSave() {
    // ADR-0014 / KAN-1129: `latestPuckData.current` is only ever populated
    // by Puck's own `onChange` — which never fires for a session where the
    // only edits were layoutMode/position (both live entirely in this
    // component's own state, never routed through Puck, by design — see
    // convert.ts's note on why position is kept out of Puck's props). A
    // page opened and immediately repositioned without touching any Puck
    // field would otherwise have `latestPuckData.current` still `null` and
    // silently no-op Save. `initialPuckData` — what Puck was handed at
    // mount and hasn't reported changing — is the correct fallback: nothing
    // about Puck-owned content changed if Puck never said so.
    const puckData = latestPuckData.current ?? initialPuckData;
    if (!page || !puckData) return;
    setStatus("saving");
    setError(null);
    try {
      const updatedDoc = puckDataToPageDocument(puckData, page, unknownBlocksRef.current, idBridge);
      // ADR-0014 / KAN-1129: folds the free-canvas overlay's live
      // `positions` into the blocks Puck's own editing produced — assigning
      // a valid default to any root block that's never had a position (a
      // page just switched to "free", or a block dragged in mid-session)
      // when saving as "free", and stripping `position` from every block
      // when saving as "flow", so this write is always something
      // validatePageDocument accepts.
      const blocks = applyFreePositions(updatedDoc.blocks, layoutMode, positions);
      const saved = await api.writePage(siteId, page.id, {
        title: updatedDoc.title,
        slug: updatedDoc.slug,
        blocks,
        layoutMode,
        expectedVersion: expectedVersionRef.current,
      });
      expectedVersionRef.current = saved.version;
      setStatus("saved");
    } catch (err) {
      if (err instanceof ApiClientError && err.code === "conflict") {
        setError("This page changed elsewhere since you loaded it — reload to see the latest before saving again.");
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
      setStatus("idle");
    }
  }

  // Restyles every block with no document mutation (SLICES.md): only
  // `theme` changes state here, never `page` — `config` above is derived
  // from `theme`, so the Puck canvas re-renders the *same* document
  // through new CSS variables the moment this resolves.
  async function handleSaveTheme(tokens: ThemeTokens) {
    const saved = await api.updateTheme(siteId, tokens);
    setTheme(saved);
  }

  async function handlePublish() {
    setStatus("publishing");
    setError(null);
    try {
      const result = await api.publish(siteId);
      setStatus("published");
      if (!hadPublishBefore.current) {
        hadPublishBefore.current = true;
        setCelebration({ liveUrl: api.resolveUrl(result.liveUrl) });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("idle");
    }
  }

  if (error) {
    return (
      <div style={{ padding: "2rem" }}>
        <p className="pf-error-text">{error}</p>
        <TextButton onClick={onBack}>← Back</TextButton>
      </div>
    );
  }

  if (!site || !theme || !page || !config || !initialPuckData) {
    return <LoadingIndicator label="Loading…" />;
  }

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <TopAppBar
        leading={
          <TextButton onClick={onBack}>← Sites</TextButton>
        }
        title={<strong>{site.name}</strong>}
        actions={
          <>
            <OutlinedButton onClick={() => setThemeEditorOpen(true)}>Theme</OutlinedButton>
            <OutlinedButton onClick={() => setDomainsPanelOpen(true)}>Domains</OutlinedButton>
            <OutlinedButton onClick={() => setBlogPanelOpen(true)}>Blog</OutlinedButton>
            <OutlinedButton onClick={() => setSubmissionsPanelOpen(true)}>Submissions</OutlinedButton>
            {/* ADR-0014 / KAN-1129: local UI state only until Save — switching
                to "free" (or back to "flow") never touches the document until
                handleSave runs applyFreePositions over whatever this is set
                to at that moment. */}
            <SelectField
              label="Layout"
              id="layout-mode"
              value={layoutMode}
              onChange={(value) => setLayoutMode(value as LayoutMode)}
            >
              <option value="flow">Flow</option>
              <option value="free">Free (canvas)</option>
            </SelectField>
            <OutlinedButton onClick={handleSave} disabled={status === "saving"}>
              {status === "saving" ? "Saving…" : "Save"}
            </OutlinedButton>
            <FilledButton onClick={handlePublish} disabled={status === "publishing"}>
              {status === "publishing" ? "Publishing…" : "Publish"}
            </FilledButton>
            {status === "saved" ? <StatusBadge tone="positive">Saved</StatusBadge> : null}
            {status === "published" ? <StatusBadge tone="positive">Live</StatusBadge> : null}
          </>
        }
      />
      {showFirstRunBanner ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.75rem",
            padding: "0.5rem 1rem",
            background: "var(--md-sys-color-tertiary-container)",
            color: "var(--md-sys-color-on-tertiary-container)",
            borderBottom: "1px solid var(--md-sys-color-outline-variant)",
            fontFamily: "var(--md-ref-typeface-plain)",
            fontSize: "var(--md-sys-typescale-body-medium-size)",
          }}
        >
          <span style={{ flex: 1 }}>
            👋 Try editing the heading below, then hit <strong>Publish</strong> to make your site live.
          </span>
          <IconButton aria-label="Dismiss" onClick={() => setShowFirstRunBanner(false)}>
            ✕
          </IconButton>
        </div>
      ) : null}
      <UnknownBlockList blocks={unknownBlocks} />
      <div style={{ flex: 1, minHeight: 0 }}>
        <FreeCanvasContext.Provider value={{ layoutMode, positions, onRectChange: handleRectChange, idBridge }}>
          <Puck
            key={page.id}
            config={config}
            data={initialPuckData}
            overrides={{ preview: FreeCanvasPreview }}
            onChange={(data) => {
              latestPuckData.current = data;
            }}
          />
        </FreeCanvasContext.Provider>
      </div>
      {themeEditorOpen ? (
        <ThemeEditor tokens={theme.tokens} onSave={handleSaveTheme} onClose={() => setThemeEditorOpen(false)} />
      ) : null}
      {domainsPanelOpen ? <DomainsPanel siteId={siteId} onClose={() => setDomainsPanelOpen(false)} /> : null}
      {blogPanelOpen ? <BlogPanel siteId={siteId} onClose={() => setBlogPanelOpen(false)} /> : null}
      {submissionsPanelOpen ? <SubmissionsPanel siteId={siteId} page={page} onClose={() => setSubmissionsPanelOpen(false)} /> : null}
      <Dialog open={celebration !== null} onClose={() => setCelebration(null)} ariaLabel="Site published">
        <h2 className="pf-dialog-headline">🎉 Your site is live!</h2>
        <p className="pf-supporting-text">
          {celebration ? (
            <a href={celebration.liveUrl} target="_blank" rel="noreferrer">
              {celebration.liveUrl}
            </a>
          ) : null}
        </p>
        <div className="pf-dialog-actions">
          <FilledButton onClick={() => setCelebration(null)}>Keep editing</FilledButton>
        </div>
      </Dialog>
    </div>
  );
}
