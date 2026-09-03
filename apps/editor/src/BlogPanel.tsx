import { useEffect, useState } from "react";
import type { PostDocument, PostStatus } from "@prefab/api-client";
import { api } from "./api.js";
import { Card, DateField, FilledButton, Option, Select, SideSheet, StatusBadge, TextField } from "./ui/index.js";

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
    <SideSheet title="Blog" ariaLabel="Blog posts" closeLabel="Close blog panel" onClose={onClose} width={480}>
      {posts === null ? (
        <p className="pf-supporting-text">Loading…</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "0.4rem" }}>
          {posts.map((post) => (
            <li key={post.id}>
              <Card
                interactive
                variant={form.postId === post.id ? "filled" : "outlined"}
                onClick={() => selectPost(post)}
                style={{ padding: "0.6rem", display: "flex", alignItems: "center", gap: "0.5rem" }}
              >
                <strong style={{ flex: 1 }}>{post.title}</strong>
                <StatusBadge tone={post.status === "published" ? "positive" : "neutral"}>{post.status}</StatusBadge>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <FilledButton type="button" onClick={startNewPost}>
        + New post
      </FilledButton>

      <form onSubmit={save} style={{ display: "grid", gap: "0.75rem" }}>
        <TextField label="Title" value={form.title} onChange={(v) => setForm({ ...form, title: v })} required />
        <TextField
          label="Slug"
          value={form.slug}
          onChange={(v) => setForm({ ...form, slug: v })}
          supportingText="Optional — generated from title if left blank"
        />
        <DateField id="blog-post-date" label="Date" value={form.date} onChange={(v) => setForm({ ...form, date: v })} />
        <TextField label="Author" value={form.author} onChange={(v) => setForm({ ...form, author: v })} />
        <TextField label="Tags (comma-separated)" value={form.tags} onChange={(v) => setForm({ ...form, tags: v })} />
        <TextField label="Body (Markdown)" type="textarea" rows={8} value={form.body} onChange={(v) => setForm({ ...form, body: v })} className="pf-mono-field" />
        <Select label="Status" value={form.status} onChange={(v) => setForm({ ...form, status: v as PostStatus })}>
          <Option value="draft">Draft</Option>
          <Option value="published">Published</Option>
        </Select>
        <FilledButton type="submit" disabled={saving || form.title.trim() === ""}>
          {saving ? "Saving…" : form.postId === null ? "Create post" : "Save post"}
        </FilledButton>
        {error ? <p className="pf-error-text">{error}</p> : null}
      </form>
    </SideSheet>
  );
}
