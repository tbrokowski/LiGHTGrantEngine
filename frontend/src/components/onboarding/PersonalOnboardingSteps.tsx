'use client';
import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { userOnboarding } from '@/lib/api';
import InterestBuilder from './InterestBuilder';

const GRANT_CATEGORIES = [
  { id: 'phd_funding', label: 'PhD Funding' },
  { id: 'postdoc_fellowship', label: 'Postdoc Fellowship' },
  { id: 'pi_grants', label: 'PI / Independent Researcher Grants' },
  { id: 'lab_grants', label: 'Lab / Team Grants' },
  { id: 'humanitarian_ai', label: 'Humanitarian AI' },
  { id: 'clinical_ai', label: 'Clinical AI' },
  { id: 'global_health', label: 'Global Health' },
  { id: 'foundation_grants', label: 'Foundation Grants' },
  { id: 'government_grants', label: 'Government Grants' },
  { id: 'travel_awards', label: 'Travel Awards / Conferences' },
  { id: 'early_career', label: 'Early Career Awards' },
  { id: 'implementation_science', label: 'Implementation Science' },
];

interface Props {
  onComplete: () => void;
}

export default function PersonalOnboardingSteps({ onComplete }: Props) {
  const { refresh } = useAuth();
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [categories, setCategories] = useState<string[]>([]);
  const [keywords, setKeywords] = useState<string[]>([]);

  function toggleCategory(id: string) {
    setCategories(prev =>
      prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]
    );
  }

  async function handleComplete() {
    setSaving(true);
    try {
      await userOnboarding.complete({ grant_categories: categories, keywords });
      await refresh();
      onComplete();
    } catch {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Progress */}
      <div className="flex items-center gap-1.5">
        {[1, 2, 3].map(i => (
          <div
            key={i}
            className={`h-1 flex-1 rounded-full transition-colors ${i <= step ? 'bg-gray-900' : 'bg-gray-200'}`}
          />
        ))}
        <span className="text-xs text-gray-400 ml-2 whitespace-nowrap">{step}/3</span>
      </div>

      {step === 1 && (
        <div className="space-y-4">
          <div>
            <h3 className="text-base font-semibold text-gray-900 mb-1">What kinds of grants are you looking for?</h3>
            <p className="text-sm text-gray-500">Select all that apply.</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {GRANT_CATEGORIES.map(cat => (
              <button
                key={cat.id}
                type="button"
                onClick={() => toggleCategory(cat.id)}
                className={`text-left text-sm px-3 py-2.5 rounded-xl border transition-colors ${
                  categories.includes(cat.id)
                    ? 'bg-gray-900 text-white border-gray-900'
                    : 'bg-white text-gray-700 border-gray-200 hover:border-gray-300'
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setStep(2)}
              disabled={categories.length === 0}
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
            <h3 className="text-base font-semibold text-gray-900 mb-1">Add specific keywords</h3>
            <p className="text-sm text-gray-500">
              Add topics, methods, diseases, or technologies you focus on. These help match grants precisely.
            </p>
          </div>
          <InterestBuilder
            label="Your research keywords"
            placeholder="e.g. tuberculosis, federated learning, AI ultrasound..."
            value={keywords}
            onChange={setKeywords}
          />
          <p className="text-xs text-gray-400">
            Examples: tuberculosis, federated learning, AI ultrasound, global health, implementation science
          </p>
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
            <h3 className="text-base font-semibold text-gray-900 mb-1">Review your profile</h3>
            <p className="text-sm text-gray-500">This will be used to match grants to your interests.</p>
          </div>

          <div className="bg-gray-50 rounded-xl p-4 space-y-3 text-sm">
            <div>
              <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">Grant types</span>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {categories.map(c => {
                  const label = GRANT_CATEGORIES.find(g => g.id === c)?.label ?? c;
                  return (
                    <span key={c} className="text-xs bg-white border border-gray-200 text-gray-600 px-2 py-0.5 rounded-full">{label}</span>
                  );
                })}
              </div>
            </div>
            {keywords.length > 0 && (
              <div>
                <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">Keywords</span>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {keywords.map(k => (
                    <span key={k} className="text-xs bg-white border border-gray-200 text-gray-600 px-2 py-0.5 rounded-full">{k}</span>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-between">
            <button type="button" onClick={() => setStep(2)} className="text-sm text-gray-400 hover:text-gray-600">Back</button>
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
