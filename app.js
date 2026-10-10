(() => {
  const menu = document.querySelector('#navOverlay');
  const toggle = document.querySelector('#menuToggle');
  const navLinks = [...document.querySelectorAll('#navOverlay a[href^="#"]')];
  const search = document.querySelector('#snippetSearch');
  const cards = [...document.querySelectorAll('.snippet-card')];
  const count = document.querySelector('#resultCount');
  const emptyState = document.querySelector('#emptyState');
  const sourceCache = new Map();
  const copyDialog = document.querySelector('#copyFallback');
  const copyField = document.querySelector('#copyFallbackText');
  const copyNote = document.querySelector('#copyFallbackNote');
  let activeCategory = 'all';
  let lastCopyButton = null;

  function closeMenu() {
    menu?.classList.remove('show');
    toggle?.setAttribute('aria-expanded', 'false');
    toggle?.setAttribute('aria-label', 'Buka menu');
  }

  function updateActiveLink() {
    const current = window.location.hash || '#home';
    navLinks.forEach((link) => {
      const active = link.getAttribute('href') === current;
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
  }

  async function loadSource(path) {
    if (!sourceCache.has(path)) {
      sourceCache.set(path, fetch(path).then((response) => {
        if (!response.ok) throw new Error('Source tidak dapat dimuat');
        return response.text();
      }));
    }
    return sourceCache.get(path);
  }

  function showManualCopy(code, button) {
    if (!copyDialog || !copyField) return;
    lastCopyButton = button || document.activeElement;
    copyField.value = code;
    if (copyNote) copyNote.textContent = 'Browser preview membatasi clipboard. Kode di bawah sudah dipilih—tekan Ctrl+C / ⌘C, atau tahan teks lalu pilih Salin.';
    copyDialog.hidden = false;
    requestAnimationFrame(() => {
      copyField.focus();
      copyField.select();
      copyField.setSelectionRange(0, copyField.value.length);
    });
  }

  function closeManualCopy() {
    if (!copyDialog || copyDialog.hidden) return;
    copyDialog.hidden = true;
    lastCopyButton?.focus?.();
  }

  function applyFilters() {
    const query = (search?.value || '').trim().toLowerCase();
    let visible = 0;

    cards.forEach((card) => {
      const matchesCategory = activeCategory === 'all' || card.dataset.category === activeCategory;
      const matchesQuery = !query || card.textContent.toLowerCase().includes(query) || (card.dataset.tags || '').includes(query);
      const show = matchesCategory && matchesQuery;
      card.hidden = !show;
      if (show) visible += 1;
    });

    if (count) count.textContent = `${visible} source ditampilkan`;
    if (emptyState) {
      emptyState.hidden = visible !== 0;
      if (visible === 0) {
        emptyState.textContent = activeCategory === 'stalk'
          ? 'Kategori Stalk belum memiliki source. Coba kategori lain atau kembali ke Semua.'
          : 'Tidak ada source yang cocok. Coba kata kunci atau kategori lain.';
      }
    }
  }

  function selectCategory(category) {
    activeCategory = category || 'all';
    document.querySelectorAll('.filter-btn[data-filter-type="category"]').forEach((button) => {
      const active = (button.dataset.filter || 'all') === activeCategory;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    applyFilters();
  }

  async function copyCode(button) {
    const sourcePath = button.dataset.codeSrc;
    const inlineCode = button.closest('.snippet-card')?.querySelector('.code-frame pre code')?.textContent ?? '';
    const original = button.dataset.originalLabel || button.textContent;
    button.dataset.originalLabel = original;
    let code = inlineCode;

    try {
      if (sourcePath) code = button.dataset.fullSource || await loadSource(sourcePath);
    } catch {
      button.textContent = 'SOURCE TIDAK TERSEDIA';
      window.setTimeout(() => { button.textContent = original; }, 1800);
      return;
    }

    let copied = false;
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(code);
        copied = true;
      } catch {
        // Coba fallback lama; beberapa preview/iframe membatasi Clipboard API.
      }
    }

    if (!copied) {
      const field = document.createElement('textarea');
      field.value = code;
      field.setAttribute('readonly', '');
      field.style.position = 'fixed';
      field.style.top = '0';
      field.style.left = '-9999px';
      document.body.appendChild(field);
      field.focus();
      field.select();
      try { copied = document.execCommand('copy'); } catch { copied = false; }
      field.remove();
    }

    if (copied) {
      button.textContent = 'TERSALIN ✓';
      button.classList.add('copied');
      window.setTimeout(() => {
        button.textContent = original;
        button.classList.remove('copied');
      }, 1600);
    } else {
      showManualCopy(code, button);
    }
  }

  toggle?.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', String(!open));
    toggle.setAttribute('aria-label', open ? 'Buka menu' : 'Tutup menu');
    menu?.classList.toggle('show', !open);
  });

  navLinks.forEach((link) => link.addEventListener('click', closeMenu));
  window.addEventListener('hashchange', updateActiveLink);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeMenu();
      closeManualCopy();
    }
  });

  search?.addEventListener('input', applyFilters);
  document.querySelectorAll('.filter-btn[data-filter-type="category"]').forEach((button) => {
    button.addEventListener('click', () => selectCategory(button.dataset.filter));
  });

  document.querySelectorAll('.copy-btn').forEach((button) => {
    button.addEventListener('click', () => copyCode(button));
  });

  document.querySelectorAll('.copy-btn[data-code-src]').forEach((button) => {
    button.disabled = true;
    loadSource(button.dataset.codeSrc).then((source) => {
      button.dataset.fullSource = source;
      button.disabled = false;
    }).catch(() => {
      button.disabled = false;
    });
  });

  document.querySelectorAll('.source-details[data-source]').forEach((details) => {
    details.addEventListener('toggle', async () => {
      if (!details.open || details.dataset.loaded === 'true') return;
      const code = details.querySelector('pre code');
      try {
        code.textContent = await loadSource(details.dataset.source);
        details.dataset.loaded = 'true';
      } catch {
        code.textContent = 'Gagal memuat source. Coba unduh file source dari kartu.';
      }
    });
  });

  document.querySelector('#selectCopyText')?.addEventListener('click', () => {
    copyField?.focus();
    copyField?.select();
    copyField?.setSelectionRange(0, copyField.value.length);
  });
  document.querySelectorAll('[data-close-copy]').forEach((button) => button.addEventListener('click', closeManualCopy));
  copyDialog?.addEventListener('click', (event) => {
    if (event.target === copyDialog) closeManualCopy();
  });

  updateActiveLink();
  applyFilters();
})();
