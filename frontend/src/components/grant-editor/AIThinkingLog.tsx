'use client';

import { useState, useEffect, useRef } from 'react';
import { ChevronDown } from 'lucide-react';

export interface AIThinkingStep {
  id: string;
  label: string;
  status: 'done' | 'active' | 'pending' | 'error';
  detail?: string;
  subSteps?: string[];
}

interface AIThinkingLogProps {
  steps: AIThinkingStep[];
  progressPct: number;
  title?: string;
  error?: string;
  className?: string;
}

function StepIcon({ status }: { status: AIThinkingStep['status'] }) {
  if (status === 'done') {
    return (
      <span className="text-green-500 text-xs shrink-0 mt-0.5 w-4 text-center">✓</span>
    );
  }
  if (status === 'active') {
    return (
      <span className="shrink-0 mt-1 w-4 flex items-center justify-center">
        <span className="block w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
      </span>
    );
  }
  if (status === 'error') {
    return (
      <span className="text-red-500 text-xs shrink-0 mt-0.5 w-4 text-center">✗</span>
    );
  }
  return (
    <span className="text-gray-200 text-xs shrink-0 mt-0.5 w-4 text-center">·</span>
  );
}

function StepRow({ step }: { step: AIThinkingStep }) {
  const [subOpen, setSubOpen] = useState(false);
  const hasSubSteps = step.subSteps && step.subSteps.length > 0;

  return (
    <div className="space-y-0.5">
      <div className="flex items-start gap-1">
        <StepIcon status={step.status} />
        <span
          className={
            step.status === 'done'
              ? 'text-gray-400 text-xs leading-snug'
              : step.status === 'active'
              ? 'text-gray-800 text-xs font-medium leading-snug'
              : step.status === 'error'
              ? 'text-red-600 text-xs leading-snug'
              : 'text-gray-300 text-xs leading-snug'
          }
        >
          {step.label}
        </span>
        {hasSubSteps && step.status !== 'pending' && (
          <button
            type="button"
            onClick={() => setSubOpen((v) => !v)}
            className="ml-1 shrink-0"
            aria-label={subOpen ? 'Collapse' : 'Expand'}
          >
            <ChevronDown
              className={`w-3 h-3 text-gray-500 transition-transform ${subOpen ? '' : '-rotate-90'}`}
            />
          </button>
        )}
      </div>
      {step.detail && step.status === 'error' && (
        <p className="pl-5 text-xs text-red-500 leading-snug">{step.detail}</p>
      )}
      {hasSubSteps && subOpen && (
        <div className="pl-5 space-y-0.5 border-l border-gray-100 ml-2 mt-1">
          {step.subSteps!.map((sub, i) => (
            <p key={i} className="text-xs text-gray-500 leading-snug">{sub}</p>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AIThinkingLog({
  steps,
  progressPct,
  title,
  error,
  className = '',
}: AIThinkingLogProps) {
  // Local animated percentage — slowly advances during active steps so the bar
  // visibly moves even when no step flips to "done" (e.g. during the long LLM call).
  const [displayPct, setDisplayPct] = useState(progressPct);
  const earnedRef = useRef(progressPct);

  // Snap to real value whenever a step completes (prop jumps forward)
  useEffect(() => {
    earnedRef.current = progressPct;
    setDisplayPct(progressPct);
  }, [progressPct]);

  // Ease-out drift while any step is active — faster at start, slows near ceiling.
  // Ceiling is 25% above the last real earned value so the bar keeps moving throughout
  // even long LLM steps (60-90s), without ever falsely crossing the next milestone.
  const isActive = steps.some((s) => s.status === 'active');
  useEffect(() => {
    if (!isActive) return;
    const interval = setInterval(() => {
      setDisplayPct((prev) => {
        const cap = Math.min(earnedRef.current + 25, 95);
        if (prev >= cap) return prev;
        const remaining = cap - prev;
        // Ease-out: step shrinks as we approach ceiling
        const step = Math.max(0.1, remaining * 0.018);
        return Math.min(prev + step, cap);
      });
    }, 700);
    return () => clearInterval(interval);
  }, [isActive]);

  return (
    <div className={`space-y-3 ${className}`}>
      {/* Header + bar */}
      <div className="space-y-1.5">
        {title && (
          <p className="text-xs font-medium text-gray-700">{title}</p>
        )}
        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-indigo-400"
            style={{ width: `${Math.max(3, displayPct)}%`, transition: 'width 1s cubic-bezier(0.4, 0, 0.2, 1)' }}
          />
        </div>
      </div>

      {/* Steps */}
      {steps.length > 0 && (
        <div className="space-y-1.5">
          {steps.map((step) => (
            <StepRow key={step.id} step={step} />
          ))}
        </div>
      )}

      {/* Error */}
      {error && (
        <p className="text-xs text-red-600 leading-snug">{error}</p>
      )}
    </div>
  );
}

// Utility: compute progress % from steps array
export function stepsToProgressPct(steps: AIThinkingStep[]): number {
  if (!steps.length) return 5;
  const done = steps.filter((s) => s.status === 'done').length;
  return Math.round(5 + (done / steps.length) * 90);
}
