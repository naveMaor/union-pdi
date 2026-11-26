export function StatTiles({ counts }) {
  const { all, in_plan: inPlan, ineligible } = counts;
  const tiles = [
    { label: 'סה״כ רכבים', value: all },
    { label: 'בתכנית', value: inPlan },
    { label: 'זכאים', value: all - ineligible },
    { label: 'לא זכאים', value: ineligible, className: 'stat-tile-ineligible' },
  ];

  return (
    <>
      {tiles.map((tile) => (
        <div className={tile.className ? `stat-tile ${tile.className}` : 'stat-tile'} key={tile.label}>
          <div className="stat-tile-label">{tile.label}</div>
          <div className="stat-tile-value">{tile.value}</div>
        </div>
      ))}
    </>
  );
}
