import { useState, type Dispatch, type SetStateAction } from 'react';

/**
 * Editable state initialised from loaded data (e.g. a form populated from the server). When `source`
 * changes identity the state is re-derived during render — React's recommended alternative to calling
 * setState inside an effect. TanStack Query keeps the same reference for unchanged data, so background
 * refetches do not overwrite in-progress edits.
 */
export function useDerivedState<T, S>(source: T | null | undefined, derive: (source: T) => S, empty: S): [S, Dispatch<SetStateAction<S>>] {
  const [state, setState] = useState<S>(() => (source != null ? derive(source) : empty));
  const [prev, setPrev] = useState(source);
  if (source !== prev) {
    setPrev(source);
    if (source != null) setState(derive(source));
  }
  return [state, setState];
}
