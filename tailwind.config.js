/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{html,js,svelte,ts}'],
  theme: {
    extend: {
        fontFamily: {
            sans: ['Inter', 'sans-serif'],
        }
    },
  },
  plugins: [require('daisyui')],
  daisyui: {
    themes: [
        {
            light: {
                ...require("daisyui/src/theming/themes")["light"],
                primary: "#4F46E5", // Indigo 600
                "primary-focus": "#4338CA",
                secondary: "#64748B", // Slate 500
                accent: "#0EA5E9", // Sky 500
                neutral: "#334155", // Slate 700
                "base-100": "#ffffff",
                "base-200": "#F1F5F9", // Slate 100
                "base-300": "#E2E8F0", // Slate 200
            },
        },
    ],
  }
}