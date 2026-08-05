import type { Config } from "tailwindcss";
export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        page: "#E7EAE5",
        panel: "#FFFFFF",
        ink: "#171A17",
        muted: "#5E655C",
        rule: "#C9CEC5",
        pine: "#0F5C4B",
        pineLight: "#E3EFEA",
        bronze: "#8A6220",
        bronzeLight: "#F5EDDF",
      },
      fontFamily: {
        sans: ["Archivo", "system-ui", "sans-serif"],
        mono: ["IBM Plex Mono", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
} satisfies Config;
