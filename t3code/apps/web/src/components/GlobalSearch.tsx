/**
 * GlobalSearch.tsx - Global search overlay component
 *
 * Opens with Ctrl+Shift+F (or Cmd+Shift+F on Mac).
 * Searches across chat messages, file names/contents, and git commits.
 * Displays results grouped by source with highlighted matched terms.
 */

import {
  ArrowDownIcon,
  ArrowUpIcon,
  FileIcon,
  FileTextIcon,
  GitCommitIcon,
  HashIcon,
  MessageSquareIcon,
  RefreshCwIcon,
  SearchIcon,
  SettingsIcon,
  XIcon,
} from "lucide-react";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type KeyboardEvent,
} from "react";

import {
  searchAll,
  useGlobalSearchStore,
  validateQuery,
  highlightMatches,
  type GlobalSearchStore,
  type SearchResult,
  type SearchSource,
} from "../stores/globalSearchStore.ts";

// ============== Source Icons ==============

const SOURCE_CONFIG: Record<SearchSource, { label: string; icon: React.ReactNode; color: string }> = {
  chat: { label: "Chat", icon: <MessageSquareIcon size={14} />, color: "text-blue-600 bg-blue-50" },
  files: { label: "Files", icon: <FileIcon size={14} />, color: "text-green-600 bg-green-50" },
  git: { label: "Git", icon: <GitCommitIcon size={14} />, color: "text-orange-600 bg-orange-50" },
};

// ============== Highlighted Text ==============

function HighlightedText({ text, query, caseSensitive }: { text: string; query: string; caseSensitive: boolean }) {
  const html = useMemo(
    () => highlightMatches(text, query, caseSensitive),
    [text, query, caseSensitive],
  );
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}

// ============== Result Item ==============

function ResultItem({ result, isSelected, onClick }: { result: SearchResult; isSelected: boolean; onClick: () => void }) {
  const config = SOURCE_CONFIG[result.source];
  const { query, caseSensitive } = useGlobalSearchStore();

  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-2.5 rounded-lg flex items-start gap-3 transition-colors ${
        isSelected ? "bg-blue-100 ring-1 ring-blue-300" : "hover:bg-gray-50"
      }`}
    >
      {/* Source icon */}
      <div className={`flex-shrink-0 w-7 h-7 rounded flex items-center justify-center mt-0.5 ${config.color}`}>
        {config.icon}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${config.color}`}>
            {config.label}
          </span>
          {result.lineNumber !== undefined && (
            <span className="text-xs text-gray-400">:{result.lineNumber}</span>
          )}
        </div>
        <p className="text-sm font-medium text-gray-900 mt-0.5 truncate">
          <HighlightedText text={result.title} query={query} caseSensitive={caseSensitive} />
        </p>
        <p className="text-xs text-gray-500 mt-0.5 font-mono leading-relaxed line-clamp-2">
          <HighlightedText text={result.preview} query={query} caseSensitive={caseSensitive} />
        </p>
        {result.author && (
          <p className="text-xs text-gray-400 mt-1">
            {result.author} · {result.timestamp ? new Date(result.timestamp).toLocaleDateString() : ""}
          </p>
        )}
      </div>

      {/* Arrow */}
      <ArrowUpIcon size={14} className="flex-shrink-0 text-gray-300 mt-1" />
    </button>
  );
}

// ============== Source Filters ==============

