export const THEME_STORAGE_KEY = "theme-preference";

/**
 * Injected into <head> and run before first paint so a dark-mode user never
 * sees a flash of the light palette. Kept in sync with `ThemeProvider`.
 *
 * Lives outside the client component so the server layout can import the string
 * without pulling a client module into the server graph.
 */
export const themeInitScript = `
(function () {
  try {
    var stored = localStorage.getItem('${THEME_STORAGE_KEY}');
    var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var dark = stored === 'dark' || ((!stored || stored === 'system') && prefersDark);
    document.documentElement.classList.toggle('dark', dark);
  } catch (e) {}
})();
`;
