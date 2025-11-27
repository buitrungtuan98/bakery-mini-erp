/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{html,js,svelte,ts}'],
  theme: {
    extend: {
        fontFamily: {
            sans: ['Inter', 'sans-serif'],
        },
        boxShadow: {
            'soft': '0 4px 6px -1px rgba(0, 0, 0, 0.02), 0 2px 4px -1px rgba(0, 0, 0, 0.02)', // Very subtle shadow
        }
    },
  },
  plugins: [require('daisyui')],
  daisyui: {
    logs: false,
    themes: [
        {
            light: {
                ...require("daisyui/src/theming/themes")["light"],
                primary: "#4F46E5", // Indigo 600 - Trustworthy & Modern
                "primary-focus": "#4338CA",
                secondary: "#64748B", // Slate 500 - Neutral secondary
                accent: "#0EA5E9", // Sky 500 - Friendly accent
                neutral: "#334155", // Slate 700
                "base-100": "#ffffff",
                "base-200": "#F8FAFC", // Slate 50 (Lighter than before for cleaner look)
                "base-300": "#E2E8F0", // Slate 200

                "--rounded-box": "1rem", // Softer corners for cards
                "--rounded-btn": "0.5rem", // Standard buttons
                "--tab-radius": "0.5rem",
            },
        },
    ],
  }
}