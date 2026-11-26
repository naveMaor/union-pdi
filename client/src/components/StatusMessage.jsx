export function Loading({ label = 'טוען נתונים…' }) {
  return <p className="status status-loading">{label}</p>;
}

export function ErrorMessage({ error, label = 'שגיאה בטעינת הנתונים' }) {
  return (
    <p className="status status-error">
      {label}
      {error?.message ? `: ${error.message}` : ''}
    </p>
  );
}
