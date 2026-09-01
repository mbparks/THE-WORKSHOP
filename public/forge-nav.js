'use strict';

// Compatibility patch for deployments tracking the v9.6.4 main branch.
// The main app owns the Modules sheet; this observer keeps the external-link
// list consistent with the desktop rail without changing router behavior.
(() => {
  const FORGE_URL = 'https://forge.greenshoegarage.com';

  function ensureForgeLink(root = document) {
    const groups = root.querySelectorAll?.('.mobile-module-links');
    if (!groups?.length) return;
    for (const links of groups) {
      if (links.querySelector(`a[href="${FORGE_URL}"]`)) continue;
      const almanac = [...links.querySelectorAll('a')].find(a => /^ALMANAC\b/i.test(a.textContent.trim()));
      if (!almanac) continue;
      const a = document.createElement('a');
      a.href = FORGE_URL;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.innerHTML = 'THE FORGE <span aria-hidden="true">↗</span>';
      links.insertBefore(a, almanac);
    }
  }

  ensureForgeLink();
  const observer = new MutationObserver(records => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        ensureForgeLink(node);
        if (node.matches?.('.mobile-module-links')) ensureForgeLink(node.parentElement || node);
      }
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
