export function bindProposalCopyButtons(root: ParentNode): void {
  root.querySelectorAll<HTMLButtonElement>(".copy-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const value = btn.dataset.copy;
      if (!value) return;
      try {
        await navigator.clipboard.writeText(value);
        if (btn.classList.contains("copy-btn-icon")) {
          const prev = btn.getAttribute("aria-label") || "";
          btn.setAttribute("aria-label", "Copied");
          btn.classList.add("is-copied");
          setTimeout(() => {
            btn.setAttribute("aria-label", prev);
            btn.classList.remove("is-copied");
          }, 1200);
          return;
        }
        const prev = btn.textContent;
        btn.textContent = "Copied";
        setTimeout(() => {
          btn.textContent = prev;
        }, 1200);
      } catch {
        /* ignore */
      }
    });
  });
}
