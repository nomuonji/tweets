import type { Config } from "tailwindcss";

/**
 * Every colour below reads space-separated RGB channels from a CSS variable so
 * that opacity modifiers (`bg-primary/90`) resolve correctly. Keep the token
 * definitions in `src/app/globals.css` in the same channel format.
 */
const withAlpha = (variable: string) => `rgb(var(${variable}) / <alpha-value>)`;

const config: Config = {
  darkMode: "class",
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: withAlpha("--background"),
        foreground: withAlpha("--foreground"),
        surface: {
          DEFAULT: withAlpha("--surface"),
          hover: withAlpha("--surface-hover"),
          active: withAlpha("--surface-active"),
        },
        "surface-hover": withAlpha("--surface-hover"),
        "surface-active": withAlpha("--surface-active"),
        muted: {
          DEFAULT: withAlpha("--muted"),
          foreground: withAlpha("--muted-foreground"),
        },
        "muted-foreground": withAlpha("--muted-foreground"),
        border: withAlpha("--border"),
        input: withAlpha("--input"),
        ring: withAlpha("--ring"),
        primary: {
          DEFAULT: withAlpha("--primary"),
          foreground: withAlpha("--primary-foreground"),
        },
        "primary-foreground": withAlpha("--primary-foreground"),
        secondary: {
          DEFAULT: withAlpha("--secondary"),
          foreground: withAlpha("--secondary-foreground"),
        },
        "secondary-foreground": withAlpha("--secondary-foreground"),
        destructive: {
          DEFAULT: withAlpha("--destructive"),
          foreground: withAlpha("--destructive-foreground"),
        },
        "destructive-foreground": withAlpha("--destructive-foreground"),
        success: {
          DEFAULT: withAlpha("--success"),
          foreground: withAlpha("--success-foreground"),
        },
        warning: {
          DEFAULT: withAlpha("--warning"),
          foreground: withAlpha("--warning-foreground"),
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 0.25rem)",
        sm: "calc(var(--radius) - 0.375rem)",
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)"],
        mono: ["var(--font-geist-mono)"],
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "scale-in": {
          from: { opacity: "0", transform: "translateY(8px) scale(0.98)" },
          to: { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        "slide-in-right": {
          from: { opacity: "0", transform: "translateX(16px)" },
          to: { opacity: "1", transform: "translateX(0)" },
        },
      },
      animation: {
        "fade-in": "fade-in 150ms ease-out",
        "scale-in": "scale-in 160ms ease-out",
        "slide-in-right": "slide-in-right 180ms ease-out",
      },
    },
  },
  plugins: [],
};
export default config;
