import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // WhatsApp-inspired palette.
        wa: {
          green: "#25D366",
          teal: "#128C7E",
          dark: "#075E54",
          panel: "#f0f2f5",
          bubbleOut: "#d9fdd3",
          bubbleIn: "#ffffff",
          chatbg: "#efeae2",
        },
      },
    },
  },
  plugins: [],
};

export default config;
