/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // All colors driven by CSS custom properties for theme switching
        'ink': 'rgb(var(--c-ink) / <alpha-value>)',
        'obsidian': 'rgb(var(--c-obsidian) / <alpha-value>)',
        'deep-brown': 'rgb(var(--c-deep-brown) / <alpha-value>)',
        'warm-brown': 'rgb(var(--c-warm-brown) / <alpha-value>)',
        'leather': 'rgb(var(--c-leather) / <alpha-value>)',
        'tobacco': 'rgb(var(--c-tobacco) / <alpha-value>)',
        'parchment': 'rgb(var(--c-parchment) / <alpha-value>)',
        'cream': 'rgb(var(--c-cream) / <alpha-value>)',
        'cream-dark': 'rgb(var(--c-cream-dark) / <alpha-value>)',
        'antique': 'rgb(var(--c-antique) / <alpha-value>)',
        'accent': 'rgb(var(--c-accent) / <alpha-value>)',
        'accent-hover': 'rgb(var(--c-accent-hover) / <alpha-value>)',
        'accent-subtle': 'rgb(var(--c-accent-subtle) / <alpha-value>)',
        'gold': 'rgb(var(--c-gold) / <alpha-value>)',
        'burgundy': 'rgb(var(--c-burgundy) / <alpha-value>)',
        'forest': 'rgb(var(--c-forest) / <alpha-value>)',
        'navy': 'rgb(var(--c-navy) / <alpha-value>)',
        'amber': 'rgb(var(--c-amber) / <alpha-value>)',
      },
      fontFamily: {
        serif: ['Crimson Text', 'Georgia', 'serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        'card': '0 4px 16px rgba(0, 0, 0, 0.2), 0 1px 3px rgba(0, 0, 0, 0.1)',
        'card-hover': '0 8px 24px rgba(0, 0, 0, 0.3), 0 2px 6px rgba(0, 0, 0, 0.15)',
        'modal': '0 24px 50px rgba(0, 0, 0, 0.4)',
        'glow-gold': '0 0 20px rgba(154, 133, 96, 0.3)',
      },
      borderRadius: {
        'card': '12px',
        'button': '8px',
      },
      keyframes: {
        shimmer: {
          '0%': { backgroundPosition: '200% 0' },
          '100%': { backgroundPosition: '-200% 0' },
        },
      },
      animation: {
        shimmer: 'shimmer 3s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
