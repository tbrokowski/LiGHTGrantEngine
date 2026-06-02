'use client';

import { useState } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { finance } from '@/lib/api';

interface Props {
  grantId: string;
}

export default function ForecastPanel({ grantId }: Props) {
  const [data, setData] = useState<{
    months?: { month: string; projected_spend: number; cumulative: number }[];
    runway_months?: number | null;
    summary?: string;
    alerts?: string[];
  } | null>(null);
  const [loading, setLoading] = useState(false);

  const runForecast = async () => {
    setLoading(true);
    try {
      const res = await finance.aiForecast(grantId);
      setData(res.data);
    } catch {
      alert('Forecast failed.');
    } finally {
      setLoading(false);
    }
  };

  const chartData = (data?.months ?? []).map(m => ({
    month: m.month,
    spend: m.projected_spend,
    cumulative: m.cumulative,
  }));

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600">
        AI projects burn rate and runway from your ledger and expenditure history.
      </p>
      <button
        type="button"
        onClick={runForecast}
        disabled={loading}
        className="text-xs px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50"
      >
        {loading ? 'Generating forecast…' : 'Generate 12-month forecast'}
      </button>

      {data && (
        <>
          {data.summary && (
            <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-4 text-sm text-emerald-800">
              {data.summary}
              {data.runway_months != null && (
                <p className="mt-2 font-semibold">Estimated runway: {data.runway_months} months</p>
              )}
            </div>
          )}
          {data.alerts && data.alerts.length > 0 && (
            <ul className="text-xs text-amber-700 space-y-1">
              {data.alerts.map((a, i) => (
                <li key={i}>• {a}</li>
              ))}
            </ul>
          )}
          {chartData.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl p-4 h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Line type="monotone" dataKey="cumulative" name="Cumulative" stroke="#10b981" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="spend" name="Monthly" stroke="#6366f1" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </>
      )}
    </div>
  );
}
