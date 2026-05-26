'use client';
import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { organizations } from '@/lib/api';
import InterestBuilder from './InterestBuilder';
import AIAugmentButton from './AIAugmentButton';

const DOMAIN_SUGGESTIONS = [
  'Global Health', 'Machine Learning', 'Clinical Research', 'Public Health',
  'Epidemiology', 'Biomedical Engineering', 'Health Systems', 'Implementation Science',
];
const METHOD_SUGGESTIONS = [
  'Randomized Controlled Trial', 'Deep Learning', 'Federated Learning',
  'Systematic Review', 'Health Economic Analysis', 'Mobile Health',
];
const FUNDER_SUGGESTIONS = [
  'NIH', 'Wellcome Trust', 'Bill & Melinda Gates Foundation', 'EU Horizon',
  'UKRI', 'USAID', 'WHO', 'African Union', 'World Bank',
];

interface OrgOnboardingData {
  description: string;
  keywords: string[];
  domains: string[];
  methods: string[];
  populations: string[];
  funders: string[];
  geographies: string[];
  strategic_priorities: string[];
}

interface Props {
  onComplete: () => void;
}

export default function OrgOnboardingSteps({ onComplete }: Props) {
  const { user, refresh } = useAuth();
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [augmenting, setAugmenting] = useState(false);
  const [augmentResult, setAugmentResult] = useState<Partial<OrgOnboardingData> | null>(null);
  const [data, setData] = useState<OrgOnboardingData>({
    description: '',
    keywords: [],
    domains: [],
    methods: [],
    populations: [],
    funders: [],
    geographies: [],
    strategic_priorities: [],
  });

  function set<K extends keyof OrgOnboardingData>(key: K, value: OrgOnboardingData[K]) {
    setData(prev => ({ ...prev, [key]: value }));
  }

  async function handleAugment() {
    if (!user?.institution_id) return;
    setAugmenting(true);
    try {
      const rawInterests = [
        data.description,
        data.keywords.join(', '),
        data.domains.join(', '),
        data.methods.join(', '),
      ].filter(Boolean).join('\n\n');

      const res = await organizations.aiAugmentProfile(user.institution_id, {
        raw_interests: rawInterests,
        description: data.description,
      });
      setAugmentResult(res.data);
      // Merge AI suggestions back
      setData(prev => ({
        ...prev,
        keywords: [...new Set([...prev.keywords, ...(res.data.keywords || [])])],
        domains: [...new Set([...prev.domains, ...(res.data.domains || [])])],
        methods: [...new Set([...prev.methods, ...(res.data.methods || [])])],
        populations: [...new Set([...prev.populations, ...(res.data.populations || [])])],
        funders: [...new Set([...prev.funders, ...(res.data.funders || [])])],
        geographies: [...new Set([...prev.geographies, ...(res.data.geographies || [])])],
        strategic_priorities: res.data.strategic_priorities || prev.strategic_priorities,
      }));
    } finally {
      setAugmenting(false);
    }
  }

  async function handleComplete() {
    if (!user?.institution_id) return;
    setSaving(true);
    try {
      await organizations.completeOnboarding(user.institution_id, data);
      await refresh();
      onComplete();
    } catch {
      setSaving(false);
    }
  }

  const totalSteps = 5;

  return (
    <div className="space-y-6">
      {/* Progress */}
      <div className="flex items-center gap-1.5">
        {Array.from({ length: totalSteps }, (_, i) => (
          <div
            key={i}
            className={`h-1 flex-1 rounded-full transition-colors ${
              i < step ? 'bg-gray-900' : 'bg-gray-200'
            }`}
          />
        ))}
        <span className="text-xs text-gray-400 ml-2 whitespace-nowrap">{step}/{totalSteps}</span>
      </div>

      {step === 1 && (
        <div className="space-y-4">
          <div>
            <h3 className="text-base font-semibold text-gray-900 mb-1">Describe your organization</h3>
            <p className="text-sm text-gray-500">A brief overview helps us match better grants.</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Lab / organization description
            </label>
            <textarea
              value={data.description}
              onChange={e => set('description', e.target.value)}
              rows={4}
              placeholder="e.g. We are a global health AI research group developing diagnostic tools for low-resource settings..."
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-300 resize-none placeholder-gray-300"
            />
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setStep(2)}
              disabled={!data.description.trim()}
              className="px-5 py-2 text-sm font-medium text-white bg-gray-900 rounded-xl hover:bg-gray-700 disabled:opacity-40 transition-colors"
            >
              Continue
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <div>
            <h3 className="text-base font-semibold text-gray-900 mb-1">Research interests</h3>
            <p className="text-sm text-gray-500">Add domains, methods, and populations your lab works with.</p>
          </div>
          <InterestBuilder
            label="Research domains"
            placeholder="e.g. global health, machine learning, diagnostics..."
            value={data.domains}
            onChange={v => set('domains', v)}
            suggestions={DOMAIN_SUGGESTIONS}
          />
          <InterestBuilder
            label="Research methods"
            placeholder="e.g. federated learning, RCT, implementation science..."
            value={data.methods}
            onChange={v => set('methods', v)}
            suggestions={METHOD_SUGGESTIONS}
          />
          <InterestBuilder
            label="Target populations"
            placeholder="e.g. children under 5, LMIC, frontline workers..."
            value={data.populations}
            onChange={v => set('populations', v)}
          />
          <div className="flex justify-between">
            <button type="button" onClick={() => setStep(1)} className="text-sm text-gray-400 hover:text-gray-600">Back</button>
            <button
              type="button"
              onClick={() => setStep(3)}
              className="px-5 py-2 text-sm font-medium text-white bg-gray-900 rounded-xl hover:bg-gray-700 transition-colors"
            >
              Continue
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <div>
            <h3 className="text-base font-semibold text-gray-900 mb-1">Target funders & geographies</h3>
            <p className="text-sm text-gray-500">Which funders do you target? Where does your work focus?</p>
          </div>
          <InterestBuilder
            label="Target funders"
            placeholder="e.g. Gates Foundation, NIH, Wellcome Trust..."
            value={data.funders}
            onChange={v => set('funders', v)}
            suggestions={FUNDER_SUGGESTIONS}
          />
          <InterestBuilder
            label="Geographic focus"
            placeholder="e.g. Sub-Saharan Africa, South Asia, global..."
            value={data.geographies}
            onChange={v => set('geographies', v)}
          />
          <div className="flex justify-between">
            <button type="button" onClick={() => setStep(2)} className="text-sm text-gray-400 hover:text-gray-600">Back</button>
            <button
              type="button"
              onClick={() => setStep(4)}
              className="px-5 py-2 text-sm font-medium text-white bg-gray-900 rounded-xl hover:bg-gray-700 transition-colors"
            >
              Continue
            </button>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="space-y-4">
          <div>
            <h3 className="text-base font-semibold text-gray-900 mb-1">Strategic priorities & keywords</h3>
            <p className="text-sm text-gray-500">Add specific keywords for grant matching.</p>
          </div>
          <InterestBuilder
            label="Keywords"
            placeholder="e.g. tuberculosis, AI ultrasound, federated learning..."
            value={data.keywords}
            onChange={v => set('keywords', v)}
          />
          <InterestBuilder
            label="Strategic priorities"
            placeholder="e.g. capacity building, open science, gender equity..."
            value={data.strategic_priorities}
            onChange={v => set('strategic_priorities', v)}
          />
          <div className="flex justify-between">
            <button type="button" onClick={() => setStep(3)} className="text-sm text-gray-400 hover:text-gray-600">Back</button>
            <button
              type="button"
              onClick={() => setStep(5)}
              className="px-5 py-2 text-sm font-medium text-white bg-gray-900 rounded-xl hover:bg-gray-700 transition-colors"
            >
              Continue
            </button>
          </div>
        </div>
      )}

      {step === 5 && (
        <div className="space-y-4">
          <div>
            <h3 className="text-base font-semibold text-gray-900 mb-1">Review & AI augment</h3>
            <p className="text-sm text-gray-500">
              Review your profile below, then use AI to expand and refine your keywords for better grant matching.
            </p>
          </div>

          <div className="bg-gray-50 rounded-xl p-4 space-y-3 text-sm">
            {data.description && (
              <div>
                <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">Description</span>
                <p className="text-gray-700 mt-1">{data.description}</p>
              </div>
            )}
            {[
              { label: 'Domains', val: data.domains },
              { label: 'Methods', val: data.methods },
              { label: 'Keywords', val: data.keywords },
              { label: 'Funders', val: data.funders },
              { label: 'Geographies', val: data.geographies },
            ].filter(x => x.val.length > 0).map(({ label, val }) => (
              <div key={label}>
                <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">{label}</span>
                <div className="flex flex-wrap gap-1 mt-1">
                  {val.map(v => (
                    <span key={v} className="text-xs bg-white border border-gray-200 text-gray-600 px-2 py-0.5 rounded-full">{v}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {augmentResult?.fit_summary && (
            <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4 text-sm text-indigo-800">
              <strong className="text-xs font-semibold uppercase tracking-wider text-indigo-500 block mb-1">AI Fit Summary</strong>
              {augmentResult.fit_summary}
            </div>
          )}

          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex gap-2">
              <button type="button" onClick={() => setStep(4)} className="text-sm text-gray-400 hover:text-gray-600">Back</button>
              <AIAugmentButton onAugment={handleAugment} disabled={augmenting} />
            </div>
            <button
              type="button"
              onClick={handleComplete}
              disabled={saving}
              className="px-5 py-2 text-sm font-medium text-white bg-gray-900 rounded-xl hover:bg-gray-700 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Saving…' : 'Complete setup'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
