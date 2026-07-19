import { enhanceLibraryPages } from 'library-pages/client';

enhanceLibraryPages();

document.documentElement.classList.add('motion-ready');
for (const pipeline of document.querySelectorAll('[data-pipeline]')) {
  pipeline.classList.add('motion-ready');
}
