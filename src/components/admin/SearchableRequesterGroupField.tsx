/**
 * Searchable team (requester group) picker for approval mapping — filtered by CDG/LSG.
 */

import React from 'react';
import { createPortal } from 'react-dom';
import { adminApi } from '../../services/api.service';

const DEBOUNCE_MS = 280;

export type TeamSelection = { id: string; name: string };

export type SearchableRequesterGroupFieldProps = {
  label: string;
  businessUnit: 'CDG' | 'LSG' | 'SERVICE';
  /** Selected group id, or '' */
  selectedId: string;
  /** Display / search text */
  selectedName: string;
  /** null = clear; id may be '' while user types before picking */
  onChange: (next: TeamSelection | null) => void;
  showHint?: boolean;
};

type Opt = { key: string; primary: string; secondary: string };

function useDebounced<T extends (...args: string[]) => void>(fn: T, ms: number) {
  const t = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const f = React.useRef(fn);
  f.current = fn;
  return React.useCallback(
    (arg: string) => {
      if (t.current) clearTimeout(t.current);
      t.current = setTimeout(() => f.current(arg), ms);
    },
    [ms]
  );
}

export function SearchableRequesterGroupField(props: SearchableRequesterGroupFieldProps) {
  const { label, businessUnit, selectedId, selectedName, onChange, showHint = true } = props;
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [options, setOptions] = React.useState<Opt[]>([]);
  const [highlight, setHighlight] = React.useState(0);
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const skipBlurRef = React.useRef(false);
  const [menuPos, setMenuPos] = React.useState<{ top: number; left: number; width: number } | null>(null);

  const updateMenuPosition = React.useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setMenuPos({ top: r.bottom + 4, left: r.left, width: Math.max(r.width, 280) });
  }, []);

  const fetchOptions = React.useCallback(
    async (q: string) => {
      setLoading(true);
      try {
        const res = await adminApi.searchAdminRequesterGroupsForPicker({
          businessUnit,
          q: q.trim() || undefined,
          limit: 60,
        });
        setOptions(
          res.groups.map((g) => ({
            key: g.id,
            primary: g.name,
            secondary: [g.code, g.businessUnit].filter(Boolean).join(' · '),
          }))
        );
        setHighlight(0);
      } catch {
        setOptions([]);
      } finally {
        setLoading(false);
      }
    },
    [businessUnit]
  );

  const debouncedFetch = useDebounced(fetchOptions, DEBOUNCE_MS);

  React.useLayoutEffect(() => {
    if (!open) return;
    updateMenuPosition();
    const onScroll = () => updateMenuPosition();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open, updateMenuPosition, options.length, loading]);

  React.useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t)) return;
      if ((e.target as HTMLElement | null)?.closest?.('[data-team-picker-menu]')) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const onInputChange = (v: string) => {
    if (v === '') {
      onChange(null);
    } else {
      onChange({ id: '', name: v });
    }
    setOpen(true);
    debouncedFetch(v);
  };

  const onFocus = () => {
    setOpen(true);
    updateMenuPosition();
    void fetchOptions(selectedName);
  };

  const pick = (id: string, name: string) => {
    skipBlurRef.current = true;
    onChange({ id, name });
    setOpen(false);
    inputRef.current?.blur();
  };

  const onBlurField = () => {
    window.setTimeout(() => {
      const t = document.activeElement;
      if (wrapRef.current?.contains(t)) return;
      if (skipBlurRef.current) {
        skipBlurRef.current = false;
        setOpen(false);
        return;
      }
      if (selectedId === '' && selectedName.trim() !== '') {
        onChange(null);
      }
      setOpen(false);
    }, 120);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        setOpen(false);
      }
      return;
    }
    if (e.key === 'Enter') {
      if (open && options.length > 0) {
        e.preventDefault();
        const o = options[highlight];
        if (o) pick(o.key, o.primary);
        return;
      }
      return;
    }
    if (!open || options.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, options.length - 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    }
  };

  const hint =
    'Optional — adds this requester to the team in Data Management → Requesters (membership is created if missing).';

  const dropdown =
    open && menuPos && typeof document !== 'undefined'
      ? createPortal(
          <div
            data-team-picker-menu
            role="listbox"
            className="fixed z-[200] max-h-56 overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg text-left"
            style={{ top: menuPos.top, left: menuPos.left, width: menuPos.width }}
          >
            {loading && <div className="px-3 py-2 text-xs text-gray-500">Loading…</div>}
            {!loading && options.length === 0 && (
              <div className="px-3 py-2 text-xs text-gray-500">No teams match — try another search</div>
            )}
            {!loading &&
              options.map((o, i) => (
                <button
                  key={o.key}
                  type="button"
                  role="option"
                  aria-selected={i === highlight}
                  className={
                    'w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ' +
                    (i === highlight ? 'bg-[#00A651]/10' : '')
                  }
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(o.key, o.primary)}
                >
                  <div className="font-medium text-gray-900 truncate">{o.primary}</div>
                  <div className="text-[11px] text-gray-500 truncate">{o.secondary}</div>
                </button>
              ))}
          </div>,
          document.body
        )
      : null;

  return (
    <div ref={wrapRef}>
      <label className="block text-xs font-medium text-gray-600 mb-0.5">{label}</label>
      <input
        ref={inputRef}
        className="border border-gray-200 rounded-lg px-3 py-2 w-full text-sm focus:ring-2 focus:ring-[#00A651]/30 focus:border-[#00A651] outline-none"
        autoComplete="off"
        value={selectedName}
        onChange={(e) => onInputChange(e.target.value)}
        onFocus={onFocus}
        onBlur={onBlurField}
        onKeyDown={onKeyDown}
        placeholder="Search teams (requester groups)…"
        aria-autocomplete="list"
        aria-expanded={open}
      />
      {dropdown}
      {showHint && <p className="text-[11px] text-gray-400 mt-0.5">{hint}</p>}
    </div>
  );
}
