import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { BLOCKER_LABELS, EXCLUSION_REASON_LABELS } from '../constants';
import { PlannerDialog } from './PlannerDialog';

const ACTIONS = {
  exclude: {
    title: 'הוצאה מהתכנית', confirm: 'אישור הוצאה', pending: 'מוציאה רכב מהתכנית…', success: 'הרכב הוצא מהתכנית.',
    description: 'הרכב יוסר מהתכנית מיד. ההוצאה תישמר גם בהרצה מחדש.',
  },
  cancelExclusion: {
    title: 'ביטול הוצאה ידנית', confirm: 'אישור ביטול הוצאה', pending: 'מבטלת הוצאה…', success: 'ההוצאה בוטלה.',
    description: 'ההוצאה תבוטל. הרכב לא יתווסף אוטומטית לתכנית.',
  },
  addBlocker: {
    title: 'הוספת חסם', confirm: 'אישור הוספת חסם', pending: 'מוסיפה חסם…', success: 'החסם נשמר.',
    description: 'החסם משנה את זכאות הרכב. הוא אינו משנה את הרכב התכנית או את מצבה.',
  },
  removeBlocker: {
    title: 'הסרת חסם', confirm: 'אישור הסרת חסם', pending: 'מסירה חסם…', success: 'החסם הוסר.',
    description: 'החסם יוסר ללא שינוי בחברות הרכב בתכנית.',
  },
};

export function VehicleActionDialog({ role, vehicle, editable, locked, disabled, onClose, mutate }) {
  const dialog = useRef(null);
  const cancelButton = useRef(null);
  const firstField = useRef(null);
  const [operation, setOperation] = useState(null);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [blocker, setBlocker] = useState('');
  const [error, setError] = useState(null);
  const action = ACTIONS[operation];
  const hasBlocker = vehicle.active_blocker !== 'NONE';
  const id = vehicle.vehicle_id;

  useEffect(() => {
    const element = dialog.current;
    if (!element.open) element.showModal();
    (firstField.current ?? cancelButton.current).focus();
  }, [operation]);

  function closeDialog() {
    dialog.current.close();
    onClose();
  }

  function dismissWithEscape(event) {
    event.preventDefault();
    closeDialog();
  }

  function submit(event) {
    event.preventDefault();
    if (!dialog.current?.open || disabled) return;

    if (operation === 'exclude' && !reason) {
      setError('יש לבחור סיבת הוצאה.');
      firstField.current.focus();
      return;
    }
    if (operation === 'exclude' && reason === 'OTHER' && !note.trim()) {
      setError('יש להזין הערה עבור סיבה אחרת.');
      dialog.current.querySelector('textarea').focus();
      return;
    }
    if (operation === 'addBlocker' && !blocker) {
      setError('יש לבחור סוג חסם.');
      firstField.current.focus();
      return;
    }

    const requests = {
      exclude: () => api.excludeVehicle(role, id, { reasonCode: reason, note: note.trim() }),
      cancelExclusion: () => api.cancelExclusion(role, id),
      addBlocker: () => api.addBlocker(role, id, blocker),
      removeBlocker: () => api.removeBlocker(role, id),
    };
    closeDialog();
    void mutate(requests[operation], action.pending, action.success);
  }

  return (
    <PlannerDialog
      name="vehicle-action"
      dialogRef={dialog}
      title={<>{action?.title ?? 'פעולות לרכב'} <bdi dir="ltr" className="identifier">{id}</bdi></>}
      description={action?.description}
      onCancel={dismissWithEscape}
    >
      {!action ? (
        <>
          {locked && <p>התכנית נעולה. שינוי חסם ישפיע על החיווי בלבד.</p>}
          {hasBlocker && (
            <p>חסם פעיל · {BLOCKER_LABELS[vehicle.active_blocker]} <bdi dir="ltr">({vehicle.active_blocker})</bdi></p>
          )}
          <div className="vehicle-action-options">
            {editable && vehicle.inPlan && (
              <button className="recommendation-secondary" type="button" onClick={() => setOperation('exclude')}>
                הוצאה מהתכנית
              </button>
            )}
            {editable && vehicle.exclusion && (
              <button className="recommendation-secondary" type="button" onClick={() => setOperation('cancelExclusion')}>
                ביטול הוצאה ידנית
              </button>
            )}
            <button className="recommendation-secondary" type="button" onClick={() => setOperation(hasBlocker ? 'removeBlocker' : 'addBlocker')}>
              {hasBlocker ? 'הסרת חסם' : 'הוספת חסם'}
            </button>
          </div>
          <div className="recommendation-dialog-actions">
            <button ref={cancelButton} className="recommendation-secondary" type="button" onClick={closeDialog}>סגירה</button>
          </div>
        </>
      ) : (
        <form className="vehicle-action-form" noValidate onSubmit={submit}>
          {operation === 'exclude' && (
            <>
              <label>
                סיבת הוצאה (חובה)
                <select ref={firstField} required value={reason} onChange={(event) => { setReason(event.target.value); setError(null); }}>
                  <option value="">בחרי סיבה</option>
                  {Object.entries(EXCLUSION_REASON_LABELS).map(([code, label]) => (
                    <option key={code} value={code}>{label}</option>
                  ))}
                </select>
              </label>
              <label>
                {reason === 'OTHER' ? 'הערה (חובה)' : 'הערה (רשות)'}
                <textarea
                  rows={3} dir="auto" required={reason === 'OTHER'} value={note}
                  onChange={(event) => { setNote(event.target.value); setError(null); }}
                />
              </label>
            </>
          )}
          {operation === 'addBlocker' && (
            <label>
              סוג חסם (חובה)
              <select ref={firstField} required value={blocker} onChange={(event) => { setBlocker(event.target.value); setError(null); }}>
                <option value="">בחרי חסם</option>
                {Object.entries(BLOCKER_LABELS).map(([code, label]) => (
                  <option key={code} value={code}>{label}</option>
                ))}
              </select>
            </label>
          )}
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="recommendation-dialog-actions">
            <button ref={cancelButton} className="recommendation-secondary" type="button" onClick={closeDialog}>ביטול</button>
            <button className="recommendation-primary" type="submit" disabled={disabled}>{action.confirm}</button>
          </div>
        </form>
      )}
    </PlannerDialog>
  );
}
