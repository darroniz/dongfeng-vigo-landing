/* ============================================================
   Dongfeng BOX landing — interactions
   - Modal open/close (click, backdrop, Escape, focus trap)
   - Form submit: POST a Zapier + Apps Script (Sheet backup) + dataLayer
   - Success view tras enviar el formulario
   - Sticky CTA mobile (visible after hero, hidden near final CTA)
   - Top bar dismiss
   - Reveal on scroll (respects prefers-reduced-motion)
   ============================================================ */

(() => {
  'use strict';

  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

  /* ----------  MODAL  ---------- */
  const modal = $('#modal');
  const modalContent = $('.modal__content', modal);
  const LEAD_SENT_KEY = 'dongfeng_lead_sent';
  let lastFocused = null;

  function leadAlreadySent() {
    try { return sessionStorage.getItem(LEAD_SENT_KEY) === '1'; }
    catch { return false; }
  }

  function showView(viewName) {
    $$('.modal__body', modal).forEach(v => v.hidden = v.dataset.view !== viewName);
  }

  function openModal() {
    lastFocused = document.activeElement;
    modal.hidden = false;
    document.documentElement.style.overflow = 'hidden';
    if (leadAlreadySent()) showView('success');
    // focus first interactive inside modal after paint
    requestAnimationFrame(() => {
      const firstInput = $('input, button', modal);
      if (firstInput) firstInput.focus();
    });
  }

  function closeModal() {
    modal.hidden = true;
    document.documentElement.style.overflow = '';
    // Si ya envió, mantenemos la vista success; solo reseteamos si aún no ha enviado.
    if (!leadAlreadySent()) {
      showView('form');
      $('#leadForm')?.reset();
    }
    if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
  }

  $$('[data-open-modal]').forEach(btn => btn.addEventListener('click', (e) => {
    e.preventDefault();
    openModal();
  }));

  $$('[data-close-modal]').forEach(el => el.addEventListener('click', closeModal));

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.hidden) closeModal();
    // simple focus trap
    if (e.key === 'Tab' && !modal.hidden) {
      const focusables = $$('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])', modalContent)
        .filter(el => !el.hasAttribute('disabled') && el.offsetParent !== null);
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  /* ----------  FORM SUBMIT  ---------- */
  // Puerta de entrada (Apps Script). Valida el lead y, solo si pasa el filtro
  // antibots, lo escribe en la Sheet y lo reenvía a Zapier (server-side).
  // La URL de Zapier YA NO vive aquí: está dentro del Apps Script, fuera de la página pública.
  const GATEWAY_WEBHOOK = 'https://script.google.com/macros/s/AKfycbzrS__THM2OPA35AQlrS5Hn3gObNEPRU_kiHQWAtGefzRJM5JzuDxK1e5lLGu4jPMHG/exec';
  // Token compartido con el Apps Script. Los hits directos de bots al endpoint no lo traen.
  const FORM_TOKEN = 'dfbox-a7f3k92mq';

  function splitName(fullName) {
    const parts = (fullName || '').trim().split(/\s+/);
    return { first: parts.shift() || '', last: parts.join(' ') };
  }

  // E.164 español. Enhanced Conversions exige prefijo internacional para hacer match.
  function normalizePhoneES(raw) {
    let p = (raw || '').replace(/[\s\-().]/g, '');
    if (!p) return '';
    if (p.startsWith('00')) p = '+' + p.slice(2);
    if (p.startsWith('+')) return p;
    // Autofill suele dejar "34XXXXXXXXX" sin el "+": le anteponemos el "+".
    if (/^34[6789]\d{8}$/.test(p)) return '+' + p;
    if (/^[6789]\d{8}$/.test(p)) return '+34' + p;
    return p;
  }

  // CP español → código de concesionario Salvador Caetano.
  // Rangos específicos sobrescriben el default provincial (Sabadell dentro de 08, Majadahonda dentro de 28, Gandía dentro de 46).
  function dealerCodeFromCP(cp) {
    const digits = (cp || '').replace(/\D/g, '');
    if (digits.length < 2) return '';
    const n = parseInt(digits, 10);
    if (n >= 8200 && n <= 8208) return 'DE00060002';   // Sabadell
    if (n >= 28220 && n <= 28229) return 'DE05710004'; // Majadahonda
    if (n >= 46700 && n <= 46729) return 'DE06350009'; // Gandía
    const province = digits.slice(0, 2);
    const provinceToDealer = {
      '03': 'DE00110011', // Alicante
      '07': 'DE00080001', // Palma de Mallorca
      '08': 'DE05840006', // Barcelona
      '15': 'DE00110012', // A Coruña
      '17': 'DE00180001', // Girona
      '19': 'DE00160001', // Guadalajara
      '28': 'DE00050002', // Madrid
      '29': 'DE01050013', // Málaga
      '30': 'DE00070002', // Murcia
      '31': 'DE00150001', // Navarra
      '33': 'DE00110005', // Oviedo (Asturias)
      '39': 'DE00070001', // Santander
      '41': 'DE00110001', // Sevilla
      '43': 'DE00140001', // Tarragona
      '47': 'DE00090001', // Valladolid
      '48': 'DE01100014', // Bilbao
      '50': 'DE00100004', // Zaragoza
      '35': 'DE00780003', // Las Palmas (Canarias)
      '38': 'DE00090002'  // Santa Cruz de Tenerife (Canarias)
    };
    return provinceToDealer[province] || '';
  }

  // 'CAN' si la landing setea window.LANDING_REGION o si el path empieza por /canarias; si no, 'PEN'.
  const REGION = (typeof window !== 'undefined' && window.LANDING_REGION)
    || (/^\/canarias(\/|$)/i.test(location.pathname) ? 'CAN' : 'PEN');

  function buildPayload({ name, last_name, phone, cp, email, dealer }) {
    return {
      Name: name,
      Last_Name: last_name,
      Email: email || '',
      Phone: phone,
      Model_Code: '819',
      Dealership_Code: dealer || '',
      Postal_Code: cp || '',
      Privacy_Policy: 'Y',
      Consent: true,
      Lead_Type: 'TP10',
      Request_Type: 'TPD10',
      Lead_Source: 'OL24',
      Form_Type: 'F12',
      Campaign_Code: 'CPH020',
      Brand_Code: 'DON',
      Country_Code: 'ES',
      Region: REGION
    };
  }

  // text/plain (CORS-safe) evita el preflight. El Apps Script recibe el lead,
  // lo valida y solo si pasa el filtro lo escribe en la Sheet y lo reenvía a Zapier.
  function sendToGateway(payload) {
    if (!GATEWAY_WEBHOOK) return Promise.resolve(null);
    return fetch(GATEWAY_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      redirect: 'follow'
    })
      .then(r => r.text().then(t => { try { return JSON.parse(t); } catch { return { status: r.ok ? 'success' : 'error', raw: t }; } }))
      .then(res => { console.info('[Dongfeng] gateway ok:', res); return res; })
      .catch(err => { console.error('[Dongfeng] gateway error:', err); });
  }

  const leadForm = $('#leadForm');
  if (leadForm) {
    leadForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(leadForm).entries());
      const { first, last } = splitName(data.name);
      const phone = normalizePhoneES(data.phone);
      const cp = (data.cp || '').replace(/\D/g, '');
      const dealer = dealerCodeFromCP(cp);

      const payload = buildPayload({
        name: first,
        last_name: last,
        phone,
        cp,
        email: data.email || '',
        dealer
      });
      // Antibots: token compartido + honeypot. El Apps Script descarta lo que no cuadre.
      payload._t = FORM_TOKEN;
      payload._hp = data.fax || '';

      sendToGateway(payload);

      // Enhanced Conversions: GTM hashea (SHA-256) los campos de enhanced_conversion_data
      // antes de mandarlos a Google Ads. No hashear aquí.
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push({
        event: 'generate_lead',
        form_name: 'test_drive',
        dealer,
        enhanced_conversion_data: {
          email: data.email || '',
          phone_number: phone,
          address: {
            first_name: first,
            last_name: last,
            postal_code: cp,
            country: 'ES'
          }
        }
      });

      try { sessionStorage.setItem(LEAD_SENT_KEY, '1'); } catch {}
      showView('success');
    });
  }

  /* ----------  TOP BAR  ---------- */
  const topbar = $('#topbar');
  $('[data-close-topbar]')?.addEventListener('click', () => {
    topbar.hidden = true;
  });

  /* ----------  STICKY CTA MOBILE  ---------- */
  const stickyCta = $('#stickyCta');
  const heroEl = $('.hero');
  const ctaFinalEl = $('.cta-final');

  if (stickyCta && heroEl && ctaFinalEl && 'IntersectionObserver' in window) {
    let heroVisible = true;
    let ctaFinalVisible = false;

    const heroObs = new IntersectionObserver(([entry]) => {
      heroVisible = entry.isIntersecting;
      updateStickyCta();
    }, { threshold: 0.25 });

    const finalObs = new IntersectionObserver(([entry]) => {
      ctaFinalVisible = entry.isIntersecting;
      updateStickyCta();
    }, { threshold: 0.1 });

    heroObs.observe(heroEl);
    finalObs.observe(ctaFinalEl);

    function updateStickyCta() {
      const show = !heroVisible && !ctaFinalVisible;
      stickyCta.classList.toggle('is-visible', show);
    }
  }

  /* ----------  REVEAL ON SCROLL  ---------- */
  const prefersReducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!prefersReducedMotion && 'IntersectionObserver' in window) {
    const revealTargets = $$('.section-head, .step, .press-card, .testimonial, .benefit, .compare-table-wrap');
    revealTargets.forEach(el => el.classList.add('reveal'));
    const revealObs = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-in');
          revealObs.unobserve(entry.target);
        }
      });
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.1 });
    revealTargets.forEach(el => revealObs.observe(el));
  }

})();

