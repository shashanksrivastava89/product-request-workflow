import React from 'react'
import { WIZARD_READONLY_FIELD_CLASS } from '../utils/wizardFieldStyles'

type Option<T> = {
  value: T
  label: string
  sub?: string
}

// Pagination metadata for async options
interface AsyncOptionsResult<T> {
  options: Option<T>[]
  total?: number
  hasMore?: boolean
}

interface Props<T> {
  // Static options (existing behavior)
  options?: Option<T>[]
  // Async options (new behavior)
  asyncOptions?: {
    load: (search: string) => Promise<Option<T>[] | AsyncOptionsResult<T>>
    initialLoad?: () => Promise<Option<T>[] | AsyncOptionsResult<T>>
    loadMore?: (offset: number) => Promise<Option<T>[] | AsyncOptionsResult<T>>
  }
  value: T | null
  onChange: (val: T | null) => void
  placeholder?: string
  labelClassName?: string
  disabled?: boolean
  minSearchLength?: number  // Minimum chars before search (default: 0)
  debounceMs?: number       // Debounce delay (default: 300)
  /** Shown when `value` is set but options have not loaded yet (e.g. server draft hydrate). */
  fallbackLabel?: string
  /** Optional sticky header above async list (e.g. requester group name for personal accounts). */
  listHeader?: string
  /**
   * Show only the label once something is chosen; the options keep their sub-line. The product
   * pickers use it: the chosen product's codes are printed once, on the code line beneath, which
   * works for a copied line too - where the options have not loaded and there is no sub to show.
   */
  hideSelectedSub?: boolean
}

