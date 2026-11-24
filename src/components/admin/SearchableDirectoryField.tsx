/**
 * Searchable combobox for Requesters directory names or User directory names (approval mapping UI).
 * Dropdown is portaled to document.body so it is not clipped by table/modal overflow.
 * Fully controlled: parent state updates on every keystroke (same as a plain text input).
 */

import React from 'react';
import { createPortal } from 'react-dom';
import { adminApi } from '../../services/api.service';

const DEBOUNCE_MS = 280;

type Kind = 'requester' | 'approver';

export type SearchableDirectoryFieldProps = {
  id?: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  kind: Kind;
  required?: boolean;
  disabled?: boolean;
  /** Tighter styling for spreadsheet inline cells */
  compact?: boolean;
  /** Hide the small helper line under the input (modal forms with a section description) */
  showHint?: boolean;
  /** When Enter is pressed and the suggestion list is not choosing an item */
  onEnterPress?: () => void;
};

type PickerOption = { key: string; primary: string; secondary: string };

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

export function SearchableDirectoryField(props: SearchableDirectoryFieldProps) {
  const { id, label, value, onChange, kind, required, disabled, compact, showHint = true, onEnterPress } = props;
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [options, setOptions] = React.useState<PickerOption[]>([]);
  const [highlight, setHighlight] = React.useState(0);
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const skipBlurTrimRef = React.useRef(false);
  const [menuPos, setMenuPos] = React.useState<{ top: number; left: number; width: number } | null>(null);

  const updateMenuPosition = React.useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setMenuPos({
      top: r.bottom + 4,
      left: r.left,
      width: Math.max(r.width, 260),
    });
  }, []);

  const fetchOptions = React.useCallback(
    async (q: string) => {
      const qt = q.trim();
      if (kind === 'requester' && qt.length < 1) {
        setOptions([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        if (kind === 'requester') {
          const res = await adminApi.searchAdminRequestersForPicker(qt, 50);
          setOptions(
            res.requesters.map((r) => ({
              key: r.id,
              primary: r.name,
              secondary: [r.groupName, r.businessUnit, r.code].filter(Boolean).join(' · '),
            }))
          );
        } else {
          const res = await adminApi.getAdminUsersForApprovalPicker(qt || undefined, 60);
          setOptions(
            res.users.map((u) => ({
              key: u.id,
              primary: u.name,
              secondary: [u.email, u.businessUnit ?? '', u.role].filter(Boolean).join(' · '),
            }))
          );
        }
        setHighlight(0);
      } catch {
        setOptions([]);
      } finally {
        setLoading(false);
      }
    },
    [kind]
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
      if ((e.target as HTMLElement | null)?.closest?.('[data-approval-picker-menu]')) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const onInputChange = (v: string) => {
    onChange(v);
    setOpen(true);
    debouncedFetch(v);
  };

  const onFocus = () => {
    setOpen(true);
    updateMenuPosition();
    if (kind === 'approver') {
      void fetchOptions(value);
    } else if (value.trim().length >= 1) {
      void fetchOptions(value);
    }
  };

  const pick = (primary: string) => {
    skipBlurTrimRef.current = true;
    onChange(primary);
    setOpen(false);
    inputRef.current?.blur();
  };

  const onBlurField = () => {
    window.setTimeout(() => {
      const t = document.activeElement;
      if (wrapRef.current?.contains(t)) return;
      if (skipBlurTrimRef.current) {
        skipBlurTrimRef.current = false;
        setOpen(false);
        return;
      }
      const trimmed = value.trim();
      if (trimmed !== value) {
        onChange(trimmed);
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
        if (o) pick(o.primary);
        return;
      }
      if (onEnterPress) {
        e.preventDefault();
        onEnterPress();
      }
      return;
    }
    if (!open || options.length === 0) {
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, options.length - 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
      return;
    }
  };

  const labelCls = compact ? 'block text-[10px] font-medium text-gray-600 mb-0.5' : 'block text-xs font-medium text-gray-600 mb-0.5';
  const inputCls =
    (compact
      ? 'border border-gray-200 rounded px-1.5 py-1 w-full text-xs focus:ring-1 focus:ring-[#00A651]/30 focus:border-[#00A651] outline-none'
      : 'border border-gray-200 rounded-lg px-3 py-2 w-full text-sm focus:ring-2 focus:ring-[#00A651]/30 focus:border-[#00A651] outline-none') +
    (disabled ? ' opacity-50 pointer-events-none' : '');

  const hint =
    kind === 'requester'
      ? 'Type to search the Requesters directory'
      : 'Type to search users (approver name must match Users)';

  const dropdown =
    open && menuPos && typeof document !== 'undefined'
      ? createPortal(
          <div
            data-approval-picker-menu
            role="listbox"
            className="fixed z-[200] max-h-56 overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg text-left"
            style={{
              top: menuPos.top,
              left: menuPos.left,
              width: menuPos.width,
            }}
          >
            {loading && (
              <div className="px-3 py-2 text-xs text-gray-500">Loading…</div>
            )}
            {!loading && options.length === 0 && (
              <div className="px-3 py-2 text-xs text-gray-500">
                {kind === 'requester' && value.trim().length < 1 ? hint : 'No matches'}
              </div>
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
                  onClick={() => pick(o.primary)}
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
      <label className={compact ? 'sr-only' : labelCls} htmlFor={id}>
        {label}
      </label>
      <input
        ref={inputRef}
        id={id}
        className={inputCls}
        disabled={disabled}
        required={required}
        autoComplete="off"
        value={value}
        onChange={(e) => onInputChange(e.target.value)}
        onFocus={onFocus}
        onBlur={onBlurField}
        onKeyDown={onKeyDown}
        placeholder={kind === 'requester' ? 'Search requesters…' : 'Search users…'}
        aria-autocomplete="list"
        aria-expanded={open}
      />
      {dropdown}
      {!compact && showHint && <p className="text-[11px] text-gray-400 mt-0.5">{hint}</p>}
    </div>
  );
}