/* ============================================================
   VIGO — interacciones específicas de esta landing
   (V2L, tour interior por hotspots, carga animada, selector de color)
   ⚠️ Pendiente go-live: el bloque de FORM SUBMIT de arriba hereda los
   códigos del BOX (Model_Code 819, Campaign_Code CPH020, FORM_TOKEN,
   mapa de dealers de Salvador Caetano). Sustituir por los códigos del
   VIGO y su distribuidor cuando el cliente los facilite.
   ============================================================ */
(() => {
  'use strict';
  const $  = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));

  /* ----------  V2L: ¿qué enchufas?  ---------- */
  const USABLE_WH = 50000; // 52 kWh nominal, ~50 kWh útiles
  const devs = $$('.v2l__dev');
  const devName = $('#v2lDev');
  const devNum  = $('#v2lNum');
  const connIco = $('#v2lConnIco');
  const connName = $('#v2lConnName');
  const readout = $('#v2lReadout');
  const readoutIco = $('#v2lReadoutIco');
  // cada dispositivo muestra su lectura en un punto distinto de la foto
  const V2L_POS = [
    { top: '16px', right: '16px' },
    { top: '16px', left: '16px' },
    { top: '40%', right: '16px' },
    { top: '40%', left: '16px' }
  ];
  function setDevice(btn) {
    devs.forEach(d => d.classList.toggle('is-active', d === btn));
    const i = devs.indexOf(btn);
    const watts = parseInt(btn.dataset.watts, 10) || 100;
    const hours = Math.round(USABLE_WH / watts);
    if (devName) devName.textContent = btn.dataset.name;
    if (devNum)  devNum.textContent = hours.toLocaleString('es-ES');
    const svg = btn.querySelector('svg');
    if (svg) {
      if (connIco) connIco.innerHTML = svg.outerHTML;        // barra de conexión
      if (readoutIco) readoutIco.innerHTML = svg.outerHTML;  // icono junto a las horas
    }
    if (connName) connName.textContent = btn.dataset.name.split(' ')[0];
    // mover la lectura a un punto distinto según el dispositivo
    const p = V2L_POS[i] || V2L_POS[0];
    if (readout) {
      readout.style.top = p.top || 'auto';
      readout.style.bottom = p.bottom || 'auto';
      readout.style.left = p.left || 'auto';
      readout.style.right = p.right || 'auto';
    }
  }
  devs.forEach(btn => btn.addEventListener('click', () => setDevice(btn)));
  if (devs.length) setDevice(devs.find(d => d.classList.contains('is-active')) || devs[0]);

  /* ----------  INTERIOR: hotspots  ---------- */
  const HS = [
    { title: 'Pantalla central de gran formato', text: 'Navegación, climatización y multimedia en una sola pantalla táctil de alta resolución. Lo que buscas, a un gesto.' },
    { title: 'Iluminación ambiente LED', text: 'Luz ambiente azul que envuelve el habitáculo al anochecer. Detalle de coche de categoría superior.' },
    { title: 'Carga inalámbrica', text: 'Base de carga inalámbrica en la consola: dejas el móvil y te olvidas del cable.' },
    { title: 'Habitabilidad para 5', text: '5 plazas con espacio trasero poco habitual en el segmento B: rodillas y cabeza de sobra atrás.' }
  ];
  const hsStage = $('#hsStage'), hsPop = $('#hsPop'), hsTitle = $('#hsTitle'), hsText = $('#hsText');
  const dots = $$('.hotspot'), tabs = $$('.hotspots__nav button');
  let hsCurrent = 0;
  function placePop(dot) {
    if (!hsStage || !hsPop) return;
    const sr = hsStage.getBoundingClientRect();
    if (sr.width <= 560) { hsPop.style.left = ''; hsPop.style.top = ''; return; } // móvil: CSS lo fija abajo
    const dotX = parseFloat(dot.style.left) / 100 * sr.width;
    const dotY = parseFloat(dot.style.top) / 100 * sr.height;
    const pw = hsPop.offsetWidth || 250, ph = hsPop.offsetHeight || 90;
    let x = Math.max(12, Math.min(dotX - pw / 2, sr.width - pw - 12));
    let y = dotY + 26;
    if (y + ph > sr.height - 12) y = Math.max(12, dotY - ph - 26);
    hsPop.style.left = x + 'px';
    hsPop.style.top = y + 'px';
  }
  function setHotspot(i) {
    const d = HS[i]; if (!d) return;
    hsCurrent = i;
    if (hsTitle) hsTitle.textContent = d.title;
    if (hsText)  hsText.textContent = d.text;
    dots.forEach(b => b.classList.toggle('is-active', +b.dataset.index === i));
    tabs.forEach(b => b.classList.toggle('is-active', +b.dataset.index === i));
    const dot = dots.find(b => +b.dataset.index === i);
    if (dot) placePop(dot);
    if (hsPop) hsPop.classList.add('is-shown');
  }
  [...dots, ...tabs].forEach(b => b.addEventListener('click', () => setHotspot(+b.dataset.index)));
  window.addEventListener('resize', () => { const dot = dots.find(b => +b.dataset.index === hsCurrent); if (dot) placePop(dot); });
  if (dots.length) setHotspot(0);

  /* ----------  CARGA: anima 30→80% al entrar en viewport  ---------- */
  const chargeBar = $('#chargeBar');
  const track = chargeBar && $('.charge__track', chargeBar);
  if (track && 'IntersectionObserver' in window) {
    const obs = new IntersectionObserver((entries) => {
      entries.forEach(e => { if (e.isIntersecting) { track.classList.add('is-charged'); obs.disconnect(); } });
    }, { threshold: 0.4 });
    obs.observe(chargeBar);
  } else if (track) { track.classList.add('is-charged'); }

  /* ----------  COLORES: selector  ---------- */
  const stage = $('#colorStage');
  if (stage) {
    const imgs = $$('img', stage);
    const swatches = $$('.colors__swatch');
    const nameEl = $('#colorName');
    swatches.forEach(sw => sw.addEventListener('click', () => {
      const i = +sw.dataset.index;
      imgs.forEach(im => im.classList.toggle('is-active', +im.dataset.index === i));
      swatches.forEach(s => s.classList.toggle('is-active', s === sw));
      if (nameEl) nameEl.textContent = sw.dataset.name;
    }));
  }

  /* ----------  REVEAL extra para secciones nuevas  ---------- */
  const prefersReduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!prefersReduced && 'IntersectionObserver' in window) {
    // Solo elementos no críticos. Las imágenes-escenario NUNCA van en reveal
    // (si el observer no dispara se quedarían invisibles).
    const targets = $$('.charge__card, .space__stat');
    targets.forEach(el => el.classList.add('reveal'));
    const obs = new IntersectionObserver((entries) => {
      entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('is-in'); obs.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.1 });
    targets.forEach(el => obs.observe(el));
  }
})();
