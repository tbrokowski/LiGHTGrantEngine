'use client';

import { useState } from 'react';
import LedgerOverview from './LedgerOverview';
import FundRequestPanel from './FundRequestPanel';
import ExpenditureLog from './ExpenditureLog';
import ForecastPanel from './ForecastPanel';
import SlackSetupPanel from './SlackSetupPanel';

type FinanceSubTab = 'ledger' | 'requests' | 'expenditures' | 'forecast' | 'slack';

const SUB_TABS: { id: FinanceSubTab; label: string }[] = [
  { id: 'ledger', label: 'Ledger' },
  { id: 'requests', label: 'Fund Requests' },
  { id: 'expenditures', label: 'Expenditures' },
  { id: 'forecast', label: 'Forecast' },
  { id: 'slack', label: 'Slack' },
];

interface Props {
  grantId: string;
  grantTitle: string;
  currency?: string;
  isEditor?: boolean;
}

export default function FinanceHub({ grantId, grantTitle, currency, isEditor = true }: Props) {
  const [subTab, setSubTab] = useState<FinanceSubTab>('ledger');
  const [ledgerKey, setLedgerKey] = useState(0);

  const refreshLedger = () => setLedgerKey(k => k + 1);

  return (
    <div className="p-4 space-y-4">
      <div className="flex gap-1 border-b border-gray-200">
        {SUB_TABS.map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => setSubTab(t.id)}
            className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors ${
              subTab === t.id
                ? 'border-emerald-600 text-emerald-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {subTab === 'ledger' && (
        <LedgerOverview
          key={ledgerKey}
          grantId={grantId}
          grantTitle={grantTitle}
          isEditor={isEditor}
          onRefresh={refreshLedger}
        />
      )}
      {subTab === 'requests' && (
        <FundRequestPanel
          grantId={grantId}
          currency={currency}
          isEditor={isEditor}
          onLedgerChange={refreshLedger}
        />
      )}
      {subTab === 'expenditures' && (
        <ExpenditureLog grantId={grantId} currency={currency} isEditor={isEditor} onRefresh={refreshLedger} />
      )}
      {subTab === 'forecast' && <ForecastPanel grantId={grantId} />}
      {subTab === 'slack' && <SlackSetupPanel grantId={grantId} isEditor={isEditor} />}
    </div>
  );
}
