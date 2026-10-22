/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        // Deep forest green primary, warm cream surfaces, neutral ink text.
        brand: {
          50: '#EEF6F0',
          100: '#D6EADC',
          200: '#ADD4B9',
          300: '#7DB892',
          400: '#4C9A6B',
          500: '#2B7D4F',
          600: '#1E6440',
          700: '#174F33',
          800: '#123D28',
          900: '#0C2A1C',
        },
        cream: { 50: '#FFFDF8', 100: '#FAF6EC', 200: '#F2EBDA', 300: '#E6DCC3' },
        ink: { 400: '#8A8F87', 500: '#6B7069', 600: '#4D524C', 700: '#353934', 800: '#232622', 900: '#151714' },
        gold: { 100: '#FBF0D2', 500: '#C9971C', 700: '#8A6510' },
        danger: { 50: '#FDECEC', 500: '#C0392B', 700: '#8E2318' },
        warning: { 50: '#FFF5E0', 500: '#B7791F' },
        info: { 50: '#EAF2FB', 500: '#2B6CB0' },
        line: '#E7E0CF',
      },
      borderRadius: { xl: '14px', '2xl': '18px' },
    },
  },
  plugins: [],
};