export default function SearchSelect<T extends string | number | object>({ 
  options, 
  asyncOptions,
  value, 
  onChange, 
  placeholder, 
  labelClassName, 
  disabled = false,
  minSearchLength = 0,
  debounceMs = 300,
  fallbackLabel,
  listHeader,
  hideSelectedSub = false,
}: Props<T>) {
  const [query, setQuery] = React.useState('')
  const [open, setOpen] = React.useState(false)
  const [asyncOptionsList, setAsyncOptionsList] = React.useState<Option<T>[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [isLoadingMore, setIsLoadingMore] = React.useState(false)
  const [currentOffset, setCurrentOffset] = React.useState(0)
  const [hasMore, setHasMore] = React.useState(false)
  const [total, setTotal] = React.useState<number | undefined>(undefined)
  const [isSearchMode, setIsSearchMode] = React.useState(false)
  const ref = React.useRef<HTMLDivElement>(null)
  const debounceTimerRef = React.useRef<NodeJS.Timeout | null>(null)
  const optionsContainerRef = React.useRef<HTMLDivElement>(null)

  // Determine if using async mode
  const isAsync = !!asyncOptions

  // Helper function to normalize async options result
  const normalizeAsyncResult = (result: Option<T>[] | AsyncOptionsResult<T>): { options: Option<T>[]; total?: number; hasMore?: boolean } => {
    if (Array.isArray(result)) {
      return { options: result }
    }
    return result
  }

  // Reset options when asyncOptions functions change (e.g., business unit changes)
  // This ensures data is cleared when business unit changes
  const initialLoadRef = React.useRef(asyncOptions?.initialLoad)
  const loadRef = React.useRef(asyncOptions?.load)
  const loadMoreRef = React.useRef(asyncOptions?.loadMore)
  
  const runInitialLoad = React.useCallback(() => {
    if (!isAsync || !asyncOptions?.initialLoad) return
    setLoading(true)
    setError(null)
    setCurrentOffset(0)
    setIsSearchMode(false)
    asyncOptions
      .initialLoad()
      .then((result) => {
        const normalized = normalizeAsyncResult(result)
        setAsyncOptionsList(normalized.options)
        setTotal(normalized.total)
        const calculatedHasMore =
          normalized.hasMore ??
          (normalized.total ? normalized.options.length < normalized.total : false)
        setHasMore(calculatedHasMore)
        setCurrentOffset(normalized.options.length)
        setLoading(false)
      })
      .catch((err) => {
        console.error('Failed to load initial options:', err)
        setError('Failed to load options')
        setLoading(false)
      })
  }, [isAsync, asyncOptions])

  React.useEffect(() => {
    const initialLoadChanged = initialLoadRef.current !== asyncOptions?.initialLoad
    const loadChanged = loadRef.current !== asyncOptions?.load
    const loadMoreChanged = loadMoreRef.current !== asyncOptions?.loadMore

    if (isAsync && (initialLoadChanged || loadChanged || loadMoreChanged)) {
      setAsyncOptionsList([])
      setCurrentOffset(0)
      setHasMore(false)
      setTotal(undefined)
      setIsSearchMode(false)
      setQuery('')

      initialLoadRef.current = asyncOptions?.initialLoad
      loadRef.current = asyncOptions?.load
      loadMoreRef.current = asyncOptions?.loadMore

      if (open) {
        runInitialLoad()
      }
    }
  }, [isAsync, asyncOptions?.initialLoad, asyncOptions?.load, asyncOptions?.loadMore, open, runInitialLoad])

  // Refetch whenever dropdown opens so requester group / BU changes never show a stale list
  React.useEffect(() => {
    if (isAsync && asyncOptions?.initialLoad && open) {
      runInitialLoad()
    }
  }, [isAsync, open, asyncOptions?.initialLoad, runInitialLoad])

  // Debounced async search
  React.useEffect(() => {
    if (!isAsync || !asyncOptions) return

    // Clear previous timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
    }

    // If query is too short, use initial load or empty
    if (query.length < minSearchLength) {
      setIsSearchMode(false)
      if (asyncOptions.initialLoad) {
        setLoading(true)
        setError(null)
        setCurrentOffset(0)
        asyncOptions.initialLoad()
          .then(result => {
            const normalized = normalizeAsyncResult(result)
            setAsyncOptionsList(normalized.options)
            setTotal(normalized.total)
            const calculatedHasMore = normalized.hasMore ?? (normalized.total ? normalized.options.length < normalized.total : false)
            setHasMore(calculatedHasMore)
            setCurrentOffset(normalized.options.length)
            setLoading(false)
          })
          .catch(err => {
            console.error('Failed to load initial options:', err)
            setError('Failed to load options')
            setLoading(false)
          })
      } else {
        setAsyncOptionsList([])
        setHasMore(false)
        setCurrentOffset(0)
      }
      return
    }

    // Debounce the search - only set search mode if query has actual content
    if (query.trim().length >= minSearchLength) {
      setIsSearchMode(true)
    } else {
      setIsSearchMode(false)
    }
    setLoading(true)
    setError(null)
    setCurrentOffset(0)
    debounceTimerRef.current = setTimeout(() => {
      asyncOptions.load(query)
        .then(result => {
          const normalized = normalizeAsyncResult(result)
          setAsyncOptionsList(normalized.options)
          setTotal(normalized.total)
          setHasMore(normalized.hasMore ?? false)
          setCurrentOffset(normalized.options.length)
          setLoading(false)
        })
        .catch(err => {
          console.error('Search failed:', err)
          setError('Search failed')
          setLoading(false)
        })
    }, debounceMs)

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
    }
  }, [query, isAsync, asyncOptions, minSearchLength, debounceMs])

  // Infinite scroll handler
  const handleScroll = React.useCallback(() => {
    const container = optionsContainerRef.current
    if (!container || !loadMoreRef.current || isLoadingMore || !hasMore) {
      return
    }
    // Only disable during active search (query has content)
    if (isSearchMode && query.trim().length >= minSearchLength) {
      return
    }

    const scrollTop = container.scrollTop
    const scrollHeight = container.scrollHeight
    const clientHeight = container.clientHeight

    // Trigger load more when within 50px of bottom
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight
    
    if (distanceFromBottom < 50) {
      setIsLoadingMore(true)
      const currentOffsetValue = currentOffset
      loadMoreRef.current(currentOffsetValue)
        .then(result => {
          const normalized = normalizeAsyncResult(result)
          setAsyncOptionsList(prev => [...prev, ...normalized.options])
          setTotal(normalized.total)
          const calculatedHasMore = normalized.hasMore ?? (normalized.total ? (asyncOptionsList.length + normalized.options.length) < normalized.total : false)
          setHasMore(calculatedHasMore)
          setCurrentOffset(prev => prev + normalized.options.length)
          setIsLoadingMore(false)
        })
        .catch(err => {
          console.error('Failed to load more options:', err)
          setIsLoadingMore(false)
        })
    }
  }, [isLoadingMore, hasMore, isSearchMode, query, minSearchLength, currentOffset, asyncOptionsList.length, total])

  // Reset search mode and query when dropdown opens
  React.useEffect(() => {
    if (open) {
      setIsSearchMode(false)
      setQuery('')
    }
  }, [open])

  // Attach scroll listener when dropdown is open
  React.useEffect(() => {
    const container = optionsContainerRef.current
    // Only disable scroll if there's an actual search query (not just empty string)
    const hasActiveQuery = query.trim().length > 0 && query.trim().length >= minSearchLength
    if (open && container && !hasActiveQuery && loadMoreRef.current) {
      // Attach scroll listener immediately
      container.addEventListener('scroll', handleScroll, { passive: true })
      return () => {
        container.removeEventListener('scroll', handleScroll)
      }
    }
  }, [open, query, minSearchLength, handleScroll, loadMoreRef])

  React.useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!ref.current) return
      if (!ref.current.contains(e.target as any)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  // Get options list (static or async)
  const optionsList = isAsync ? asyncOptionsList : (options || [])
  
  // Filter static options (async options are already filtered by API)
  const filtered = isAsync 
    ? optionsList
    : optionsList.filter(o =>
        o.label.toLowerCase().includes(query.toLowerCase()) ||
        (o.sub && o.sub.toLowerCase().includes(query.toLowerCase()))
      )
  
  // Store selected option separately to persist it even when not in current list
  const [persistedSelectedOption, setPersistedSelectedOption] = React.useState<Option<T> | null>(null)
  
  // Find selected option in current list
  const selectedOption = optionsList.find(o => deepEqual(o.value, value))
  
  // Update persisted selected option when value changes or when found in list
  React.useEffect(() => {
    if (value !== null && value !== undefined) {
      // First try to find in current list
      const found = optionsList.find(o => deepEqual(o.value, value))
      if (found) {
        setPersistedSelectedOption(found)
      }
      // If not found in current list, check if we have a persisted option with matching value
      // If yes, keep it; if no, we'll need to keep the existing persisted option if it matches
      else if (!persistedSelectedOption || !deepEqual(persistedSelectedOption.value, value)) {
        // Only clear if the value doesn't match the persisted option
        // This allows the persisted option to remain even when not in current list
      }
    } else {
      setPersistedSelectedOption(null)
    }
  }, [value, optionsList])
  
  // Use persisted option if current list doesn't have it, but only if value matches
  const displayOption = selectedOption || (persistedSelectedOption && deepEqual(persistedSelectedOption.value, value) ? persistedSelectedOption : null)

  const showFallback =
    !displayOption &&
    fallbackLabel &&
    value !== null &&
    value !== undefined &&
    !(typeof value === 'string' && value.trim() === '')

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        className={
          disabled
            ? `${WIZARD_READONLY_FIELD_CLASS} text-left`
            : 'border-2 border-gray-300 rounded-lg px-3 py-2 w-full text-left bg-white min-h-[3rem] transition-all duration-200 hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-[#00A651] focus:ring-opacity-50 focus:border-[#00A651]'
        }
        onClick={() => !disabled && setOpen(o => !o)}
        disabled={disabled}
      >
        {displayOption ? (
          <div>
            <div
              className={`text-sm ${labelClassName || (disabled ? 'font-medium text-gray-800' : 'font-medium text-gray-900')}`}
            >
              {displayOption.label}
            </div>
            {!hideSelectedSub && displayOption.sub && <div className="text-xs text-gray-500 mt-1">{displayOption.sub}</div>}
          </div>
        ) : showFallback ? (
          <div>
            <div
              className={`text-sm ${labelClassName || (disabled ? 'font-medium text-gray-800' : 'font-medium text-gray-900')}`}
            >
              {fallbackLabel}
            </div>
          </div>
        ) : (
          <span className="text-gray-500">{placeholder || 'Select...'}</span>
        )}
      </button>
      {open && (
        <div className="absolute z-[100] mt-1 w-full bg-white border-2 border-gray-300 rounded-lg shadow-lg">
          <input
            autoFocus
            className="w-full px-3 py-2 border-b outline-none"
            placeholder="Search..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div 
            ref={optionsContainerRef}
            className="max-h-60 overflow-y-auto"
            style={{ maxHeight: '240px', overflowX: 'hidden' }}
          >
            {listHeader ? (
              <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500 border-b border-gray-100 bg-gray-50 sticky top-0">
                {listHeader}
              </div>
            ) : null}
            {loading && (
              <div className="px-3 py-2 text-sm text-gray-500">Loading...</div>
            )}
            {!loading && error && (
              <div className="px-3 py-2 text-sm text-red-500">{error}</div>
            )}
            {!loading && !error && filtered.map((o, idx) => (
              <div key={idx} className="px-3 py-2 hover:bg-gray-50 cursor-pointer" onClick={() => { 
                setPersistedSelectedOption(o); // Persist the selected option
                onChange(o.value); 
                setOpen(false); 
                setQuery('') 
              }}>
                <div className="text-sm">{o.label}</div>
                {o.sub && <div className="text-xs text-gray-500">{o.sub}</div>}
              </div>
            ))}
            {!loading && !error && isLoadingMore && (
              <div className="px-3 py-2 text-sm text-gray-500">Loading more...</div>
            )}
            {!loading && !error && !isLoadingMore && filtered.length === 0 && (
              <div className="px-3 py-2 text-sm text-gray-500">No results</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function deepEqual(a: any, b: any) {
  try { return JSON.stringify(a) === JSON.stringify(b) } catch { return a === b }
}
