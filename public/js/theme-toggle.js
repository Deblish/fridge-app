// public/js/theme-toggle.js

document.addEventListener('DOMContentLoaded', () => {
  const toggleButton = document.getElementById('theme-toggle');
  const darkIcon = document.getElementById('theme-toggle-dark-icon');
  const lightIcon = document.getElementById('theme-toggle-light-icon');

  // Function to set the theme based on the current state
  const setTheme = (isDark) => {
    if (isDark) {
      document.documentElement.classList.add('dark');
      darkIcon.classList.add('hidden');
      lightIcon.classList.remove('hidden');
    } else {
      document.documentElement.classList.remove('dark');
      darkIcon.classList.remove('hidden');
      lightIcon.classList.add('hidden');
    }
  };

  // Check for saved user preference
  const savedTheme = localStorage.getItem('theme');
  if (savedTheme) {
    setTheme(savedTheme === 'dark');
  } else {
    // If no preference, check system preference
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    setTheme(prefersDark);
  }

  // Toggle theme on button click
  toggleButton.addEventListener('click', () => {
    const isDark = document.documentElement.classList.contains('dark');
    setTheme(!isDark);
    localStorage.setItem('theme', !isDark ? 'dark' : 'light');
  });
});

