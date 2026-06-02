const TYPE_STYLES: Record<string, string> = {
  grant:       'bg-blue-50 text-blue-700',
  fellowship:  'bg-violet-50 text-violet-700',
  scholarship: 'bg-purple-50 text-purple-700',
  residency:   'bg-teal-50 text-teal-700',
  open_call:   'bg-orange-50 text-orange-700',
  prize:       'bg-yellow-50 text-yellow-700',
  bursary:     'bg-green-50 text-green-700',
  commission:  'bg-rose-50 text-rose-700',
  other:       'bg-gray-100 text-gray-500',
};

const TYPE_LABELS: Record<string, string> = {
  grant:       'Grant',
  fellowship:  'Fellowship',
  scholarship: 'Scholarship',
  residency:   'Residency',
  open_call:   'Open Call',
  prize:       'Prize',
  bursary:     'Bursary',
  commission:  'Commission',
  other:       'Other',
};

interface Props {
  type: string | null | undefined;
  size?: 'sm' | 'xs';
}

export default function OpportunityTypeBadge({ type, size = 'sm' }: Props) {
  if (!type) return null;
  const style = TYPE_STYLES[type] ?? TYPE_STYLES.other;
  const label = TYPE_LABELS[type] ?? type;
  const px = size === 'xs' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-xs';
  return (
    <span className={`inline-flex items-center rounded-md font-medium ${px} ${style}`}>
      {label}
    </span>
  );
}
