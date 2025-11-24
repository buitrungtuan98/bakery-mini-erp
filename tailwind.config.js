/** @type {import('tailwindcss').Config} */
export default {
  // Dòng này cực quan trọng: Quét file trong src
  content: ['./src/**/*.{html,js,svelte,ts}'],
  theme: {
    extend: {},
  },
  plugins: [require('daisyui')],
  daisyui: {
    themes: ["light"], // Cố định theme sáng
  }
}