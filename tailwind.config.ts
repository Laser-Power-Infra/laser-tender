import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./hooks/**/*.{ts,tsx}",
    "./pages/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "Inter",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
        mono: ["ui-monospace", "monospace"],
      },
      colors: {
        navy: {
          DEFAULT: "#0a2540",
          light: "#1e3d59",
        },
        brand: {
          DEFAULT: "#0070f3",
          dark: "#0056b3",
        },
        excel: {
          DEFAULT: "#107c41",
          dark: "#0b5930",
        },
        line: "#e1e6eb",
        mist: "#f4f6f8",
      },
    },
  },
  plugins: [],
};

export default config;
