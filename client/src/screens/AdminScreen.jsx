import { useRef, useState } from 'react';
import { api } from '../api/client';
import { BRANDS, SOURCE_LOCATIONS } from '../constants';
import { useSettings } from '../hooks/useApi';
import { usePlanMutation } from '../hooks/usePlanMutation';
import { PlannerDialog } from '../components/PlannerDialog';
import { ErrorMessage, Loading } from '../components/StatusMessage';

const MAX_INTEGER = 2147483647;
const SETTING_FIELDS = [
  { key: 'dailyCapacity', id: 'admin-daily-capacity', label: 'קיבולת יומית', min: 1 },
  { key: 'envelopeYellowThresholdDays', id: 'admin-yellow-threshold', label: 'סף צהוב (ימים)', min: 0 },
  { key: 'envelopeRedThresholdDays', id: 'admin-red-threshold', label: 'סף אדום (ימים)', min: 0 },
];
const SHIPPING_FIELDS = SOURCE_LOCATIONS.map((location, index) => ({
  key: location, id: `admin-shipping-${index}`, label: location, min: 0,
}));
const QUOTA_FIELDS = BRANDS.map((brand) => ({
  key: brand, id: `admin-quota-target-${brand}`, typeId: `admin-quota-type-${brand}`, min: 0,
}));
const ADMIN_ERRORS = {
  INVALID_SETTING_VALUE: 'השרת דחה את הערכים. יש לבדוק את ההגדרות ולנסות שוב.',
  FORBIDDEN_ROLE: 'לתפקיד הנוכחי אין הרשאה לשמור הגדרות.',
};

// Demo-only, off-by-default feature (see README.md "Demo Reset"). Restores
// the original 300-vehicle dataset, settings and a null-plan state — never a
// security mechanism, documented transparently as a demo convenience.
const RESET_CONFIRM_PHRASE = 'איפוס נתוני דמו';
const RESET_ERRORS = {
  FORBIDDEN_ROLE: 'לתפקיד הנוכחי אין הרשאה לאפס נתוני דמו.',
  INVALID_RESET_TOKEN: 'סיסמת האיפוס שגויה או חסרה.',
  TOO_MANY_ATTEMPTS: 'יותר מדי ניסיונות שגויים. יש לנסות שוב מאוחר יותר.',
  RESET_RATE_LIMITED: 'בוצע איפוס נתוני דמו לאחרונה. יש לנסות שוב בעוד דקה.',
  CONFIRMATION_REQUIRED: 'יש לאשר את פעולת האיפוס.',
  RESET_IN_PROGRESS: 'איפוס נתוני דמו אחר כבר רץ כעת.',
  'Not Found': 'תכונת איפוס נתוני הדמו אינה זמינה בסביבה זו.',
};

function buildUpdate(settings, edits) {
  const patch = {};
  const errors = {};
  function number(field, saved) {
    const raw = edits[field.id]?.trim();
    if (raw === undefined) return saved;
    const value = Number(raw);
    if (!/^[0-9]+$/.test(raw) || value < field.min || value > MAX_INTEGER) {
      errors[field.id] = raw === '' ? 'יש להזין ערך.'
        : value > MAX_INTEGER ? `הערך המרבי הוא ${MAX_INTEGER}.`
        : `יש להזין מספר שלם גדול או שווה ל־${field.min}.`;
    }
    return value;
  }

  for (const field of SETTING_FIELDS) {
    const value = number(field, settings[field.key]);
    if (value !== settings[field.key]) patch[field.key] = value;
  }
  for (const field of QUOTA_FIELDS) {
    const current = settings.brandQuotas[field.key];
    const target = number(field, current.quota_target);
    const type = edits[field.typeId] ?? current.quota_type;
    if (target !== current.quota_target || type !== current.quota_type) {
      patch.brandQuotas ??= {};
      patch.brandQuotas[field.key] = { quota_target: target, quota_type: type };
    }
  }
  for (const field of SHIPPING_FIELDS) {
    const current = settings.shippingCapacities[field.key];
    const value = number(field, current);
    if (value !== current) {
      patch.shippingCapacities ??= {};
      patch.shippingCapacities[field.key] = value;
    }
  }
  return { patch, errors };
}

function NumberField({ field, label = field.label, value, error, onChange }) {
  return (
    <div className="admin-field">
      <label htmlFor={field.id}>{label}</label>
      <input id={field.id} name={field.id} type="text" inputMode="numeric" dir="ltr" required
        value={value} onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? true : undefined} aria-describedby={error ? `${field.id}-error` : undefined} />
      {error && <span className="form-error" id={`${field.id}-error`}>{error}</span>}
    </div>
  );
}

