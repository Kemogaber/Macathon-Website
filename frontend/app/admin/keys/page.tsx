"use client";

import {
  createApiKey,
  listApiKeys,
  revokeApiKey,
  type ApiKeyInfo,
  type CreatedApiKey,
} from "@/lib/api";
import { useToast } from "@/lib/toast";
import { useEffect, useState } from "react";

const ADMIN_STORAGE_KEY = "tablex.adminKey";

export default function AdminKeysPage() {
  const [adminKey, setAdminKey] = useState("");
  const [authed, setAuthed] = useState(false);
  const [keys, setKeys] = useState<ApiKeyInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [justCreated, setJustCreated] = useState<CreatedApiKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  // Restore admin key from sessionStorage on mount.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.sessionStorage.getItem(ADMIN_STORAGE_KEY);
    if (stored) {
      setAdminKey(stored);
      void refresh(stored);
    }
  }, []);

  async function refresh(key: string) {
    setLoading(true);
    setError(null);
    try {
      const list = await listApiKeys(key);
      setKeys(list);
      setAuthed(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load keys";
      setError(msg);
      setAuthed(false);
      window.sessionStorage.removeItem(ADMIN_STORAGE_KEY);
    } finally {
      setLoading(false);
    }
  }

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    if (!adminKey.trim()) return;
    window.sessionStorage.setItem(ADMIN_STORAGE_KEY, adminKey.trim());
    await refresh(adminKey.trim());
  }

  function signOut() {
    window.sessionStorage.removeItem(ADMIN_STORAGE_KEY);
    setAdminKey("");
    setAuthed(false);
    setKeys([]);
    setJustCreated(null);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name || creating) return;
    setCreating(true);
    setError(null);
    try {
      const created = await createApiKey(adminKey, name);
      setJustCreated(created);
      setNewName("");
      await refresh(adminKey);
      toast.success("Key created", `${created.name} — copy it now`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Create failed";
      setError(msg);
      toast.error("Create failed", msg);
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(k: ApiKeyInfo) {
    if (!confirm(`Revoke "${k.name}"? Existing clients using this key will stop working.`)) {
      return;
    }
    try {
      await revokeApiKey(adminKey, k.id);
      await refresh(adminKey);
      if (justCreated?.id === k.id) setJustCreated(null);
      toast.success("Key revoked", k.name);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Revoke failed";
      setError(msg);
      toast.error("Revoke failed", msg);
    }
  }

  async function copyKey(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success("Copied", "Key copied to clipboard");
    } catch {
      toast.error("Couldn't copy", "Clipboard blocked — copy manually");
    }
  }

  if (!authed) {
    return (
      <div className="max-w-md mx-auto px-6 py-16">
        <h1 className="text-3xl font-black text-text mb-2">Admin · API keys</h1>
        <p className="text-sm text-muted-2 mb-6">
          Enter the server&apos;s <code className="text-cyan">ADMIN_API_KEY</code> to
          manage consumer API keys. The value is kept in this tab only
          (sessionStorage).
        </p>
        <form onSubmit={handleSignIn} className="glass rounded-2xl p-5 space-y-3">
          <label className="block text-xs font-mono uppercase tracking-wider text-muted">
            Admin key
          </label>
          <input
            type="password"
            value={adminKey}
            onChange={(e) => setAdminKey(e.target.value)}
            placeholder="paste ADMIN_API_KEY…"
            autoFocus
            className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm font-mono text-text outline-none focus:border-cyan/50"
          />
          {error && (
            <p className="text-xs text-red-700 dark:text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={!adminKey.trim() || loading}
            className="w-full px-4 py-2 rounded-xl bg-cyan text-background font-bold text-sm hover:bg-cyan/80 transition-colors glow-cyan disabled:opacity-50"
          >
            {loading ? "Checking…" : "Sign in"}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-6 py-12 space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-black text-text">API keys</h1>
          <p className="text-sm text-muted-2 mt-1">
            Create keys for third parties using the extraction API. Keys are
            shown in plaintext only once.
          </p>
        </div>
        <button
          onClick={signOut}
          className="px-3 py-1.5 rounded-lg border border-border text-muted-2 hover:text-text hover:bg-overlay text-xs font-mono"
        >
          Sign out
        </button>
      </div>

      {justCreated && (
        <div className="glass rounded-2xl p-5 border border-emerald-400/40 bg-emerald-500/5">
          <div className="flex items-center justify-between gap-3 mb-2">
            <div className="text-sm font-bold text-emerald-200 light:text-emerald-700">
              ✓ New key for {justCreated.name}
            </div>
            <button
              onClick={() => setJustCreated(null)}
              className="text-muted-2 hover:text-text text-sm"
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
          <p className="text-xs text-muted-2 mb-2">
            Copy this now — the server stores only a hash, so it cannot be
            shown again.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 break-all bg-input border border-border rounded-lg px-3 py-2 text-xs font-mono text-cyan">
              {justCreated.key}
            </code>
            <button
              onClick={() => copyKey(justCreated.key)}
              className="px-3 py-2 rounded-lg bg-cyan text-background font-bold text-xs"
            >
              Copy
            </button>
          </div>
        </div>
      )}

      <form onSubmit={handleCreate} className="glass rounded-2xl p-5 flex items-end gap-3 flex-wrap">
        <div className="flex-1 min-w-[240px]">
          <label className="block text-xs font-mono uppercase tracking-wider text-muted mb-1">
            New key — name / owner
          </label>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="e.g. Acme Corp"
            maxLength={120}
            className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm font-mono text-text outline-none focus:border-cyan/50"
          />
        </div>
        <button
          type="submit"
          disabled={!newName.trim() || creating}
          className="px-5 py-2 rounded-xl bg-cyan text-background font-bold text-sm hover:bg-cyan/80 transition-colors glow-cyan disabled:opacity-50"
        >
          {creating ? "Creating…" : "Create key"}
        </button>
      </form>

      {error && (
        <p className="text-xs text-red-700 dark:text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      <div className="glass rounded-2xl overflow-hidden">
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <div className="text-sm font-bold text-text">
            Active keys
            <span className="ml-2 text-xs font-mono text-muted">
              {keys.length}
            </span>
          </div>
          <button
            onClick={() => refresh(adminKey)}
            disabled={loading}
            className="text-xs font-mono px-2.5 py-1 rounded-md border border-border text-muted-2 hover:text-text hover:bg-overlay disabled:opacity-30"
          >
            {loading ? "…" : "Refresh"}
          </button>
        </div>
        {keys.length === 0 ? (
          <div className="p-8 text-center text-muted-2 text-sm">
            No keys yet. Create one above.
          </div>
        ) : (
          <table className="w-full text-xs font-mono">
            <thead className="bg-overlay text-muted uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-2">Name</th>
                <th className="text-left px-4 py-2">Prefix</th>
                <th className="text-left px-4 py-2">Created</th>
                <th className="text-left px-4 py-2">Last used</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id} className="border-t border-border">
                  <td className="px-4 py-2 text-text">{k.name}</td>
                  <td className="px-4 py-2 text-cyan">{k.prefix}…</td>
                  <td className="px-4 py-2 text-muted-2">{fmtDate(k.created_at)}</td>
                  <td className="px-4 py-2 text-muted-2">
                    {k.last_used_at ? fmtDate(k.last_used_at) : "—"}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button
                      onClick={() => handleRevoke(k)}
                      className="px-2.5 py-1 rounded-md border border-red-400/40 bg-red-500/10 hover:bg-red-500/20 text-red-200 light:text-red-700"
                    >
                      Revoke
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="text-xs text-muted-2 leading-relaxed">
        <p>
          Consumers authenticate with{" "}
          <code className="text-cyan">Authorization: Bearer &lt;key&gt;</code>{" "}
          or <code className="text-cyan">X-API-Key: &lt;key&gt;</code>. Gating
          is only enforced when the server has{" "}
          <code className="text-cyan">REQUIRE_API_KEY=1</code> set.
        </p>
      </div>
    </div>
  );
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}
