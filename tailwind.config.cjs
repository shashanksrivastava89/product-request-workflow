/******** DO NOT add or remove comments ********/
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          'Meiryo',
          'Meiryo UI',
          'Inter',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Yu Gothic UI',
          'Yu Gothic',
          'MS PGothic',
          'Hiragino Sans',
          'Hiragino Kaku Gothic ProN',
          'Roboto',
          'Oxygen',
          'Ubuntu',
          'Cantarell',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [],
}
