import { Loading, ErrorMessage } from './StatusMessage';

export function ShippingCapacityPanel({ settingsState, rows }) {
  return (
    <section className="panel limit-panel" aria-labelledby="shipping-heading">
      <h2 id="shipping-heading">יכולת שילוח לפי מקור</h2>
      {settingsState.loading && <Loading label="טוען יכולות שילוח…" />}
      {settingsState.error && (
        <ErrorMessage error={settingsState.error} label="שגיאה בטעינת הגדרות התכנון" />
      )}
      {settingsState.data && (
        <ul className="limit-list">
          {rows.map(({ location, selected, limit, overflow }) => (
            <li key={location} className="shipping-item">
              <span>{location}</span>
              <bdi dir="ltr" className={overflow ? 'utilization-value over-capacity' : 'utilization-value'}>
                {selected ?? '—'} / {limit ?? '—'}
              </bdi>
              {overflow && <span className="over-capacity">חריגה מיכולת שילוח</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
