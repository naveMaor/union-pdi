import { SOURCE_LOCATIONS } from './constants';

export function shippingCapacityRows(counts, capacities) {
  return SOURCE_LOCATIONS.map((location) => {
    const selected = counts ? counts[location] ?? 0 : null;
    const limit = capacities?.[location];
    return {
      location,
      selected,
      limit,
      overflow: selected !== null && selected > limit,
    };
  });
}
