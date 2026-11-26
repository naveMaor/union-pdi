import { BRANDS, PLAN_STATUS_LABELS, SOURCE_LOCATIONS } from '../constants';
import { StatTiles } from './StatTiles';
import { Loading, ErrorMessage } from './StatusMessage';

function utilizationRatio(selected, target) {
  if (target === 0) return selected > 0 ? 1 : 0;
  return Math.min(selected / target, 1);
}

function BrandQuota({ brand, quota }) {
  const { selected, target, type, overage } = quota;
  return (
    <li className="quota-item">
      <div className="quota-name">
        <bdi dir="ltr">{brand}</bdi>
        <span>{type === 'HARD' ? 'קשיחה' : 'גמישה'}</span>
      </div>
      <div className="utilization-value">
        <bdi dir="ltr">{selected} / {target}</bdi>
        {overage > 0 && <bdi dir="ltr" className="quota-overage">+{overage}</bdi>}
      </div>
      <div className="quota-track" aria-hidden="true">
        <div
          className={overage > 0 ? 'quota-fill quota-fill-over' : 'quota-fill'}
          style={{ inlineSize: `${utilizationRatio(selected, target) * 100}%` }}
        />
      </div>
    </li>
  );
}

export function PlanSummaryPanel({ planState, settingsState, allVehiclesState, counts }) {
  const { plan, brandQuotaUtilization, sourceLocationCounts = {}, blockerWarnings = [], capacity } = planState.data || {};
  const settings = settingsState.data;
  const noPlan = plan === null;
  const currentCapacity = capacity ?? (noPlan && settings ? { selected: 0, target: settings.dailyCapacity } : null);
  const quotas = noPlan && settings ? Object.fromEntries(
    Object.entries(settings.brandQuotas).map(([brand, quota]) => [
      brand, { selected: 0, target: quota.quota_target, type: quota.quota_type, overage: 0 },
    ]),
  ) : brandQuotaUtilization;
  const shippingCapacities = settings?.shippingCapacities;

  return (
    <section className="plan-summary" aria-label="סיכום תכנון יומי">
      <div className="panel stat-strip">
        <div className="stat-tile">
          <span className="stat-tile-label">מצב התכנית</span>
          {planState.loading ? <Loading label="טוען…" /> : planState.error ? (
            <ErrorMessage error={planState.error} label="שגיאה בטעינת התכנית" />
          ) : (
            <strong className={noPlan ? 'plan-status plan-status-empty' : 'plan-status'}>
              {noPlan ? 'טרם נוצרה תכנית' : PLAN_STATUS_LABELS[plan.status] || plan.status}
            </strong>
          )}
        </div>
        <div className="stat-tile">
          <span className="stat-tile-label">קיבולת יומית</span>
          <strong className="stat-tile-value" dir="ltr">
            {currentCapacity ? `${currentCapacity.selected} / ${currentCapacity.target}` : '—'}
          </strong>
        </div>
        {allVehiclesState.loading && <Loading label="טוען סיכום רכבים…" />}
        {allVehiclesState.error && (
          <ErrorMessage error={allVehiclesState.error} label="שגיאה בטעינת סיכום הרכבים" />
        )}
        {counts && <StatTiles counts={counts} />}
      </div>

      <div className="plan-limits">
        <section className="panel limit-panel" aria-labelledby="quota-heading">
          <h2 id="quota-heading">מכסות מותגים</h2>
          {quotas ? (
            <ul className="limit-list">
              {BRANDS.filter((brand) => quotas[brand]).map((brand) => (
                <BrandQuota key={brand} brand={brand} quota={quotas[brand]} />
              ))}
            </ul>
          ) : <p className="status status-empty">נתוני מכסות זמינים לאחר טעינת התכנית וההגדרות.</p>}
        </section>

        <section className="panel limit-panel" aria-labelledby="shipping-heading">
          <h2 id="shipping-heading">יכולת שילוח לפי מקור</h2>
          {settingsState.loading && <Loading label="טוען יכולות שילוח…" />}
          {settingsState.error && (
            <ErrorMessage error={settingsState.error} label="שגיאה בטעינת הגדרות התכנון" />
          )}
          {shippingCapacities && (
            <ul className="limit-list">
              {SOURCE_LOCATIONS.map((location) => {
                const limit = shippingCapacities[location];
                const selected = planState.data ? sourceLocationCounts[location] ?? 0 : null;
                const over = selected !== null && selected > limit;
                return (
                  <li key={location} className="shipping-item">
                    <span>{location}</span>
                    <bdi dir="ltr" className={over ? 'utilization-value over-capacity' : 'utilization-value'}>
                      {selected ?? '—'} / {limit}
                    </bdi>
                    {over && <span className="over-capacity">חריגה מיכולת שילוח</span>}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      {plan?.status === 'RETURNED' && plan.returned_note && (
        <p className="returned-note"><strong>הערת החזרה</strong> <bdi>{plan.returned_note}</bdi></p>
      )}
      {blockerWarnings.length > 0 && (
        <details className="blocker-warnings">
          <summary>חסמים פעילים בתכנית ({blockerWarnings.length})</summary>
          <ul>
            {blockerWarnings.map((warning) => (
              <li key={warning.vehicle_id}>
                <bdi dir="ltr">{warning.vehicle_id} · {warning.active_blocker}</bdi>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
