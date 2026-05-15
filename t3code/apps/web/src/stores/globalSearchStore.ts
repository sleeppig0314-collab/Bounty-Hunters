/**
 * globalSearchStore.ts - Zustand store for global search
 *
 * Manages search state, results, and streaming for global search (Ctrl+Shift+F).
 * Searches across: chat messages, files (names + contents), git commits.
 */

import { create } from "zustand";

export type SearchSource = "chat" | "files" | "git";
export type SearchStatus = "idle" | "searching" | "done" | "error";

export interface SearchResult {
  readonly id: string;
  readonly source: SearchSource;
  readonly title: string;        // e.g., "Thread: my thread" or "src/app.ts" or "commit abc123"
  readonly preview: string;      // snippet with matched text highlighted
  readonly url?: string;        // link to navigate to
  readonly lineNumber?: number; // for file search
  readonly matchedTerm: string;
  readonly score: number;       // relevance score
  readonly timestamp?: string;   // for git commits
  readonly author?: string;     // for git commits
}

export interface GlobalSearchState {
  readonly isOpen: boolean;
  readonly query: string;
  readonly status: SearchStatus;
  readonly results: SearchResult[];
  readonly error: string | null;
  readonly regexEnabled: boolean;
  readonly caseSensitive: boolean;
  readonly sources: Set<SearchSource>;
}

export interface GlobalSearchActions {
  open: () => void;
  close: () => void;
  toggle: () => void;
  setQuery: (query: string) => void;
  addResults: (results: SearchResult[]) => void;
  clearResults: () => void;
  setStatus: (status: SearchStatus) => void;
  setError: (error: string | null) => void;
  toggleRegex: () => void;
  toggleCaseSensitive: () => void;
  toggleSource: (source: SearchSource) => void;
  setSources: (sources: Set<SearchSource>) => void;
}

export type GlobalSearchStore = GlobalSearchState & GlobalSearchActions;

let resultIdCounter = 0;

export const useGlobalSearchStore = create<GlobalSearchStore>((set) => ({
  // State
  isOpen: false,
  query: "",
  status: "idle",
  results: [],
  error: null,
  regexEnabled: false,
  caseSensitive: false,
  sources: new Set(["chat", "files", "git"]),

  // Actions
  open: () => set({ isOpen: true, status: "idle", results: [], error: null }),
  close: () => set({ isOpen: false, query: "", status: "idle", results: [], error: null }),
  toggle: () =>
    set((state) =>
      state.isOpen
        ? { isOpen: false, query: "", status: "idle", results: [], error: null }
        : { isOpen: true, status: "idle", results: [], error: null },
    ),

  setQuery: (query) => set({ query, status: query.trim() ? "searching" : "idle" }),

  addResults: (newResults) =>
    set((state) => ({
      results: [...state.results, ...newResults],
      status: "done",
    })),

  clearResults: () => set({ results: [], status: "idle" }),

  setStatus: (status) => set({ status }),

  setError: (error) => set({ error, status: "error" }),

  toggleRegex: () => set((state) => ({ regexEnabled: !state.regexEnabled })),

  toggleCaseSensitive: () => set((state) => ({ caseSensitive: !state.caseSensitive })),

  toggleSource: (source) =>
    set((state) => {
      const next = new Set(state.sources);
      if (next.has(source)) {
        if (next.size > 1) next.delete(source); // keep at least one
      } else {
        next.add(source);
      }
      return { sources: next };
    }),

  setSources: (sources) => set({ sources }),
}));

// ============== Highlight Helper ==============

/**
 * Wraps matched term in <mark> tags for highlighting.
 * Handles both plain text and regex patterns.
 */
export function highlightMatches(text: string, query: string, caseSensitive: boolean): string {
  if (!query.trim()) return text;
  try {
    const flags = caseSensitive ? "g" : "gi";
    const pattern = query;
    const regex = new RegExp(`(${escapeRegex(pattern)})`, flags);
    return text.replace(regex, "<mark>$1</mark>");
  } catch {
    // Invalid regex — fall back to plain text
    return text;
  }
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ============== Query Validation ==============

export interface QueryValidation {
  valid: boolean;
  error?: string;
}

export function validateRegex(query: string, enabled: boolean): QueryValidation {
  if (!enabled) return { valid: true };
  if (!query.trim()) return { valid: true };
  try {
    new RegExp(query);
    return { valid: true };
  } catch (e) {
    return { valid: false, error: `Invalid regex: ${(e as Error).message}` };
  }
}

// ============== Mock Search Results (for demo) ==============

/**
 * Generates mock search results for demonstration.
 * Replace with real API calls to backend endpoints.
 */
export async function searchAll(
  query: string,
  sources: Set<SearchSource>,
  options: { regex: boolean; caseSensitive: boolean },
): Promise<SearchResult[]> {
  // Simulate async search
  await new Promise((r) => setTimeout(r, 300 + Math.random() * 200));

  const results: SearchResult[] = [];
  const q = query.toLowerCase();

  if (sources.has("chat")) {
    // Mock chat results
    if ("thread".includes(q) || "message".includes(q) || "chat".includes(q)) {
      results.push({
        id: `chat-${++resultIdCounter}`,
        source: "chat",
        title: "Thread: Project setup questions",
        preview: "...I was asking about the initial **" + query + "** configuration...",
        url: "/thread/t1",
        matchedTerm: query,
        score: 0.9,
        timestamp: "2026-05-14T10:30:00Z",
      });
    }
    if ("provider".includes(q) || "model".includes(q)) {
      results.push({
        id: `chat-${++resultIdCounter}`,
        source: "chat",
        title: "Thread: Provider configuration",
        preview: "...which " + query + " are you using for the backend?",
        url: "/thread/t2",
        matchedTerm: query,
        score: 0.75,
      });
    }
  }

  if (sources.has("files")) {
    // Mock file results
    if ("config".includes(q) || "package".includes(q)) {
      results.push({
        id: `file-${++resultIdCounter}`,
        source: "files",
        title: "package.json",
        preview: '  "name": "@t3code/server",\n  "version": "0.1.0",',
        url: "/file/package.json",
        lineNumber: 1,
        matchedTerm: query,
        score: 0.85,
      });
    }
    if ("readme".includes(q) || "docs".includes(q)) {
      results.push({
        id: `file-${++resultIdCounter}`,
        source: "files",
        title: "README.md",
        preview: "# " + query + " - T3 Code\n\nWelcome to the project.",
        url: "/file/README.md",
        lineNumber: 1,
        matchedTerm: query,
        score: 0.7,
      });
    }
  }

  if (sources.has("git")) {
    // Mock git results
    if ("commit".includes(q) || "fix".includes(q) || "feat".includes(q)) {
      results.push({
        id: `git-${++resultIdCounter}`,
        source: "git",
        title: "feat: add " + query + " module",
        preview: "Added new module for handling " + query + " functionality",
        url: "/commit/abc123",
        matchedTerm: query,
        score: 0.8,
        timestamp: "2026-05-15T14:20:00Z",
        author: "developer@example.com",
      });
    }
  }

  return results.sort((a, b) => b.score - a.score);
}