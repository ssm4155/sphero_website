// Header menu behaviour (mobile sheet and desktop "Product" dropdown).
// - Pages change without a full reload, so a <details> menu would otherwise stay open on
//   the next page: close menus after a link is chosen, on Escape, on outside taps and on
//   back/forward navigation.
// - Browsers do not paint the contents of a closed <details>, so CSS :hover alone cannot
//   reveal the dropdown. On mouse/trackpad devices, open it on hover and close it when the
//   pointer leaves. Clicking "Product" keeps it open; keyboard toggling is unchanged.
(function () {
  var canHover = window.matchMedia("(hover: hover) and (pointer: fine)");

  function closeAll() {
    document.querySelectorAll("details.s-burger[open], details.s-drop[open]").forEach(function (d) {
      d.removeAttribute("open");
      delete d.dataset.hoverOpen;
    });
  }

  document.addEventListener("mouseover", function (e) {
    if (!canHover.matches || !(e.target instanceof Element)) return;
    var d = e.target.closest("details.s-drop");
    if (d && !d.open) { d.open = true; d.dataset.hoverOpen = "1"; }
  });

  document.addEventListener("mouseout", function (e) {
    if (!(e.target instanceof Element)) return;
    var d = e.target.closest("details.s-drop");
    if (!d || (e.relatedTarget instanceof Node && d.contains(e.relatedTarget))) return;
    if (d.dataset.hoverOpen) { d.open = false; delete d.dataset.hoverOpen; }
  });

  document.addEventListener("click", function (e) {
    var t = e.target;
    if (!(t instanceof Element)) return;
    var sum = t.closest("details.s-drop > summary");
    if (sum && sum.parentElement.dataset.hoverOpen) {
      // already open from hover: a click pins it open instead of toggling it shut
      e.preventDefault();
      delete sum.parentElement.dataset.hoverOpen;
      return;
    }
    if (t.closest(".s-sheet a, .s-drop-menu a")) { setTimeout(closeAll, 0); return; }
    if (!t.closest("details.s-burger, details.s-drop")) closeAll();
  });

  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeAll(); });
  window.addEventListener("popstate", closeAll);
})();
