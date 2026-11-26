import { REASON_LABELS, EXCLUSION_REASON_LABELS } from '../constants';
import { envelopeAge, formatDate } from '../vehicleView';

function statusCell(vehicle) {
  if (vehicle.inPlan) {
    return (
      <span className="chip chip-in-plan">
        בתכנית{vehicle.source && <> <bdi dir="ltr">({vehicle.source})</bdi></>}
      </span>
    );
  }
  if (vehicle.reason === null) return <span className="chip">טרם תוכנן</span>;

  return (
    <span className="chip chip-reason">
      {REASON_LABELS[vehicle.reason] ?? <bdi dir="ltr">{vehicle.reason}</bdi>}
    </span>
  );
}

function exclusionDetail(exclusion) {
  if (!exclusion) return null;
  return (
    <details className="exclusion-detail">
      <summary>פרטי הוצאה</summary>
      <dl>
        <dt>סיבה</dt>
        <dd>{EXCLUSION_REASON_LABELS[exclusion.reason_code] ?? <bdi dir="ltr">{exclusion.reason_code}</bdi>}</dd>
        {exclusion.note && (
          <>
            <dt>הערה</dt>
            <dd><bdi>{exclusion.note}</bdi></dd>
          </>
        )}
        <dt>בוצע על ידי</dt>
        <dd><bdi>{exclusion.excluded_by_name}</bdi> <bdi dir="ltr">({exclusion.excluded_by_role})</bdi></dd>
        <dt>מועד</dt>
        <dd>
          <time dateTime={exclusion.excluded_at} dir="ltr">
            {new Date(exclusion.excluded_at).toLocaleString('he-IL')}
          </time>
        </dd>
      </dl>
    </details>
  );
}

function EnvelopeAge({ date, settings }) {
  const age = envelopeAge(date);
  if (!Number.isFinite(age)) return '—';

  let warning;
  if (settings && age >= settings.envelopeRedThresholdDays) warning = 'גבוהה';
  else if (settings && age >= settings.envelopeYellowThresholdDays) warning = 'בינונית';

  const warningClass = warning === 'גבוהה' ? 'age-high' : warning ? 'age-medium' : '';
  return (
    <span className={`chip age-chip ${warningClass}`}>
      <bdi dir="ltr">{age}</bdi> ימים
      {warning && <> · {warning}</>}
    </span>
  );
}

export function VehicleTable({ vehicles, sortByEnvelopeDate, settings }) {
  return (
    <>
      {vehicles.length > 0 ? (
        <div className="vehicle-scroll" role="region" aria-labelledby="vehicle-heading" tabIndex={0}>
          <table className="vehicle-table">
            <thead>
              <tr>
                <th scope="col" aria-sort={sortByEnvelopeDate ? undefined : 'ascending'}>מזהה רכב</th>
                <th scope="col">שלדה</th>
                <th scope="col">מותג ודגם</th>
                <th scope="col">מקור</th>
                <th scope="col" aria-sort={sortByEnvelopeDate ? 'ascending' : undefined}>
                  תאריך מעטפה{sortByEnvelopeDate && <span aria-hidden="true"> ↑</span>}
                </th>
                <th scope="col">ימי מעטפה</th>
                <th scope="col">מסירה מבוקשת</th>
                <th scope="col">אוכלוסייה</th>
                <th scope="col">מגזר לקוח</th>
                <th scope="col">שוחרר ממכס</th>
                <th scope="col">חסם</th>
                <th scope="col" className="plan-state-column">מצב בתכנית</th>
              </tr>
            </thead>
            <tbody>
              {vehicles.map((vehicle) => {
                const hasBlocker = vehicle.active_blocker !== 'NONE';

                return (
                  <tr key={vehicle.vehicle_id} className={vehicle.inPlan && hasBlocker ? 'blocked-member' : undefined}>
                    <th scope="row"><bdi dir="ltr" className="identifier">{vehicle.vehicle_id}</bdi></th>
                    <td><bdi dir="ltr" className="identifier">{vehicle.demo_vin}</bdi></td>
                    <td className="vehicle-model"><bdi dir="ltr">{vehicle.brand} {vehicle.model}</bdi></td>
                    <td className="vehicle-source">{vehicle.source_location}</td>
                    <td><time dateTime={vehicle.envelope_date} dir="ltr">{formatDate(vehicle.envelope_date)}</time></td>
                    <td><EnvelopeAge date={vehicle.envelope_date} settings={settings} /></td>
                    <td><time dateTime={vehicle.requested_delivery_date} dir="ltr">{formatDate(vehicle.requested_delivery_date)}</time></td>
                    <td><bdi dir="ltr">{vehicle.population}</bdi></td>
                    <td><bdi dir="ltr">{vehicle.customer_segment}</bdi></td>
                    <td><span className={vehicle.customs_released ? 'chip chip-in-plan' : 'chip chip-danger'}>
                      {vehicle.customs_released ? 'כן' : 'לא'}
                    </span></td>
                    <td className="vehicle-blocker">
                      {hasBlocker ? (
                        <span className="chip chip-danger">
                          <span aria-hidden="true">⚠ </span><bdi dir="ltr">{vehicle.active_blocker}</bdi>
                        </span>
                      ) : '—'}
                    </td>
                    <td className="plan-state-column">
                      {statusCell(vehicle)}
                      {vehicle.inPlan && hasBlocker && <span className="member-warning">חסם פעיל בתכנית</span>}
                      {exclusionDetail(vehicle.exclusion)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : <p className="status status-empty">לא נמצאו רכבים התואמים את הסינון.</p>}
      <p className="results-count" aria-live="polite">{vehicles.length} רכבים בתוצאה זו</p>
    </>
  );
}
