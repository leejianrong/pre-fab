import { useEffect, useState } from "react";
import type { PostDocument, PostStatus } from "@prefab/api-client";
import { api } from "./api.js";

interface DraftForm {
  postId: string | null;
  title: string;
  slug: string;
  date: string;
  author: string;
  tags: string;
  body: string;
  status: PostStatus;
  expectedVersion: number;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function emptyForm(): DraftForm {
  return { postId: null, title: "", slug: "", date: today(), author: "", tags: "", body: "", status: "draft", expectedVersion: 0 };
}

function postToForm(post: PostDocument): DraftForm {
  return {
    postId: post.id,
    title: post.title,
    slug: post.slug,
    date: post.date,
    author: post.author,
    tags: post.tags.join(", "),
    body: post.body,
    status: post.status,
    expectedVersion: post.version,
  };
}

/**
 * Slice 5's blog admin UI — deliberately plain (a form + a list), the same
 * "no new mutation behind the UI where one already exists" spirit as
 * ThemeEditor, since post.create/post.write already do the real work. Body
 * is edited as plain Markdown text, not a rich WYSIWYG widget — matching
 * the file-tree projection's own format (@prefab/schema's post-file.ts) so
 * what's typed here and what a hand-edited `posts/*.md` file holds are the
 * same representation, not two that could drift.
 */
export function BlogPanel({ siteId, onClose }: { siteId: string; onClose: () => void }) {
  const [posts, setPosts] = useState<PostDocument[] | null>(null);
  const [form, setForm] = useState<DraftForm>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const result = await api.listPosts(siteId, { limit: 100 });
    setPosts(result.posts);
  }

  useEffect(() => {
    refresh().catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [siteId]); // eslint-disable-line react-hooks/exhaustive-deps

  function selectPost(post: PostDocument) {
    setForm(postToForm(post));
    setError(null);
  }

  function startNewPost() {
    setForm(emptyForm());
    setError(null);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const tags = form.tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);

      if (form.postId === null) {
        const created = await api.createPost(siteId, {
          title: form.title,
          slug: form.slug || undefined,
          date: form.date,
          author: form.author,
          tags,
          body: form.body,
          status: form.status,
        });
        setForm(postToForm(created));
      } else {
        const saved = await api.writePost(siteId, form.postId, {
          title: form.title,
          slug: form.slug,
          date: form.date,
          author: form.author,
          tags,
          cover: null,
          body: form.body,
          locale: "en",
          status: form.status,
          expectedVersion: form.expectedVersion,
        });
        setForm(postToForm(saved));
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-label="Blog posts"
      style={{ position: "fixed", inset: 0, background: "rgba(15, 23, 42, 0.4)", display: "flex", justifyContent: "flex-end", zIndex: 50 }}
    >
      <div
        style={{
          width: "480px",
          maxWidth: "100%",
          height: "100%",
          background: "white",
          overflowY: "auto",
          padding: "1rem",
          fontFamily: "system-ui, sans-serif",
          boxShadow: "-2px 0 12px rgba(0,0,0,0.1)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", marginBottom: "1rem" }}>
          <h2 style={{ fontSize: "1.125rem", margin: 0, flex: 1 }}>Blog</h2>
          <button onClick={onClose} aria-label="Close blog panel" style={{ border: "none", background: "none", cursor: "pointer" }}>
            ✕
          </button>
        </div>

        {posts === null ? (
          <p>Loading…</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: "0 0 1rem 0", display: "grid", gap: "0.4rem" }}>
            {posts.map((post) => (
              <li key={post.id}>
                <button
                  onClick={() => selectPost(post)}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "0.5rem",
                    border: "1px solid #e2e8f0",
                    borderRadius: "0.375rem",
                    background: form.postId === post.id ? "#eef2ff" : "white",
                    cursor: "pointer",
                  }}
                >
                  <strong>{post.title}</strong>{" "}
                  <span style={{ fontSize: "0.75rem", color: post.status === "published" ? "#16a34a" : "#b45309" }}>
                    ({post.status})
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <button onClick={startNewPost} style={{ marginBottom: "0.75rem", padding: "0.3rem 0.6rem" }}>
          + New post
        </button>

        <form onSubmit={save} style={{ display: "grid", gap: "0.5rem" }}>
          <label htmlFor="blog-post-title">Title</label>
          <input
            id="blog-post-title"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            required
            style={{ width: "100%", padding: "0.4rem", border: "1px solid #e2e8f0", borderRadius: "0.375rem" }}
          />
          <label htmlFor="blog-post-slug">Slug (optional — generated from title if left blank)</label>
          <input
            id="blog-post-slug"
            value={form.slug}
            onChange={(e) => setForm({ ...form, slug: e.target.value })}
            placeholder="auto"
            style={{ width: "100%", padding: "0.4rem", border: "1px solid #e2e8f0", borderRadius: "0.375rem" }}
          />
          <label htmlFor="blog-post-date">Date</label>
          <input
            id="blog-post-date"
            type="date"
            value={form.date}
            onChange={(e) => setForm({ ...form, date: e.target.value })}
            style={{ width: "100%", padding: "0.4rem", border: "1px solid #e2e8f0", borderRadius: "0.375rem" }}
          />
          <label htmlFor="blog-post-author">Author</label>
          <input
            id="blog-post-author"
            value={form.author}
            onChange={(e) => setForm({ ...form, author: e.target.value })}
            style={{ width: "100%", padding: "0.4rem", border: "1px solid #e2e8f0", borderRadius: "0.375rem" }}
          />
          <label htmlFor="blog-post-tags">Tags (comma-separated)</label>
          <input
            id="blog-post-tags"
            value={form.tags}
            onChange={(e) => setForm({ ...form, tags: e.target.value })}
            style={{ width: "100%", padding: "0.4rem", border: "1px solid #e2e8f0", borderRadius: "0.375rem" }}
          />
          <label htmlFor="blog-post-body">Body (Markdown)</label>
          <textarea
            id="blog-post-body"
            value={form.body}
            onChange={(e) => setForm({ ...form, body: e.target.value })}
            rows={8}
            style={{ width: "100%", padding: "0.4rem", border: "1px solid #e2e8f0", borderRadius: "0.375rem", fontFamily: "monospace" }}
          />
          <label htmlFor="blog-post-status">Status</label>
          <select
            id="blog-post-status"
            value={form.status}
            onChange={(e) => setForm({ ...form, status: e.target.value as PostStatus })}
            style={{ width: "100%", padding: "0.4rem", border: "1px solid #e2e8f0", borderRadius: "0.375rem" }}
          >
            <option value="draft">Draft</option>
            <option value="published">Published</option>
          </select>
          <button
            type="submit"
            disabled={saving || form.title.trim() === ""}
            style={{ padding: "0.5rem", background: "#4f46e5", color: "white", border: "none", borderRadius: "0.375rem" }}
          >
            {saving ? "Saving…" : form.postId === null ? "Create post" : "Save post"}
          </button>
          {error ? <p style={{ color: "#dc2626", fontSize: "0.8125rem" }}>{error}</p> : null}
        </form>
      </div>
    </div>
  );
}
