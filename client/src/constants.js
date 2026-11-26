export const PLAN_DATE = '2026-11-23';

export const ROLES = ['PLANNER', 'SHIPPING', 'ADMIN'];

export const ROLE_LABELS = {
  PLANNER: 'מתכננת',
  SHIPPING: 'מאשר שילוח',
  ADMIN: 'מנהל מערכת',
};

export const ROLE_NAMES = {
  PLANNER: 'מיכל לוי',
  SHIPPING: 'יוסי כהן',
  ADMIN: 'רונית שמש',
};

export const TABS = [
  { value: 'in_plan', label: 'בתכנית' },
  { value: 'eligible_not_in_plan', label: 'זכאים שלא נכנסו' },
  { value: 'ineligible', label: 'לא זכאים' },
  { value: 'all', label: 'הכול' },
];

export const BRANDS = ['Toyota', 'Lexus', 'Geely', 'GAC', 'Zeekr'];

export const SOURCE_LOCATIONS = ['נמל אשדוד', 'נמל חיפה', 'בונדד אשדוד', 'בונדד חיפה'];

export const REASON_LABELS = {
  NOT_CUSTOMS_RELEASED: 'לא שוחרר ממכס',
  ACTIVE_BLOCKER: 'חסם פעיל',
  MANUALLY_EXCLUDED: 'הוצא ידנית',
  HARD_QUOTA_EXCEEDED: 'מכסת המותג (קשיחה) נוצלה',
  OVER_CAPACITY: 'מעבר לקיבולת',
  NOT_SELECTED: 'לא נבחר בהרצה הנוכחית',
};

// SPEC §8.3 manual-exclusion reason codes — a distinct code space from
// REASON_LABELS above (which are "why isn't this vehicle in the plan" codes).
export const EXCLUSION_REASON_LABELS = {
  PRIORITIZED_OTHER: 'תועדף רכב אחר לפי הנחיית הגורם האחראי',
  SECURITY_FORCES: 'רכב של כוחות הביטחון',
  OPERATIONAL_DELAY: 'עיכוב תפעולי זמני',
  ACCESSORY_ISSUE: 'חוסר אביזר או שינוי אבזור',
  AUTHORITY_INSTRUCTION: 'הנחיית גורם מוסמך אחרת',
  OTHER: 'סיבה אחרת',
};

export const PLAN_STATUS_LABELS = {
  DRAFT: 'טיוטה',
  PENDING_SHIPPING: 'ממתינה לאישור שילוח',
  APPROVED: 'אושרה',
  RETURNED: 'הוחזרה לתיקון',
};
