'use client';

import { useState, useEffect, useRef } from 'react';

export interface ProgressStepLike {
  id: string;
  label: string;
  status: 'done' | 'active' | 'pending' | 'error';
  detail?: string;
}

const TEXT_CHANGE_BUMP = 12;
const STEP_DONE_BUMP = 10;

function stepsSignature(steps: ProgressStepLike[]): string {
  return steps.map((s) => `${s.id}:${s.status}:${s.label}:${s.detail ?? ''}`).join('|');
}

/** Milestone % from completed steps only (used for snaps). */
export function stepsToProgressPct(steps: ProgressStepLike[]): number {
  if (!steps.length) return 5;
  const done = steps.filter((s) => s.status === 'done').length;
  return Math.round(5 + (done / steps.length) * 90);
}

function milestoneCeiling(steps: ProgressStepLike[]): number {
  const total = Math.max(steps.length, 1);
  const done = steps.filter((s) => s.status === 'done').length;
  const next = Math.min(done + 1, total);
  return Math.round(5 + (next / total) * 90) - 2;
}

/**
 * Animated progress for AI step logs: noticeable bump when step text changes,
 * another bump when a step completes, plus small drift while a step is active.
 */
export function useAnimatedProgressPct(
  steps: ProgressStepLike[] | null | undefined,
  isRunning: boolean,
): number {
  const [displayPct, setDisplayPct] = useState(5);
  const lastSigRef = useRef('');
  const driftRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (driftRef.current) {
      clearInterval(driftRef.current);
      driftRef.current = null;
    }

    if (!isRunning || !steps?.length) {
      if (!isRunning) {
        setDisplayPct(5);
        lastSigRef.current = '';
      }
      return;
    }

    const sig = stepsSignature(steps);
    const realPct = stepsToProgressPct(steps);
    const ceiling = milestoneCeiling(steps);
    const hasActive = steps.some((s) => s.status === 'active');

    if (sig !== lastSigRef.current) {
      const hadPriorSig = lastSigRef.current.length > 0;
      lastSigRef.current = sig;

      setDisplayPct((prev) => {
        let next = Math.max(prev, realPct);

        if (realPct > prev + 1) {
          // Step completed — jump at least STEP_DONE_BUMP
          next = Math.max(next, prev + STEP_DONE_BUMP);
        } else if (hadPriorSig) {
          // Same milestone band but label/status text changed (e.g. rotating extract messages)
          next = Math.max(next, prev + TEXT_CHANGE_BUMP);
        }

        return Math.min(next, ceiling, 96);
      });
    }

    if (hasActive) {
      driftRef.current = setInterval(() => {
        setDisplayPct((prev) => {
          const cap = Math.min(ceiling, 95);
          if (prev >= cap) return prev;
          const remaining = cap - prev;
          const step = Math.max(0.12, remaining * 0.014);
          return Math.min(prev + step, cap);
        });
      }, 550);
    }

    return () => {
      if (driftRef.current) clearInterval(driftRef.current);
    };
  }, [isRunning, steps]);

  return displayPct;
}
