import { useState } from 'react';
import { usePlanSummary, useSettings, useVehicles, useAllVehicles } from '../hooks/useApi';
import { PlanSummaryPanel } from '../components/PlanSummaryPanel';
import { VehicleFilters } from '../components/VehicleFilters';
import { VehicleTable } from '../components/VehicleTable';
import { Loading, ErrorMessage } from '../components/StatusMessage';
import { countVehicleTabs } from '../vehicleView';

const DEFAULT_FILTERS = { tab: 'all', search: '', brand: '', sourceLocation: '', sortByEnvelopeDate: true };

export function PlannerScreen({ role }) {
  const planState = usePlanSummary(role);
  const settingsState = useSettings(role);
  const allVehiclesState = useAllVehicles(role);

  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const vehiclesState = useVehicles(role, filters);
  const globalVehicles = allVehiclesState.data?.vehicles;
  const counts = globalVehicles && countVehicleTabs(globalVehicles);
  const vehicles = vehiclesState.data?.vehicles;

  return (
    <div className="planner-screen">
      <PlanSummaryPanel
        planState={planState}
        settingsState={settingsState}
        allVehiclesState={allVehiclesState}
        counts={counts}
      />

      <section className="panel vehicle-panel" aria-labelledby="vehicle-heading">
        <VehicleFilters filters={filters} counts={counts} onChange={setFilters} />
        <div className="vehicle-results" aria-busy={vehiclesState.loading}>
          {vehiclesState.loading ? <Loading /> : vehiclesState.error ? (
            <ErrorMessage error={vehiclesState.error} />
          ) : vehicles && (
            <VehicleTable
              key={JSON.stringify(filters)}
              vehicles={vehicles}
              sortByEnvelopeDate={filters.sortByEnvelopeDate}
              settings={settingsState.data}
            />
          )}
        </div>
      </section>
    </div>
  );
}
