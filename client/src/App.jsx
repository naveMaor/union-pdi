import { useState } from 'react';
import { PLAN_DATE, ROLES, ROLE_LABELS, ROLE_NAMES } from './constants';
import { formatDate } from './vehicleView';
import { PlannerScreen } from './screens/PlannerScreen';
import { ShippingScreen } from './screens/ShippingScreen';
import { AdminScreen } from './screens/AdminScreen';
import './App.css';

function App() {
  const [role, setRole] = useState('PLANNER');
  const [isMutating, setIsMutating] = useState(false);
  // Hidden by default; toggled only via the PDI badge below, only while in
  // Admin mode. Reset on every role change (adjusted during render, not an
  // effect, per React's "you might not need an effect" guidance) so
  // re-entering Admin always starts collapsed again — never persisted.
  const [showDemoReset, setShowDemoReset] = useState(false);
  const [showDemoResetForRole, setShowDemoResetForRole] = useState(role);
  if (role !== showDemoResetForRole) {
    setShowDemoResetForRole(role);
    setShowDemoReset(false);
  }

  return (
    <div className={`app app-${role.toLowerCase()}`}>
      <header className="app-header">
        <h1>{role === 'PLANNER' ? 'תכנון יומי' : ROLE_LABELS[role]}</h1>
        <p className="plan-date">
          תאריך התכנית <time dateTime={PLAN_DATE} dir="ltr">{formatDate(PLAN_DATE)}</time>
        </p>
        <div className="role-switcher">
          <label htmlFor="role-select">תפקיד</label>
          <select id="role-select" aria-describedby="role-disclaimer" value={role} disabled={isMutating} onChange={(e) => setRole(e.target.value)}>
            {ROLES.map((roleCode) => (
              <option key={roleCode} value={roleCode}>
                {ROLE_NAMES[roleCode]} · {ROLE_LABELS[roleCode]}
              </option>
            ))}
          </select>
        </div>
        <p className="role-disclaimer" id="role-disclaimer">
          הדמיית תפקידים לצורך המטלה בלבד. אינה מנגנון אבטחה.
        </p>
        <div className="app-brand">
          <bdi dir="ltr">
            UNION MOTORS{' '}
            <button type="button" id="pdi-badge-toggle" className="pdi-badge"
              disabled={role !== 'ADMIN'} aria-pressed={showDemoReset}
              aria-label="הצגה או הסתרה של איפוס סביבת הדגמה (זמין במצב מנהל מערכת בלבד)"
              onClick={() => setShowDemoReset((value) => !value)}>PDI</button>
          </bdi>
        </div>
      </header>

      <main>
        {role === 'PLANNER' ? (
          <PlannerScreen role={role} isMutating={isMutating} setIsMutating={setIsMutating} />
        ) : role === 'SHIPPING' ? (
          <ShippingScreen role={role} isMutating={isMutating} setIsMutating={setIsMutating} />
        ) : <AdminScreen role={role} isMutating={isMutating} setIsMutating={setIsMutating}
              showDemoReset={showDemoReset} />}
      </main>
    </div>
  );
}

export default App;
