/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        neon: {
          cyan: '#00f3ff',
          magenta: '#ff00ff',
          purple: '#8a2be2',
        },
        /* The site's own palette — distinct from the demo stage's neon trio
           (which deliberately mirrors the app's "Modern" in-app theme). Named
           for the product's domain rather than generic brand colours. */
        signal: {
          teal: '#5ef2d6',
          violet: '#8f7bff',
        },
        ink: {
          950: '#07070b',
          900: '#0b0b11',
          850: '#101017',
          800: '#15151e',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['Fira Code', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
    },
  },
  plugins: [],
};
