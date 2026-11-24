// VCFO Suite page hook (classic content script, registered only for the
// configured Suite origin by src/suite/hook.js). Marks the page so Suite knows
// VCFO Assist is installed, and relays Suite's start request to the worker.
// It reads no page data besides the request itself.

(() => {
  'use strict';
  const w = /** @type {any} */ (window);
  if (w.__VA_SUITE_HOOK) return;
  w.__VA_SUITE_HOOK = true;

  document.documentElement.dataset.vcfoAssist = chrome.runtime.getManifest().version;

  /**
   * @param {unknown} form
   * @param {unknown} engagementId
   */
  const relay = (form, engagementId) => {
    if (typeof form !== 'string' || form === '') return;
    void chrome.runtime.sendMessage({
      type: 'va.suite.start', form, engagementId: typeof engagementId === 'string' ? engagementId : null,
    }).catch(() => undefined);
  };

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const d = event.data;
    if (!d || typeof d !== 'object' || d.source !== 'vcfo-suite' || d.type !== 'vcfo-assist:start') return;
    relay(d.form, d.engagementId);
  });

  const params = new URL(location.href).searchParams;
  const asked = params.get('assist') ?? document.documentElement.dataset.vcfoAssistForm;
  if (asked) relay(asked, params.get('engagement') ?? document.documentElement.dataset.vcfoAssistEngagement ?? null);
})();
