'use client';
import PersonalOnboardingSteps from './PersonalOnboardingSteps';

interface Props {
  onClose: () => void;
}

export default function OnboardingWizard({ onClose }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl mx-auto overflow-hidden max-h-[90vh] flex flex-col">
        <div className="px-6 py-5 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gray-900 flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <div>
              <h1 className="text-base font-semibold text-gray-900">
                Welcome to Grant Engine
              </h1>
              <p className="text-sm text-gray-500">Set up your personal preferences</p>
            </div>
          </div>
        </div>

        <div className="px-6 py-5 overflow-y-auto flex-1">
          <PersonalOnboardingSteps onComplete={onClose} />
        </div>
      </div>
    </div>
  );
}
