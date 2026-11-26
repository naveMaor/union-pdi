import { ROLE_LABELS } from '../constants';

export function ComingSoonScreen({ role }) {
  return (
    <section className="panel">
      <p className="status status-empty">
        מסך {ROLE_LABELS[role]} יתווסף בשלב הבא.
      </p>
    </section>
  );
}
