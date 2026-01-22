/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./app/index.html",
    "./index.tsx",
    "./App.tsx",
    "./components/**/*.{ts,tsx}",
    "./services/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}

