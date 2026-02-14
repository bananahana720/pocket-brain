/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './index.html',
    './App.tsx',
    './index.tsx',
    './components/**/*.{ts,tsx}',
    './contexts/**/*.{ts,tsx}',
    './hooks/**/*.{ts,tsx}',
    './services/**/*.{ts,tsx}',
    './storage/**/*.{ts,tsx}',
    './utils/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#ecfeff',
          100: '#cffafe',
          200: '#a5f3fc',
          300: '#67e8f9',
          400: '#22d3ee',
          500: '#06b6d4',
          600: '#0891b2',
          700: '#0e7490',
          800: '#155e75',
          900: '#164e63',
        },
      },
      fontFamily: {
        sans: ['Barlow', 'Segoe UI', 'sans-serif'],
        display: ['Teko', 'Impact', 'sans-serif'],
      },
      animation: {
        'fade-in': 'fadeIn 0.35s ease-out forwards',
        'slide-up': 'slideUp 0.45s cubic-bezier(0.2, 0.8, 0.2, 1) forwards',
        'slide-right': 'slideRight 0.35s cubic-bezier(0.2, 0.8, 0.2, 1) forwards',
        'signal-sweep': 'signalSweep 4.5s linear infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { transform: 'translateY(14px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        slideRight: {
          '0%': { transform: 'translateX(-22px)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' },
        },
        signalSweep: {
          '0%': { transform: 'translateX(-130%) skewX(-28deg)' },
          '100%': { transform: 'translateX(220%) skewX(-28deg)' },
        },
      },
    },
  },
  plugins: [],
};