function SourceFilters() {
  const { sources, toggleSource } = useGlobalSearchStore();
  return (
    <div className="flex items-center gap-1">
      {(Object.keys(SOURCE_CONFIG) as SearchSource[]).map((source) => {
        const config = SOURCE_CONFIG[source];
        const active = sources.has(source);
        return (
          <button
            key={source}
            onClick={() => toggleSource(source)}
            className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium transition-colors ${
              active ? config.color : "text-gray-400 bg-gray-100 hover:bg-gray-200"
            }`}
            title={`Toggle ${config.label} search`}
          >
            {config.icon}
            {config.label}
          </button>
        );
      })}
    </div>
  );
}

// ============== Toggle Buttons ==============

function ToggleButton({ label, active, onClick, title }: { label: string; active: boolean; onClick: () => void; title: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`px-2 py-1 rounded text-xs font-mono transition-colors ${
        active ? "bg-blue-100 text-blue-700 ring-1 ring-blue-300" : "text-gray-400 hover:bg-gray-100"
      }`}
    >
      {label}
    </button>
  );
}

// ============== Grouped Results ==============

function GroupedResults({ results }: { results: SearchResult[] }) {
  // Group by source
  const groups = useMemo(() => {
    const map = new Map<SearchSource, SearchResult[]>();
    for (const r of results) {
      if (!map.has(r.source)) map.set(r.source, []);
      map.get(r.source)!.push(r);
    }
    return map;
  }, [results]);

  const groupOrder: SearchSource[] = ["chat", "files", "git"];

  return (
    <div className="flex-1 overflow-y-auto">
      {groupOrder.map((source) => {
        const items = groups.get(source);
        if (!items?.length) return null;
        const config = SOURCE_CONFIG[source];
        return (
          <div key={source} className="mb-4">
            {/* Group header */}
            <div className="flex items-center gap-2 px-3 py-1.5 sticky top-0 bg-white border-b border-gray-100">
              <span className={`text-xs font-semibold ${config.color}`}>
                {config.icon} {config.label}
              </span>
              <span className="text-xs text-gray-400">{items.length} results</span>
            </div>
            {/* Items */}
            <div className="p-2 space-y-1">
              {items.map((item) => (
                <ResultItem
                  key={item.id}
                  result={item}
                  isSelected={false}
                  onClick={() => {
                    if (item.url) window.location.href = item.url;
                  }}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ============== Main Component ==============

export function GlobalSearch() {
  const store = useGlobalSearchStore() as GlobalSearchStore;
  const {
    isOpen,
    query,
    status,
    results,
    error,
    regexEnabled,
    caseSensitive,
    close,
    setQuery,
    addResults,
    clearResults,
    setStatus,
    toggleRegex,
    toggleCaseSensitive,
  } = store;

  const inputRef = useRef<HTMLInputElement>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isPending, startTransition] = useTransition();
  const deferredQuery = useDeferredValue(query);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus();
      clearResults();
    }
  }, [isOpen, clearResults]);

  // Run search when query or options change
  useEffect(() => {
    if (!query.trim()) {
      clearResults();
      setStatus("idle");
      return;
    }

    // Validate regex
    const validation = validateRegex(query, regexEnabled);
    if (!validation.valid) {
      setStatus("error");
      return;
    }

    setStatus("searching");
    clearResults();

    // Use startTransition for non-blocking search
    startTransition(async () => {
      try {
        const searchResults = await searchAll(query, store.sources, {
          regex: regexEnabled,
          caseSensitive,
        });
        addResults(searchResults);
      } catch (e) {
        setStatus("error");
      }
    });
  }, [query, regexEnabled, caseSensitive]);

  // Reset selection when results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [results]);

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      switch (e.key) {
        case "Escape":
          close();
          break;
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((i) => Math.max(i - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          if (results[selectedIndex]?.url) {
            window.location.href = results[selectedIndex].url;
            close();
          }
          break;
      }
    },
    [close, results, selectedIndex],
  );

  // Don't render if closed
  if (!isOpen) return null;

  return (
    /* Backdrop */
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]" onClick={close}>
      {/* Overlay */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

      {/* Dialog */}
      <div
        className="relative w-full max-w-2xl mx-4 bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        style={{ maxHeight: "70vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input row */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100">
          <SearchIcon size={20} className="text-gray-400 flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            placeholder='Search chat, files, git... (regex supported)'
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1 text-base text-gray-900 placeholder:text-gray-400 outline-none bg-transparent"
            autoComplete="off"
            spellCheck={false}
          />

          {/* Status indicator */}
          {(status === "searching" || isPending) && (
            <RefreshCwIcon size={16} className="text-blue-500 flex-shrink-0 animate-spin" />
          )}

          {/* Toggle buttons */}
          <div className="flex items-center gap-1">
            <ToggleButton
              label=".*"
              active={regexEnabled}
              onClick={toggleRegex}
              title="Toggle regex mode"
            />
            <ToggleButton
              label="Aa"
              active={caseSensitive}
              onClick={toggleCaseSensitive}
              title="Toggle case sensitivity"
            />
          </div>

          <button
            onClick={close}
            className="text-gray-400 hover:text-gray-600 p-1 rounded hover:bg-gray-100"
            title="Close (Esc)"
          >
            <XIcon size={18} />
          </button>
        </div>

        {/* Source filters */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-gray-50 bg-gray-50/50">
          <SourceFilters />
          {results.length > 0 && (
            <span className="text-xs text-gray-400">{results.length} results</span>
          )}
        </div>

        {/* Error state */}
        {status === "error" && (
          <div className="px-4 py-3 text-sm text-red-600 bg-red-50">
            {error ?? "Search failed. Please try again."}
          </div>
        )}

        {/* Empty state */}
        {status === "done" && results.length === 0 && (
          <div className="flex-1 flex flex-col items-center justify-center py-12 text-gray-400">
            <SearchIcon size={40} className="mb-3 opacity-30" />
            <p className="text-sm font-medium">No results for "{query}"</p>
            <p className="text-xs mt-1">Try different keywords or toggle sources</p>
          </div>
        )}

        {/* Idle state */}
        {status === "idle" && !query && (
          <div className="flex-1 flex flex-col items-center justify-center py-12 text-gray-400">
            <SearchIcon size={40} className="mb-3 opacity-30" />
            <p className="text-sm font-medium">Start typing to search</p>
            <p className="text-xs mt-1">Search across chat, files, and git history</p>
          </div>
        )}

        {/* Results */}
        {results.length > 0 && <GroupedResults results={results} />}

        {/* Keyboard hints */}
        <div className="px-4 py-2 border-t border-gray-100 flex items-center gap-4 text-xs text-gray-400">
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span>Esc close</span>
          {regexEnabled && <span className="text-blue-500">.* regex mode</span>}
        </div>
      </div>
    </div>
  );
}

// ============== Keyboard Shortcut Hook ==============

export function useGlobalSearchShortcut() {
  const { toggle } = useGlobalSearchStore();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "F") {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [toggle]);
}