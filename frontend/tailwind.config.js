/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: { 950: '#081426', 900: '#0b1b33', 850: '#0f2342', 800: '#142238', 700: '#1c3155' },
        brand: { 50: '#eef4ff', 100: '#dce7ff', 200: '#bcd0ff', 300: '#8fb0ff', 400: '#5b87fb', 500: '#2563eb', 600: '#1d4fd8', 700: '#1a3fae', 800: '#1b388a', 900: '#1c346e' },
        cyan: { accent: '#06b6d4' },
        ochre: { 300: '#f3c7a0', 400: '#e9a26b', 500: '#d97c3b', 600: '#b85f26' },
        ink: '#172033',
        muted: '#64748b',
        line: '#e2e8f0',
        canvas: '#f5f7fb',
        success: '#16a34a',
        warning: '#eab308',
        danger: '#dc2626',
        risk: { green: '#16a34a', yellow: '#eab308', orange: '#f97316', red: '#dc2626' },
      },
      fontFamily: {
        sans: ['Inter', 'Segoe UI', 'system-ui', 'sans-serif'],
        display: ['Sora', 'Inter', 'Segoe UI', 'sans-serif'],
        mono: ['JetBrains Mono', 'Consolas', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(16,27,45,.06), 0 1px 3px rgba(16,27,45,.05)',
        lift: '0 10px 30px -12px rgba(16,27,45,.28)',
      },
      borderRadius: { xl2: '1rem' },
      keyframes: {
        fadeUp: { from: { opacity: '0', transform: 'translateY(6px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        slideIn: { from: { transform: 'translateX(100%)' }, to: { transform: 'translateX(0)' } },
      },
      animation: { fadeUp: 'fadeUp .25s ease-out', slideIn: 'slideIn .25s ease-out' },
    },
  },
  plugins: [],
}
