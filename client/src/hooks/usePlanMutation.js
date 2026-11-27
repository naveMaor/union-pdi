import { useRef, useState } from 'react';

export function usePlanMutation(setIsMutating, errorMessages) {
  const [revision, setRevision] = useState(0);
  const [pending, setPending] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const mutationInFlight = useRef(false);

  function refresh() {
    setRevision((value) => value + 1);
  }

  async function mutate(request, pendingMessage, successMessage) {
    if (mutationInFlight.current) return;
    mutationInFlight.current = true;
    setIsMutating(true);
    setPending(pendingMessage);
    setFeedback(null);
    try {
      await request();
      setFeedback({ text: successMessage });
    } catch (error) {
      setFeedback({
        error: true,
        text: errorMessages[error.code] ?? 'לא התקבל אישור על שמירת הפעולה. מצב התכנית נטען מחדש.',
      });
    } finally {
      // A failed response may also leave the view out of date.
      refresh();
      mutationInFlight.current = false;
      setPending(null);
      setIsMutating(false);
    }
  }

  return { revision, pending, feedback, refresh, mutate };
}
