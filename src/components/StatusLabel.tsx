import React from 'react';

type Tone = 'neutral' | 'verified' | 'warning' | 'danger' | 'bronze';

const TONE_CLASSES: Record<Tone, string> = {
  neutral: 'bg-[#F5F4EF] text-[#4A504C] border-[#D8DAD3]',
  verified: 'bg-[#EDF3EE] text-[#2F5237] border-[#B8CEBD]',
  warning: 'bg-[#FAF5EB] text-[#7A5922] border-[#E3CFA9]',
  danger: 'bg-[#FDF1F1] text-[#8E2A2A] border-[#E9BEBE]',
  bronze: 'bg-[#F7F3EC] text-[#7D5E2D] border-[#DFCFAF]',
};

export function resolveStatusTone(value: string): Tone {
  const upper = (value || '').toUpperCase();
  if (
    [
      'ENCRYPTED',
      'INTEGRITY VERIFIED',
      'VALID',
      'ACTIVE',
      'SUCCESS',
      'OPEN',
      'CLOSED',
    ].includes(upper)
  ) {
    if (upper === 'OPEN') return 'bronze';
    if (upper === 'CLOSED') return 'neutral';
    return 'verified';
  }
  if (
    [
      'PENDING',
      'UNDER_REVIEW',
      'MEDIUM',
      'HIGH',
      'WARNING',
      'UNAVAILABLE',
      'LOCKED',
    ].includes(upper)
  ) {
    return 'warning';
  }
  if (
    [
      'INTEGRITY MISMATCH',
      'VERIFICATION FAILED',
      'INVALID',
      'FAILED',
      'FAILURE',
      'DISABLED',
      'CRITICAL',
    ].includes(upper)
  ) {
    return 'danger';
  }
  return 'neutral';
}

export function StatusLabel({
  value,
  tone,
}: {
  value: string;
  tone?: Tone;
}) {
  const resolved = tone || resolveStatusTone(value);
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 text-[11px] font-semibold tracking-wide border rounded-[3px] whitespace-nowrap shrink-0 ${TONE_CLASSES[resolved]}`}
    >
      {value.replace(/_/g, ' ')}
    </span>
  );
}