export function AdminScreen({ role, isMutating, setIsMutating, showDemoReset }) {
  const { revision, pending, feedback, refresh, mutate, clearFeedback } = usePlanMutation(
    setIsMutating, ADMIN_ERRORS, 'לא התקבל אישור על שמירת ההגדרות. ההגדרות מהשרת נטענות מחדש.',
  );
  const { data: settings, loading, error } = useSettings(role, revision);
  const [edits, setEdits] = useState({});
  const [errors, setErrors] = useState({});
  const discardDialog = useRef(null);
  const cancelDiscard = useRef(null);

  const resetMutation = usePlanMutation(
    setIsMutating, RESET_ERRORS, 'לא התקבל אישור על איפוס נתוני הדמו.',
  );
  const [resetToken, setResetToken] = useState('');
  const [resetConfirmText, setResetConfirmText] = useState('');
  const resetDialog = useRef(null);
  const cancelReset = useRef(null);
  const resetReady = resetToken.length > 0 && resetConfirmText === RESET_CONFIRM_PHRASE;

  // Hiding via the PDI badge (App.jsx) clears both fields immediately —
  // never left sitting in memory once the section is collapsed. Adjusted
  // during render, not an effect, per React's "you might not need an
  // effect" guidance.
  const [clearedForShowDemoReset, setClearedForShowDemoReset] = useState(showDemoReset);
  if (showDemoReset !== clearedForShowDemoReset) {
    setClearedForShowDemoReset(showDemoReset);
    if (!showDemoReset) {
      setResetToken('');
      setResetConfirmText('');
    }
  }

  function openResetDialog(event) {
    event.preventDefault();
    if (!resetReady || isMutating) return;
    resetDialog.current.showModal();
    cancelReset.current.focus();
  }

  function runReset() {
    resetDialog.current.close();
    const token = resetToken;
    // Cleared immediately, win or lose — never kept around longer than the
    // one request that uses it, never written to localStorage/sessionStorage.
    setResetToken('');
    setResetConfirmText('');
    void resetMutation.mutate(async () => {
      await api.demoReset(role, token);
      refresh(); // reloads this screen's settings; Planner/Shipping screens refetch on their own next read
    }, 'מאפס נתוני דמו…', 'נתוני הדמו אופסו למצב המקורי.');
  }
  const dirty = Object.keys(edits).length > 0;
  const hasErrors = Object.keys(errors).length > 0;
  const busy = loading || isMutating;

  function edit(id, next, saved) {
    setEdits((previous) => {
      const nextEdits = { ...previous };
      if (next === String(saved)) delete nextEdits[id];
      else nextEdits[id] = next;
      return nextEdits;
    });
    if (errors[id]) setErrors(({ [id]: _removed, ...remaining }) => remaining);
    clearFeedback();
  }

  function numeric(field, saved, label) {
    return <NumberField key={field.id} field={field} label={label} value={edits[field.id] ?? String(saved)}
      error={errors[field.id]} onChange={(next) => edit(field.id, next, saved)} />;
  }

  function discardAndReload() {
    discardDialog.current.close();
    setEdits({});
    setErrors({});
    clearFeedback();
    refresh();
  }

  function requestReload() {
    if (dirty) {
      discardDialog.current.showModal();
      cancelDiscard.current.focus();
    } else {
      discardAndReload();
    }
  }

  function save(event) {
    event.preventDefault();
    if (busy || !dirty || !settings) return;
    clearFeedback();
    const { patch, errors: invalid } = buildUpdate(settings, edits);
    setErrors(invalid);
    const firstError = Object.keys(invalid)[0];
    if (firstError) {
      event.currentTarget.elements.namedItem(firstError)?.focus();
      return;
    }
    if (Object.keys(patch).length === 0) {
      setEdits({});
      return;
    }
    void mutate(async () => {
      await api.updateSettings(role, patch);
      setEdits({});
    }, 'שומר הגדרות…', 'ההגדרות נשמרו.');
  }

  return (
    <section className="admin-screen" aria-labelledby="admin-settings-heading">
      <form id="admin-settings" className="admin-settings-form" noValidate onSubmit={save} aria-busy={busy}>
        <div className="panel admin-overview">
          <div>
            <h2 id="admin-settings-heading">הגדרות תכנון ושילוח</h2>
            <p>קיבולת ומכסות נשמרות בתכנית בעת יצירת ההמלצה. שינויים בהן יחולו בהרצה הבאה.</p>
          </div>
          <div className="admin-toolbar">
            <button id="admin-reload" className="recommendation-secondary" type="button" disabled={busy}
              onClick={requestReload}>טעינה מחדש</button>
            <button id="admin-save" className="recommendation-primary" type="submit"
              disabled={busy || !settings || !dirty}>שמירת הגדרות</button>
          </div>
        </div>

        {pending && <p className="admin-feedback" role="status">{pending}</p>}
        {feedback && <p className="admin-feedback" role={feedback.error ? 'alert' : 'status'}>{feedback.text}</p>}
        {hasErrors && <p className="admin-feedback" role="alert">יש לתקן את הערכים המסומנים לפני השמירה.</p>}
        {loading && !pending && <Loading label="טוען הגדרות מהשרת…" />}
        {error && <div role="alert"><ErrorMessage label="לא ניתן לטעון את ההגדרות. אפשר לנסות טעינה מחדש." /></div>}

        {settings && (
          <div className="admin-grid">
            <div className="admin-stack">
              <fieldset className="panel admin-panel" disabled={busy}>
                <legend>קיבולת יומית</legend>
                {numeric(SETTING_FIELDS[0], settings.dailyCapacity, 'מספר רכבים ליום')}
              </fieldset>
              <fieldset className="panel admin-panel" disabled={busy}>
                <legend>ספי התרעת מעטפה</legend>
                <p>הספים משנים את צבע ההתראה בתצוגה בלבד. הם אינם משפיעים על בחירת הרכבים.</p>
                <div className="admin-field-grid">
                  {SETTING_FIELDS.slice(1).map((field) => numeric(field, settings[field.key]))}
                </div>
              </fieldset>
              <fieldset className="panel admin-panel" disabled={busy}>
                <legend>יכולות שילוח</legend>
                <p>אישור שילוח בודק את המגבלות העדכניות לכל מקור.</p>
                <div className="admin-field-grid">
                  {SHIPPING_FIELDS.map((field) => numeric(field, settings.shippingCapacities[field.key]))}
                </div>
              </fieldset>
            </div>
            <fieldset className="panel admin-panel admin-quotas" disabled={busy}>
              <legend>מכסות מותגים</legend>
              <p>מכסה קשיחה מגבילה את מספר הרכבים. מכסה גמישה מציינת יעד שאפשר לחרוג ממנו.</p>
              {QUOTA_FIELDS.map((field) => {
                const quota = settings.brandQuotas[field.key];
                return (
                  <div key={field.key} className="admin-quota-row" role="group" aria-labelledby={`${field.id}-brand`}>
                    <bdi id={`${field.id}-brand`} className="admin-quota-brand" dir="ltr">{field.key}</bdi>
                    {numeric(field, quota.quota_target, 'יעד מכסה')}
                    <div className="admin-field">
                      <label htmlFor={field.typeId}>סוג מכסה</label>
                      <select id={field.typeId} name={field.typeId} value={edits[field.typeId] ?? quota.quota_type}
                        onChange={(event) => edit(field.typeId, event.target.value, quota.quota_type)}>
                        <option value="HARD">קשיחה</option>
                        <option value="FLEX">גמישה</option>
                      </select>
                    </div>
                  </div>
                );
              })}
            </fieldset>
          </div>
        )}
      </form>

      {showDemoReset && (
        <form className="admin-danger-zone panel" noValidate onSubmit={openResetDialog} aria-busy={isMutating}>
          <h2>איפוס סביבת ההדגמה</h2>
          <p>שחזור 300 הרכבים והגדרות המערכת למצבם המקורי.</p>
          <p className="admin-danger-warning">
            <strong>פעולה זו תמחק את כל התכניות והשינויים שבוצעו במערכת. לא ניתן לבטל את הפעולה.</strong>
          </p>
          <div className="admin-field">
            <label htmlFor="admin-reset-token">סיסמת איפוס</label>
            <input id="admin-reset-token" type="password" autoComplete="off" dir="ltr"
              value={resetToken} onChange={(event) => setResetToken(event.target.value)} />
          </div>
          <div className="admin-field">
            <label htmlFor="admin-reset-confirm">{`לאישור הפעולה, יש להקליד '${RESET_CONFIRM_PHRASE}'`}</label>
            <input id="admin-reset-confirm" type="text" autoComplete="off"
              value={resetConfirmText} onChange={(event) => setResetConfirmText(event.target.value)} />
          </div>
          {resetMutation.pending && <p className="admin-feedback" role="status">{resetMutation.pending}</p>}
          {resetMutation.feedback && (
            <p className="admin-feedback" role={resetMutation.feedback.error ? 'alert' : 'status'}>
              {resetMutation.feedback.text}
            </p>
          )}
          <button id="admin-reset-open" className="recommendation-danger" type="submit"
            disabled={isMutating || !resetReady}>איפוס סביבת ההדגמה</button>
        </form>
      )}

      <PlannerDialog name="admin-discard" dialogRef={discardDialog} title="טעינה מחדש של ההגדרות"
        description="השינויים שלא נשמרו יבוטלו וההגדרות העדכניות ייטענו מהשרת.">
        <div className="recommendation-dialog-actions">
          <button ref={cancelDiscard} className="recommendation-secondary" type="button"
            onClick={() => discardDialog.current.close()}>ביטול</button>
          <button id="admin-confirm-reload" className="recommendation-primary" type="button"
            onClick={discardAndReload}>ביטול שינויים וטעינה</button>
        </div>
      </PlannerDialog>

      <PlannerDialog name="admin-reset" dialogRef={resetDialog} title="אישור איפוס סביבת ההדגמה"
        description="פעולה זו תמחק את כל התכניות והשינויים שבוצעו במערכת. לא ניתן לבטל את הפעולה.">
        <div className="recommendation-dialog-actions">
          <button ref={cancelReset} className="recommendation-secondary" type="button"
            onClick={() => resetDialog.current.close()}>ביטול</button>
          <button id="admin-confirm-reset" className="recommendation-danger" type="button"
            onClick={runReset}>כן, אפס את סביבת ההדגמה</button>
        </div>
      </PlannerDialog>
    </section>
  );
}
