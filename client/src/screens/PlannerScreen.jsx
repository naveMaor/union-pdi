import { useRef, useState } from 'react';
import { api } from '../api/client';
import { usePlanSummary, useSettings, useVehicles, useAllVehicles } from '../hooks/useApi';
import { PlanSummaryPanel } from '../components/PlanSummaryPanel';
import { VehicleFilters } from '../components/VehicleFilters';
import { VehicleTable } from '../components/VehicleTable';
import { RecommendationActions } from '../components/RecommendationActions';
import { ReplacementPanel } from '../components/ReplacementPanel';
import { VehicleActionDialog } from '../components/VehicleActionDialog';
import { Loading, ErrorMessage } from '../components/StatusMessage';
import { countVehicleTabs } from '../vehicleView';

const DEFAULT_FILTERS = { tab: 'all', search: '', brand: '', sourceLocation: '', sortByEnvelopeDate: true };

const MUTATION_ERRORS = {
  CONFIRMATION_REQUIRED: 'כבר קיימת תכנית לתאריך זה. מצב התכנית נטען מחדש.',
  PLAN_LOCKED: 'התכנית נעולה לעריכה. מצב התכנית נטען מחדש.',
  PLAN_NOT_FOUND: 'התכנית אינה זמינה. מצב התכנית נטען מחדש.',
  EMPTY_PLAN: 'לא ניתן לשלוח תכנית ריקה.',
  INELIGIBLE_VEHICLES_IN_PLAN: 'יש לטפל ברכבים לא זכאים בתכנית לפני השליחה.',
  STALE_SUGGESTION: 'החלופה השתנתה או אינה זמינה. יש לבדוק את ההצעה העדכנית לפני אישור נוסף.',
  VEHICLE_NOT_IN_PLAN: 'הרכב כבר אינו בתכנית.',
  ALREADY_EXCLUDED: 'הרכב כבר הוצא מהתכנית.',
  NO_ACTIVE_EXCLUSION: 'אין לרכב הוצאה פעילה לביטול.',
  NO_ACTIVE_BLOCKER: 'אין לרכב חסם פעיל להסרה.',
  VEHICLE_NOT_FOUND: 'הרכב אינו זמין.',
  NOTE_REQUIRED: 'יש להזין הערה עבור סיבה אחרת.',
  INVALID_REASON_CODE: 'סיבת ההוצאה אינה תקינה.',
  INVALID_BLOCKER_CODE: 'סוג החסם אינו תקין.',
  FORBIDDEN_ROLE: 'התפקיד הנוכחי אינו מורשה לבצע את הפעולה.',
};

function submissionIssue(selected) {
  if (selected.length === 0) return MUTATION_ERRORS.EMPTY_PLAN;
  if (selected.some((vehicle) => !vehicle.customs_released || vehicle.active_blocker !== 'NONE')) {
    return MUTATION_ERRORS.INELIGIBLE_VEHICLES_IN_PLAN;
  }
  return null;
}

export function PlannerScreen({ role, isMutating, setIsMutating }) {
  const [revision, setRevision] = useState(0);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [selectedVehicle, setSelectedVehicle] = useState(null);
  const [pending, setPending] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const mutationInFlight = useRef(false);
  const planState = usePlanSummary(role, revision);
  const settingsState = useSettings(role, revision);
  const allVehiclesState = useAllVehicles(role, revision);
  const vehiclesState = useVehicles(role, filters, revision);
  const globalVehicles = allVehiclesState.data?.vehicles;
  const counts = globalVehicles && countVehicleTabs(globalVehicles);
  const vehicles = vehiclesState.data?.vehicles;
  const plan = planState.data?.plan;
  const editable = plan?.status === 'DRAFT' || plan?.status === 'RETURNED';
  const locked = plan?.status === 'PENDING_SHIPPING' || plan?.status === 'APPROVED';
  const actionsDisabled = isMutating || planState.loading;
  // The summary contains every selected vehicle, regardless of the table filters.
  const submitReason = editable ? submissionIssue(planState.data.selected) : null;

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
        text: MUTATION_ERRORS[error.code] ?? 'לא התקבל אישור על שמירת הפעולה. מצב התכנית נטען מחדש.',
      });
    } finally {
      // A failed response may also leave the view out of date.
      refresh();
      mutationInFlight.current = false;
      setPending(null);
      setIsMutating(false);
    }
  }

  return (
    <div className="planner-screen">
      <PlanSummaryPanel
        planState={planState}
        settingsState={settingsState}
        allVehiclesState={allVehiclesState}
        counts={counts}
      />

      <section className="panel vehicle-panel" aria-labelledby="vehicle-heading">
        <VehicleFilters
          filters={filters}
          counts={counts}
          onChange={setFilters}
          actions={
            <div className="planner-actions">
              {feedback && <p role={feedback.error ? 'alert' : 'status'}>{feedback.text}</p>}
              {pending && <span role="status">{pending}</span>}
              <RecommendationActions
                plan={plan}
                editable={editable}
                disabled={actionsDisabled || Boolean(planState.error) || plan === undefined}
                onGenerate={(confirm) => mutate(
                  () => api.generatePlan(role, { confirm }), 'מריצה המלצה…', 'ההמלצה נשמרה.',
                )}
              />
              {editable && (
                <>
                  {submitReason && <p id="submit-plan-reason">{submitReason}</p>}
                  <button
                    id="submit-plan"
                    className="recommendation-primary"
                    type="button"
                    disabled={actionsDisabled || Boolean(submitReason)}
                    aria-describedby={submitReason ? 'submit-plan-reason' : undefined}
                    onClick={() => mutate(
                      () => api.submitForShipping(role), 'שולחת לאישור שילוח…', 'התכנית נשלחה לאישור שילוח.',
                    )}
                  >
                    שליחה לאישור שילוח
                  </button>
                </>
              )}
            </div>
          }
        />
        {editable && !planState.loading && (
          <ReplacementPanel
            role={role}
            revision={revision}
            capacity={planState.data.capacity}
            disabled={isMutating}
            onRefresh={refresh}
            onConfirm={(vehicleId) => mutate(
              () => api.confirmReplacement(role, vehicleId), 'מוסיפה חלופה…', 'החלופה נוספה לתכנית.',
            )}
          />
        )}
        <div className="vehicle-results" aria-busy={vehiclesState.loading}>
          {vehiclesState.loading ? <Loading /> : vehiclesState.error ? (
            <ErrorMessage error={vehiclesState.error} />
          ) : vehicles && (
            <VehicleTable
              key={JSON.stringify(filters)}
              vehicles={vehicles}
              sortByEnvelopeDate={filters.sortByEnvelopeDate}
              settings={settingsState.data}
              actionsDisabled={actionsDisabled}
              onVehicleAction={setSelectedVehicle}
            />
          )}
        </div>
      </section>
      {selectedVehicle && (
        <VehicleActionDialog
          role={role}
          vehicle={selectedVehicle}
          editable={editable}
          locked={locked}
          disabled={actionsDisabled}
          onClose={() => setSelectedVehicle(null)}
          mutate={mutate}
        />
      )}
    </div>
  );
}
