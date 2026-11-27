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
        <div className="app-brand"><bdi dir="ltr">UNION MOTORS <span>PDI</span></bdi></div>
      </header>

      <main>
        {role === 'PLANNER' ? (
          <PlannerScreen role={role} isMutating={isMutating} setIsMutating={setIsMutating} />
        ) : role === 'SHIPPING' ? (
          <ShippingScreen role={role} isMutating={isMutating} setIsMutating={setIsMutating} />
        ) : <AdminScreen role={role} isMutating={isMutating} setIsMutating={setIsMutating} />}
      </main>
    </div>
  );
}

export default App;
