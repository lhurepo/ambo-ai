import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        ambo: {
          abyss: "#00141D",
          "navy-dark": "#001B27",
          navy: "#002A3C",
          "navy-elevated": "#07374D",
          "navy-mid": "#0B435B",
          teal: "#2A7B96",
          "teal-hover": "#3892B0",
          sky: "#6FB3C8",
          ice: "#EBF4F7",
          parchment: "#F7F5F0",
          ink: "#0D1F28",
          slate: "#4E6470",
          border: "#0E4A64",
        },
        garden: {
          light: "#FFFFFF",
          vine: "#BDD630",
          soil: "#121413",
          dew: "#F4F2E6",
          root: "#1D3519",
        },
      },
      fontFamily: {
        sans: ["var(--font-jakarta)", "'Plus Jakarta Sans'", "system-ui", "sans-serif"],
        jakarta: ["var(--font-jakarta)", "'Plus Jakarta Sans'", "sans-serif"],
        poppins: ["var(--font-poppins)", "Poppins", "sans-serif"],
        merriweather: ["var(--font-merriweather)", "Merriweather", "serif"],
        montserrat: ["var(--font-montserrat)", "Montserrat", "sans-serif"],
        raleway: ["var(--font-raleway)", "Raleway", "sans-serif"],
        bebas: ["var(--font-bebas)", "'Bebas Neue'", "sans-serif"],
        fredoka: ["var(--font-fredoka)", "Fredoka", "sans-serif"],
        workSans: ["var(--font-work-sans)", "'Work Sans'", "sans-serif"],
        libreBaskerville: ["var(--font-libre-baskerville)", "'Libre Baskerville'", "serif"],
        courierPrime: ["var(--font-courier-prime)", "'Courier Prime'", "monospace"],
        resolve: ["var(--font-resolve)", "'Resolve Compressed'", "sans-serif"],
        yankee: ["var(--font-yankee)", "Yankee", "sans-serif"],
      },
    },
  },
  plugins: [require("@tailwindcss/typography")],
};

export default config;
