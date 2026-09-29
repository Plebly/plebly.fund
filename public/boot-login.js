/* Runs from index.html (not the hashed bundle). Drops a stale service-worker
 * cache that can keep old login links, and rewrites GitHub login clicks so a
 * cached 302 for /auth/github?return_to=… cannot be reused. */
(function () {
  var FLAG = "plebly_oauth_sw_drop_1";
  try {
    if (!localStorage.getItem(FLAG)) {
      localStorage.setItem(FLAG, "1");
      var chain = Promise.resolve();
      if ("serviceWorker" in navigator) {
        chain = navigator.serviceWorker.getRegistrations().then(function (regs) {
          return Promise.all(
            regs.map(function (reg) {
              return reg.unregister();
            }),
          );
        });
      }
      chain
        .then(function () {
          if (typeof caches === "undefined") return;
          return caches.keys().then(function (keys) {
            return Promise.all(
              keys.map(function (key) {
                return caches.delete(key);
              }),
            );
          });
        })
        .then(function () {
          location.reload();
        })
        .catch(function () {
          /* interceptor below still runs */
        });
    }
  } catch (err) {
    /* private mode / blocked storage */
  }

  document.addEventListener(
    "click",
    function (ev) {
      var target = ev.target;
      if (!target || !target.closest) return;
      var a = target.closest('a[href*="/auth/github"]');
      if (!a) return;
      if (ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) {
        return;
      }
      var href = a.getAttribute("href") || "";
      if (!href) return;
      ev.preventDefault();
      ev.stopPropagation();
      try {
        var abs = new URL(href, location.href);
        abs.searchParams.set(
          "n",
          Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
        );
        location.assign(abs.toString());
      } catch (e2) {
        location.assign(href);
      }
    },
    true,
  );
})();
