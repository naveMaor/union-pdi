import { useEffect, useRef, useState } from 'react';

/**
 * Runs `fetchFn(signal)` whenever `deps` change, exposing { data, loading, error }.
 * Guards against stale responses two ways: aborts the previous request's
 * controller on cleanup, and ignores any response that resolves after a newer
 * request has already started (belt-and-suspenders in case abort doesn't win
 * the race).
 */
export function useApiResource(fetchFn, deps) {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const requestIdRef = useRef(0);

  // This hook's whole point is to re-run the fetch whenever caller-supplied
  // deps change; the rule can't statically verify a dynamic deps array, but
  // deps is deliberately the caller's responsibility, same as useEffect itself.
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const controller = new AbortController();
    const requestId = ++requestIdRef.current;
    // Resetting loading/error synchronously at the start of a fetch effect is
    // the standard data-fetching pattern (what libraries like SWR do
    // internally) — there's no prop/state to derive this from during render,
    // it only makes sense in response to the effect re-running.
    // oxlint-disable-next-line react/set-state-in-effect
    setState((prev) => ({ ...prev, loading: true, error: null }));

    fetchFn(controller.signal)
      .then((data) => {
        if (requestId !== requestIdRef.current) return;
        setState({ data, loading: false, error: null });
      })
      .catch((error) => {
        if (error.name === 'AbortError') return;
        if (requestId !== requestIdRef.current) return;
        setState({ data: null, loading: false, error });
      });

    return () => controller.abort();
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}
