import { TABS, BRANDS, SOURCE_LOCATIONS } from '../constants';

export function VehicleFilters({ filters, counts, onChange, actions }) {
  return (
    <div className="vehicle-filters">
      <div className="vehicle-toolbar-heading">
        <h2 id="vehicle-heading">רשימת רכבים</h2>
        <div className="tabs" role="group" aria-label="סינון לפי מצב בתכנית">
          {TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              aria-pressed={filters.tab === tab.value}
              className="tab"
              onClick={() => onChange({ ...filters, tab: tab.value })}
            >
              {tab.label}
              {counts && <span className="tab-count">{counts[tab.value]}</span>}
            </button>
          ))}
        </div>
        {actions}
      </div>

      <div className="filter-row">
        <label className="vehicle-search">
          חיפוש (מזהה רכב או שלדה)
          <input
            type="search"
            dir="ltr"
            value={filters.search}
            onChange={(e) => onChange({ ...filters, search: e.target.value })}
            placeholder="PDI-001 / DEMO-000001"
          />
        </label>

        <label>
          מותג
          <select
            value={filters.brand}
            onChange={(e) => onChange({ ...filters, brand: e.target.value })}
          >
            <option value="">כל המותגים</option>
            {BRANDS.map((brand) => (
              <option key={brand} value={brand}>
                {brand}
              </option>
            ))}
          </select>
        </label>

        <label>
          מיקום מקור
          <select
            value={filters.sourceLocation}
            onChange={(e) => onChange({ ...filters, sourceLocation: e.target.value })}
          >
            <option value="">כל המקורות</option>
            {SOURCE_LOCATIONS.map((location) => (
              <option key={location} value={location}>
                {location}
              </option>
            ))}
          </select>
        </label>

        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={filters.sortByEnvelopeDate}
            onChange={(e) => onChange({ ...filters, sortByEnvelopeDate: e.target.checked })}
          />
          מיין לפי תאריך מעטפה
        </label>
      </div>
    </div>
  );
}
