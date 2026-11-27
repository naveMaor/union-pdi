import { useReplacement } from '../hooks/useApi';

export function ReplacementPanel({ role, revision, capacity, disabled, onConfirm, onRefresh }) {
  const { data, loading, error } = useReplacement(role, revision);
  const candidate = data?.suggestedReplacement;
  const full = capacity.selected >= capacity.target;

  return (
    <section className="replacement-panel" aria-labelledby="replacement-heading" aria-busy={loading}>
      <h3 id="replacement-heading">חלופה מוצעת</h3>
      {loading ? <p>בודקת חלופה…</p> : error ? (
        <>
          <p role="alert">
            {error.code === 'PLAN_LOCKED' ? 'התכנית ננעלה. יש לרענן את מצב התכנית.' : 'טעינת החלופה נכשלה.'}
          </p>
          <button className="recommendation-secondary" type="button" disabled={disabled} onClick={onRefresh}>
            רענון
          </button>
        </>
      ) : candidate ? (
        <>
          <p className="replacement-candidate">
            <bdi dir="ltr" className="identifier">{candidate.vehicle_id}</bdi>
            <bdi dir="ltr">{candidate.brand} {candidate.model}</bdi>
            <bdi>{candidate.source_location}</bdi>
          </p>
          <button className="recommendation-primary" type="button" disabled={disabled} onClick={() => onConfirm(candidate.vehicle_id)}>
            הוספת החלופה לתכנית
          </button>
        </>
      ) : (
        <p>{full ? 'אין מקום לחלופה. התכנית בקיבולת מלאה.' : 'אין כרגע חלופה מתאימה.'}</p>
      )}
    </section>
  );
}
