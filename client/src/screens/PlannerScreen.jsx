import { useState } from 'react';
import { usePlanSummary, useSettings, useVehicles, useAllVehicles } from '../hooks/useApi';
import { PlanSummaryPanel } from '../components/PlanSummaryPanel';
import { VehicleFilters } from '../components/VehicleFilters';
import { VehicleTable } from '../components/VehicleTable';
import { RecommendationActions } from '../components/RecommendationActions';
import { Loading, ErrorMessage } from '../components/StatusMessage';
import { countVehicleTabs } from '../vehicleView';

const DEFAULT_FILTERS = { tab: 'all', search: '', brand: '', sourceLocation: '', sortByEnvelopeDate: true };

export function PlannerScreen({ role, isGenerating, setIsGenerating }) {
  const [revision, setRevision] = useState(0);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const planState = usePlanSummary(role, revision);
  const settingsState = useSettings(role, revision);
  const allVehiclesState = useAllVehicles(role, revision);
  const vehiclesState = useVehicles(role, filters, revision);
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
        <VehicleFilters
          filters={filters}
          counts={counts}
          onChange={setFilters}
          actions={
            <RecommendationActions
              role={role}
              planState={planState}
              isGenerating={isGenerating}
              setIsGenerating={setIsGenerating}
              onRefresh={() => setRevision((value) => value + 1)}
            />
          }
        />
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
