import { useRef, useState } from 'react';
import { api } from '../api/client';
import { PLAN_STATUS_LABELS } from '../constants';
import { usePlanSummary, useSettings } from '../hooks/useApi';
import { usePlanMutation } from '../hooks/usePlanMutation';
import { shippingCapacityRows } from '../shippingCapacity';
import { PlanBlockerWarnings } from '../components/PlanBlockerWarnings';
import { PlannerDialog } from '../components/PlannerDialog';
import { ShippingCapacityPanel } from '../components/ShippingCapacityPanel';
import { Loading, ErrorMessage } from '../components/StatusMessage';

const SHIPPING_ERRORS = {
  SHIPPING_CAPACITY_EXCEEDED: 'יכולות השילוח העדכניות אינן מספיקות לאישור התכנית.',
  PLAN_NOT_PENDING_SHIPPING: 'מצב התכנית השתנה. התכנית אינה ממתינה עוד לאישור שילוח.',
  PLAN_NOT_FOUND: 'התכנית אינה זמינה. מצב התכנית נטען מחדש.',
  COMMENT_REQUIRED: 'יש להזין הערה לפני החזרת התכנית.',
  FORBIDDEN_ROLE: 'התפקיד הנוכחי אינו מורשה לבצע את הפעולה.',
};

