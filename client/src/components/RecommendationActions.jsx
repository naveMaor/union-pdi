import { useRef, useState } from 'react';
import { api } from '../api/client';

const GENERATION_ERRORS = {
  CONFIRMATION_REQUIRED: 'כבר קיימת תכנית לתאריך זה. מצב התכנית נטען מחדש.',
  PLAN_LOCKED: 'התכנית נעולה להרצה מחדש.',
};

export function RecommendationActions({ role, planState, isGenerating, setIsGenerating, onRefresh }) {
  const [feedback, setFeedback] = useState(null);
  const requestInFlight = useRef(false);
  const dialog = useRef(null);
  const cancelButton = useRef(null);
  const plan = planState.data?.plan;
  const editable = plan?.status === 'DRAFT' || plan?.status === 'RETURNED';
  const canGenerate = !isGenerating && !planState.loading && !planState.error && (plan === null || editable);

  async function generate(confirm) {
    if (!canGenerate || requestInFlight.current) return;

    requestInFlight.current = true;
    setIsGenerating(true);
    setFeedback(null);
    try {
      await api.generatePlan(role, { confirm });
      setFeedback({ text: 'ההמלצה נשמרה.' });
    } catch (error) {
      setFeedback({
        error: true,
        text: GENERATION_ERRORS[error.code] ?? 'לא התקבל אישור על שמירת ההמלצה. מצב התכנית נטען מחדש.',
      });
    } finally {
      // A failed or interrupted response can also leave the displayed plan stale.
      onRefresh();
      requestInFlight.current = false;
      setIsGenerating(false);
    }
  }

  function handleAction() {
    if (!canGenerate || requestInFlight.current) return;
    if (!editable) {
      void generate(false);
      return;
    }
    setFeedback(null);
    dialog.current.showModal();
    cancelButton.current.focus();
  }

  function confirmRegeneration() {
    if (!dialog.current.open) return;
    dialog.current.close();
    if (editable) void generate(true);
  }

  return (
    <div className="planner-actions">
      {feedback && <p role={feedback.error ? 'alert' : 'status'}>{feedback.text}</p>}
      {isGenerating && <span role="status">מריצה המלצה…</span>}
      {(plan == null || editable) && (
        <button
          className="recommendation-primary"
          disabled={!canGenerate}
          type="button"
          onClick={handleAction}
        >
          {editable ? 'הרצת המלצה מחדש' : 'יצירת המלצה'}
        </button>
      )}
      <dialog
        className="recommendation-dialog"
        ref={dialog}
        aria-labelledby="recommendation-title"
        aria-describedby="recommendation-description"
      >
        <h2 id="recommendation-title">הרצת המלצה מחדש</h2>
        <p id="recommendation-description">
          ההמלצה תחושב מחדש לפי הגדרות התכנון והחסמים העדכניים.
          הוצאות ידניות פעילות יישמרו, והוספות ידניות יימחקו.
        </p>
        <div className="recommendation-dialog-actions">
          <button ref={cancelButton} className="recommendation-secondary" type="button" onClick={() => dialog.current.close()}>
            ביטול
          </button>
          <button className="recommendation-primary" type="button" onClick={confirmRegeneration}>
            אישור הרצה מחדש
          </button>
        </div>
      </dialog>
    </div>
  );
}
