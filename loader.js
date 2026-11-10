// Loading screen: covers the page until every image has loaded (the
// window "load" event), with "loading..." typed out and Louie sitting
// beside it. Loaded in <head> so it is up before anything else paints.
// - Fades in only after a short delay, so quick (cached) visits never flash it
// - Gives up after MAX_WAIT_MS so a stuck image can't hide the page forever
// - Without JavaScript nothing is covered at all
(function () {
    const MAX_WAIT_MS = 15000;
    const TEXT = "loading...";
    const TYPE_MS = 110;      // per letter
    const HOLD_MS = 900;      // pause on the full word before retyping the dots
    const root = document.documentElement;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Light/dark mode goes on before the first paint so a dark-mode visit
    // never flashes the light background. A choice saved with the mode
    // button wins; otherwise follow the device (script.js keeps it in sync).
    const saved = localStorage.getItem("darkMode");
    const dark = saved ? saved === "enabled" : window.matchMedia("(prefers-color-scheme: dark)").matches;
    root.classList.toggle("dark-mode", dark);

    root.classList.add("is-loading");

    function build() {
        const loader = document.createElement("div");
        loader.className = "page-loader";
        loader.setAttribute("role", "status");
        loader.innerHTML =
            '<img class="page-loader-louie" src="images/louie-sprites/sit.png" alt="" width="68" height="46">' +
            '<span class="page-loader-text" aria-hidden="true"></span>' +
            '<span class="visually-hidden">Loading</span>';
        document.body.prepend(loader);

        const text = loader.querySelector(".page-loader-text");
        if (reduceMotion) {
            text.textContent = TEXT;
            return loader;
        }

        // Type the word once, then keep retyping just the dots
        const word = TEXT.replace(/\.+$/, "");
        let shown = 0;
        function tick() {
            if (!loader.isConnected) return;
            if (shown < TEXT.length) {
                shown += 1;
                text.textContent = TEXT.slice(0, shown);
                setTimeout(tick, shown === TEXT.length ? HOLD_MS : TYPE_MS);
            } else {
                shown = word.length;
                text.textContent = word;
                setTimeout(tick, TYPE_MS);
            }
        }
        tick();
        return loader;
    }

    let loader = null;
    let done = false;

    function finish() {
        if (done) return;
        done = true;
        root.classList.remove("is-loading");
        if (!loader) return;
        // Not visible yet (quick load) or reduced motion: just remove it
        if (reduceMotion || parseFloat(getComputedStyle(loader).opacity) < 0.05) {
            loader.remove();
            return;
        }
        loader.classList.add("is-done");
        setTimeout(function () { loader.remove(); }, 400);
    }

    document.addEventListener("DOMContentLoaded", function () {
        if (!done) loader = build();
    });
    window.addEventListener("load", finish);
    setTimeout(finish, MAX_WAIT_MS);
})();