function ShippingVehicles({ vehicles }) {
  return (
    <section className="panel vehicle-panel shipping-vehicles" aria-labelledby="shipping-vehicles-heading">
      <h2 id="shipping-vehicles-heading">רכבים בתכנית השילוח</h2>
      <div className="vehicle-scroll" role="region" aria-labelledby="shipping-vehicles-heading" tabIndex={0}>
        <table className="vehicle-table">
          <thead>
            <tr>
              <th scope="col">מזהה רכב</th>
              <th scope="col">שלדה</th>
              <th scope="col">מותג ודגם</th>
              <th scope="col">מקור</th>
              <th scope="col">חסם פעיל</th>
            </tr>
          </thead>
          <tbody>
            {vehicles.map((vehicle) => {
              const hasBlocker = vehicle.active_blocker !== 'NONE';
              return (
                <tr key={vehicle.vehicle_id} className={hasBlocker ? 'blocked-member' : undefined}>
                  <th scope="row"><bdi dir="ltr" className="identifier">{vehicle.vehicle_id}</bdi></th>
                  <td><bdi dir="ltr" className="identifier">{vehicle.demo_vin}</bdi></td>
                  <td><bdi dir="ltr">{vehicle.brand} {vehicle.model}</bdi></td>
                  <td>{vehicle.source_location}</td>
                  <td>{hasBlocker ? <bdi dir="ltr" className="chip chip-danger">{vehicle.active_blocker}</bdi> : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function ShippingScreen({ role, isMutating, setIsMutating }) {
  const { revision, pending, feedback, refresh, mutate } = usePlanMutation(setIsMutating, SHIPPING_ERRORS);
  const planState = usePlanSummary(role, revision);
  const settingsState = useSettings(role, revision);
  const dialog = useRef(null);
  const commentField = useRef(null);
  const [comment, setComment] = useState('');
  const [commentError, setCommentError] = useState(false);
  const summary = planState.data;
  const plan = summary?.plan;
  const pendingReview = plan?.status === 'PENDING_SHIPPING';
  const submitted = pendingReview || plan?.status === 'APPROVED';
  const rows = shippingCapacityRows(submitted ? summary.sourceLocationCounts : null, settingsState.data?.shippingCapacities);
  const missingLimits = rows.some(({ limit }) => !Number.isInteger(limit));
  const overflow = rows.some((row) => row.overflow);
  const busy = isMutating || planState.loading;
  const approvalReason = settingsState.loading ? 'טוען יכולות שילוח…'
    : missingLimits ? 'יכולות השילוח אינן זמינות לאימות.'
    : overflow ? 'יש חריגה מיכולת השילוח. ניתן להחזיר את התכנית לתיקון.'
    : null;

  function openReturnDialog() {
    setComment('');
    setCommentError(false);
    dialog.current.showModal();
    commentField.current.focus();
  }

  function returnPlan(event) {
    event.preventDefault();
    if (!dialog.current?.open || !pendingReview || busy) return;
    const note = comment.trim();
    if (!note) {
      setCommentError(true);
      commentField.current.focus();
      return;
    }
    dialog.current.close();
    void mutate(() => api.returnToPlanner(role, note), 'מחזיר את התכנית…', 'התכנית הוחזרה למתכננת.');
  }

  return (
    <div className="shipping-screen">
      <section className="panel shipping-overview" aria-label="סקירת תכנית שילוח">
        <div className="stat-tile">
          <span className="stat-tile-label">מצב התכנית</span>
          {planState.loading ? <Loading label="טוען את התכנית…" /> : planState.error ? (
            <ErrorMessage label="שגיאה בטעינת התכנית" />
          ) : (
            <strong className="plan-status">{plan ? PLAN_STATUS_LABELS[plan.status] : 'טרם נוצרה תכנית'}</strong>
          )}
        </div>
        {submitted && (
          <div className="stat-tile">
            <span className="stat-tile-label">רכבים בתכנית השילוח</span>
            <strong className="stat-tile-value">{summary.capacity.selected}</strong>
          </div>
        )}
        <div className="planner-actions">
          {feedback && <p role={feedback.error ? 'alert' : 'status'}>{feedback.text}</p>}
          {pending && <span role="status">{pending}</span>}
          <button className="recommendation-secondary" id="shipping-refresh" type="button"
            disabled={busy || settingsState.loading} onClick={refresh}>רענון</button>
          {pendingReview && (
            <>
              <button className="recommendation-secondary" id="shipping-return" type="button"
                aria-haspopup="dialog" disabled={busy} onClick={openReturnDialog}>החזרה למתכננת</button>
              <button className="recommendation-primary" id="shipping-approve" type="button"
                disabled={busy || Boolean(approvalReason)}
                aria-describedby={approvalReason ? 'shipping-approval-reason' : undefined}
                onClick={() => mutate(
                  () => api.approveForShipping(role), 'מאשר את התכנית…', 'התכנית אושרה לשילוח.',
                )}>אישור שילוח</button>
            </>
          )}
        </div>
        {pendingReview && approvalReason && <p id="shipping-approval-reason" className="shipping-approval-reason">{approvalReason}</p>}
        {!planState.loading && plan?.status === 'DRAFT' && (
          <p className="shipping-approval-reason">התכנית טרם נשלחה לאישור שילוח.</p>
        )}
        {!planState.loading && plan?.status === 'RETURNED' && (
          <p className="shipping-approval-reason">התכנית ממתינה לשליחה מחדש מהמתכננת.</p>
        )}
      </section>
      <ShippingCapacityPanel settingsState={settingsState} rows={rows} />
      {plan?.status === 'RETURNED' && plan.returned_note && (
        <p className="returned-note"><strong>הערת החזרה</strong> <bdi>{plan.returned_note}</bdi></p>
      )}
      {submitted && (
        <>
          <PlanBlockerWarnings warnings={summary.blockerWarnings} />
          <ShippingVehicles vehicles={summary.selected} />
        </>
      )}
      {pendingReview && (
        <PlannerDialog name="shipping-return" dialogRef={dialog} title="החזרת התכנית למתכננת"
          description="הערת ההחזרה תוצג למתכננת כדי שתוכל לתקן את התכנית ולשלוח אותה שוב.">
          <form className="vehicle-action-form" noValidate onSubmit={returnPlan}>
            <label>
              הערת החזרה (חובה)
              <textarea ref={commentField} rows={4} dir="auto" required value={comment}
                aria-invalid={commentError || undefined}
                aria-describedby={commentError ? 'shipping-return-error' : undefined}
                onChange={(event) => { setComment(event.target.value); setCommentError(false); }} />
            </label>
            {commentError && <p className="form-error" id="shipping-return-error" role="alert">{SHIPPING_ERRORS.COMMENT_REQUIRED}</p>}
            <div className="recommendation-dialog-actions">
              <button className="recommendation-secondary" type="button" onClick={() => dialog.current.close()}>ביטול</button>
              <button className="recommendation-primary" type="submit" disabled={busy}>אישור החזרה</button>
            </div>
          </form>
        </PlannerDialog>
      )}
    </div>
  );
}
