// Frontend main script for Symbiote Workspace pages

document.addEventListener('DOMContentLoaded', () => {
  document.documentElement.classList.add('motion-ready');
  document.querySelectorAll('[data-pipeline]').forEach((pipeline) => {
    pipeline.classList.add('motion-ready');
  });

  const themeToggleBtn = document.getElementById('theme-toggle');
  if (themeToggleBtn) {
    const updateThemeLabel = () => {
      const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
      const nextTheme = currentTheme === 'dark' ? 'light' : 'dark';
      themeToggleBtn.setAttribute('aria-label', `Switch to ${nextTheme} theme`);
    };
    updateThemeLabel();
    themeToggleBtn.addEventListener('click', () => {
      const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
      const nextTheme = currentTheme === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', nextTheme);
      try { localStorage.setItem('symbiote-theme', nextTheme); } catch {}
      updateThemeLabel();
    });
  }

  const skipLink = document.querySelector('.skip-link');
  if (skipLink) {
    skipLink.addEventListener('click', () => {
      const mainContent = document.getElementById('main-content');
      if (mainContent) {
        mainContent.focus();
      }
    });
  }
});
