/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        // Legacy — kept for existing components not yet migrated
        light: { 50: '#f0f9ff', 500: '#0ea5e9', 700: '#0369a1', 900: '#0c4a6e' },

        // Ledger Console semantic tokens — use these in all new/refactored code
        surface: {
          base:    'var(--surface-base)',
          raised:  'var(--surface-raised)',
          sunken:  'var(--surface-sunken)',
          panel:   'var(--surface-panel)',
        },
        ink: {
          primary:   'var(--ink-primary)',
          secondary: 'var(--ink-secondary)',
          muted:     'var(--ink-muted)',
          faint:     'var(--ink-faint)',
          inverse:   'var(--ink-inverse)',
        },
        rule: {
          subtle: 'var(--rule-subtle)',
          strong: 'var(--rule-strong)',
          accent: 'var(--rule-accent)',
        },
        accent: {
          primary:   'var(--accent-primary)',
          secondary: 'var(--accent-secondary)',
          warm:      'var(--accent-warm)',
          cool:      'var(--accent-cool)',
        },
        state: {
          success:    'var(--state-success)',
          successBg:  'var(--state-success-bg)',
          warning:    'var(--state-warning)',
          warningBg:  'var(--state-warning-bg)',
          danger:     'var(--state-danger)',
          dangerBg:   'var(--state-danger-bg)',
          info:       'var(--state-info)',
          infoBg:     'var(--state-info-bg)',
        },
      },
      fontFamily: {
        sans: ['var(--font-geist-sans)', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
        mono: ['var(--font-geist-mono)', 'Fira Mono', 'Courier New', 'monospace'],
      },
      borderRadius: {
        xs: 'var(--radius-xs)',
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
      },
      boxShadow: {
        panel:    'var(--shadow-panel)',
        floating: 'var(--shadow-floating)',
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
};
