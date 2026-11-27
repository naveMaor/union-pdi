export function PlannerDialog({ name, dialogRef, title, description, onCancel, children }) {
  return (
    <dialog
      ref={dialogRef}
      className={`planner-dialog ${name}-dialog`}
      aria-labelledby={`${name}-title`}
      aria-describedby={description ? `${name}-description` : undefined}
      onCancel={onCancel}
    >
      <h2 id={`${name}-title`}>{title}</h2>
      {description && <p id={`${name}-description`}>{description}</p>}
      {children}
    </dialog>
  );
}
