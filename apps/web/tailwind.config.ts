import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",          // apps/web içindeysen bu yeter
    // eğer yukarıda farklı root'tan çalışıyorsan:
    // "./apps/web/src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: { extend: {} },
  plugins: [],
};

export default config;