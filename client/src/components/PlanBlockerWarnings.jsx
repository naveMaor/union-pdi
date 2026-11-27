export function PlanBlockerWarnings({ warnings }) {
  if (warnings.length === 0) return null;

  return (
    <details className="blocker-warnings">
      <summary>חסמים פעילים בתכנית ({warnings.length})</summary>
      <ul>
        {warnings.map((warning) => (
          <li key={warning.vehicle_id}>
            <bdi dir="ltr">{warning.vehicle_id} · {warning.active_blocker}</bdi>
          </li>
        ))}
      </ul>
    </details>
  );
}
