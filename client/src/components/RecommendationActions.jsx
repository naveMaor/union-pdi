import { useRef } from 'react';
import { PlannerDialog } from './PlannerDialog';

export function RecommendationActions({ plan, editable, disabled, onGenerate }) {
  const dialog = useRef(null);
  const cancelButton = useRef(null);

  function handleAction() {
    if (disabled) return;
    if (!editable) {
      onGenerate(false);
      return;
    }
    dialog.current.showModal();
    cancelButton.current.focus();
  }

  function confirmRegeneration() {
    if (!dialog.current.open) return;
    dialog.current.close();
    if (editable && !disabled) onGenerate(true);
  }

  if (plan && !editable) return null;

  return (
    <>
      <button className="recommendation-primary" disabled={disabled} type="button" onClick={handleAction}>
        {editable ? 'הרצת המלצה מחדש' : 'יצירת המלצה'}
      </button>
      <PlannerDialog
        name="recommendation"
        dialogRef={dialog}
        title="הרצת המלצה מחדש"
        description="ההמלצה תחושב מחדש לפי הגדרות התכנון והחסמים העדכניים. הוצאות ידניות פעילות יישמרו, והוספות ידניות יימחקו."
      >
        <div className="recommendation-dialog-actions">
          <button ref={cancelButton} className="recommendation-secondary" type="button" onClick={() => dialog.current.close()}>
            ביטול
          </button>
          <button className="recommendation-primary" type="button" onClick={confirmRegeneration}>
            אישור הרצה מחדש
          </button>
        </div>
      </PlannerDialog>
    </>
  );
}
