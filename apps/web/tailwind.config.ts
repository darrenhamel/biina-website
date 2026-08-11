import type { Config } from 'tailwindcss';

/**
 * BIINA.ai product theme.
 *
 * Related to the marketing navy, but a distinct product identity: warm paper,
 * deep navy ink, and a single confident TEAL accent (not generic SaaS blue).
 * Colours are driven by CSS variables (see globals.css) so a dark theme and
 * persona theming can be layered on later without touching components.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx,mdx}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        // Semantic tokens → CSS variables.
        ink: 'rgb(var(--c-ink) / <alpha-value>)',
        'ink-soft': 'rgb(var(--c-ink-soft) / <alpha-value>)',
        'ink-faint': 'rgb(var(--c-ink-faint) / <alpha-value>)',
        paper: 'rgb(var(--c-paper) / <alpha-value>)',
        'paper-raised': 'rgb(var(--c-paper-raised) / <alpha-value>)',
        'paper-sunken': 'rgb(var(--c-paper-sunken) / <alpha-value>)',
        line: 'rgb(var(--c-line) / <alpha-value>)',
        'line-strong': 'rgb(var(--c-line-strong) / <alpha-value>)',
        accent: 'rgb(var(--c-accent) / <alpha-value>)',
        'accent-strong': 'rgb(var(--c-accent-strong) / <alpha-value>)',
        'accent-soft': 'rgb(var(--c-accent-soft) / <alpha-value>)',
        'on-accent': 'rgb(var(--c-on-accent) / <alpha-value>)',
        // The dark app shell (sidebar / rails).
        shell: 'rgb(var(--c-shell) / <alpha-value>)',
        'shell-raised': 'rgb(var(--c-shell-raised) / <alpha-value>)',
        'on-shell': 'rgb(var(--c-on-shell) / <alpha-value>)',
        'on-shell-soft': 'rgb(var(--c-on-shell-soft) / <alpha-value>)',
        gold: 'rgb(var(--c-gold) / <alpha-value>)',
        danger: 'rgb(var(--c-danger) / <alpha-value>)',
        success: 'rgb(var(--c-success) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        arabic: ['var(--font-arabic)', 'var(--font-sans)', 'sans-serif'],
      },
      borderRadius: {
        xl: '14px',
        '2xl': '20px',
      },
      maxWidth: {
        prose: '46rem',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        blink: { '0%,100%': { opacity: '1' }, '50%': { opacity: '0' } },
      },
      animation: {
        'fade-in': 'fade-in 0.25s ease-out',
        blink: 'blink 1s step-start infinite',
      },
    },
  },
  plugins: [],
};

export default config;
