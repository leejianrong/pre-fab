import { useEffect, useMemo, useRef, useState } from "react";
import { Puck, type Data } from "@puckeditor/core";
import {
  createPuckConfig,
  pageDocumentToPuckData,
  puckDataToPageDocument,
  PuckIdBridge,
  PUCK_KNOWN_TYPES,
} from "@prefab/puck-adapter";
import { ApiClientError, type PageDocument, type SiteSummary, type ThemeDocument, type ThemeTokens } from "@prefab/api-client";
import type { BlockNode } from "@prefab/schema";
import { UnknownBlockList } from "./UnknownBlockList.js";
import { ThemeEditor } from "./ThemeEditor.js";
import { api } from "./api.js";

type Status = "idle" | "saving" | "saved" | "publishing" | "published";

export function SiteEditor({ siteId, onBack }: { siteId: string; onBack: () => void }) {
  const [site, setSite] = useState<SiteSummary | null>(null);
  const [theme, setTheme] = useState<ThemeDocument | null>(null);
  const [page, setPage] = useState<PageDocument | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

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
  const [themeEditorOpen, setThemeEditorOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [s, t, pages] = await Promise.all([api.getSite(siteId), api.getTheme(siteId), api.listPages(siteId)]);
      const firstPage = pages[0];
      if (!firstPage) throw new Error("this site has no pages yet");
      const p = await api.getPage(siteId, firstPage.id);
      if (cancelled) return;
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

  async function handleSave() {
    if (!page || !latestPuckData.current) return;
    setStatus("saving");
    setError(null);
    try {
      const updatedDoc = puckDataToPageDocument(latestPuckData.current, page, unknownBlocksRef.current, idBridge);
      const saved = await api.writePage(siteId, page.id, {
        title: updatedDoc.title,
        slug: updatedDoc.slug,
        blocks: updatedDoc.blocks,
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
      await api.publish(siteId);
      setStatus("published");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("idle");
    }
  }

  if (error) {
    return (
      <div style={{ padding: "2rem", fontFamily: "system-ui, sans-serif" }}>
        <p style={{ color: "#dc2626" }}>{error}</p>
        <button onClick={onBack}>← Back</button>
      </div>
    );
  }

  if (!site || !theme || !page || !config || !initialPuckData) {
    return <div style={{ padding: "2rem", fontFamily: "system-ui, sans-serif" }}>Loading…</div>;
  }

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", fontFamily: "system-ui, sans-serif" }}>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: "1rem",
          padding: "0.5rem 1rem",
          borderBottom: "1px solid #e2e8f0",
          background: "white",
        }}
      >
        <button onClick={onBack} style={{ border: "none", background: "none", cursor: "pointer" }}>
          ← Sites
        </button>
        <strong>{site.name}</strong>
        <div style={{ flex: 1 }} />
        <button onClick={() => setThemeEditorOpen(true)} style={{ padding: "0.4rem 0.8rem" }}>
          Theme
        </button>
        <button onClick={handleSave} disabled={status === "saving"} style={{ padding: "0.4rem 0.8rem" }}>
          {status === "saving" ? "Saving…" : "Save"}
        </button>
        <button
          onClick={handlePublish}
          disabled={status === "publishing"}
          style={{ padding: "0.4rem 0.8rem", background: "#4f46e5", color: "white", border: "none", borderRadius: "0.25rem" }}
        >
          {status === "publishing" ? "Publishing…" : "Publish"}
        </button>
        {status === "saved" ? <span style={{ color: "#16a34a", fontSize: "0.875rem" }}>Saved</span> : null}
        {status === "published" ? <span style={{ color: "#16a34a", fontSize: "0.875rem" }}>Live</span> : null}
      </header>
      <UnknownBlockList blocks={unknownBlocks} />
      <div style={{ flex: 1, minHeight: 0 }}>
        <Puck
          key={page.id}
          config={config}
          data={initialPuckData}
          onChange={(data) => {
            latestPuckData.current = data;
          }}
        />
      </div>
      {themeEditorOpen ? (
        <ThemeEditor tokens={theme.tokens} onSave={handleSaveTheme} onClose={() => setThemeEditorOpen(false)} />
      ) : null}
    </div>
  );
}
