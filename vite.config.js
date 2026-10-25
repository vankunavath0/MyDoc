import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'





export default defineConfig({
  plugins: [react()],
  server: {
    allowedHosts: ["mydoc-k6h0.onrender.com"],
    host: "0.0.0.0",
  },
});

