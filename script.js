document.addEventListener("DOMContentLoaded", function () {
    const modeButton = document.querySelector(".mode-toggle");
    const modeIcon = document.querySelector(".mode-icon");
    const body = document.body;

    // Apply the mode in one step. Per-element color transitions are switched
    // off for this moment so nothing (header, sections, bubbles) lags behind.
    const root = document.documentElement;
    function setMode(dark) {
        root.classList.add("theme-switching");
        root.classList.toggle("dark-mode", dark);
        modeIcon.textContent = dark ? "🌙" : "☀️";
        getComputedStyle(body).backgroundColor; // force the new colors to apply now
        root.classList.remove("theme-switching");
    }

    // Default to the device's light/dark setting until the mode button is
    // used; after that the saved choice wins
    const deviceDark = window.matchMedia("(prefers-color-scheme: dark)");
    function savedMode() {
        return localStorage.getItem("darkMode");
    }
    setMode(savedMode() ? savedMode() === "enabled" : deviceDark.matches);

    // Follow the device if it switches (e.g. automatic dark mode at sunset)
    deviceDark.addEventListener("change", function (event) {
        if (!savedMode()) setMode(event.matches);
    });

    modeButton.addEventListener("click", function () {
        const dark = !root.classList.contains("dark-mode");
        localStorage.setItem("darkMode", dark ? "enabled" : "disabled");

        const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        if (document.startViewTransition && !reduceMotion) {
            // Crossfade the whole page at once
            document.startViewTransition(function () { setMode(dark); });
        } else {
            setMode(dark);
        }
    });

    setupCarousel(document.querySelector(".carousel"));
    setupPhotoStack(document.querySelector(".about-me-photos"));
    setupCompactHeader(document.querySelector(".header"));
    setupHomeLouieRoom(document.querySelector(".home-louie"));
});

// Home page: tell the CSS how tall Louie's row is (it is pinned to the
// bottom, outside the layout) so the email row never runs into it.
function setupHomeLouieRoom(row) {
    if (!row) return;
    const home = row.closest(".home");
    function update() {
        home.style.setProperty("--louie-row", Math.ceil(row.getBoundingClientRect().height) + "px");
    }
    update();
    if (window.ResizeObserver) new ResizeObserver(update).observe(row);
    else window.addEventListener("resize", update);
}

// Subpage header: pinned to the top, and slims down once the page is
// scrolled. The page is padded by the header's full height so the
// shrink never shifts the content.
function setupCompactHeader(header) {
    if (!header) return;
    const body = document.body;
    const COMPACT_AFTER = 16; // px scrolled before the header slims down

    // Full (unscrolled) height, measured with the slim styles briefly off
    function measure() {
        const compact = header.classList.contains("is-compact");
        header.classList.add("is-measuring");
        header.classList.remove("is-compact");
        body.style.setProperty("--header-h", header.offsetHeight + "px");
        header.classList.toggle("is-compact", compact);
        header.offsetHeight; // apply the slim styles again before re-enabling transitions
        header.classList.remove("is-measuring");
    }

    function update() {
        header.classList.toggle("is-compact", window.scrollY > COMPACT_AFTER);
    }

    measure();
    body.classList.add("has-fixed-header");
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", measure);
    // Web fonts and icons can change the title's height after first paint
    window.addEventListener("load", measure);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure);
}

// About page photo stack: clicking either photo swaps which one is in front.
function setupPhotoStack(stack) {
    if (!stack) return;
    const photos = Array.from(stack.querySelectorAll(".about-photo"));
    photos.forEach(function (photo) {
        photo.addEventListener("click", function () {
            photos.forEach(function (p) {
                const front = p.classList.contains("is-front");
                p.classList.toggle("is-front", !front);
                p.classList.toggle("is-back", front);
            });
        });
    });
}

// Play page photo carousel: the current photo sits in front and its
// neighbors peek out on the left and right. Clicking a side photo, the
// arrow buttons, the keyboard arrows, or a swipe rotates it.
function setupCarousel(carousel) {
    if (!carousel) return;

    const items = Array.from(carousel.querySelectorAll(".carousel-item"));
    const count = items.length;
    let current = 0;

    function render() {
        items.forEach(function (item, i) {
            // Position relative to the front photo, wrapping around the ends
            const offset = (i - current + count) % count;
            item.classList.toggle("is-center", offset === 0);
            item.classList.toggle("is-right", offset === 1);
            item.classList.toggle("is-left", offset === count - 1);
            // Only the front photo is announced; the buttons handle navigation
            item.setAttribute("aria-hidden", offset === 0 ? "false" : "true");
        });
    }

    function rotate(step) {
        current = (current + step + count) % count;
        render();
    }

    carousel.querySelector(".carousel-prev").addEventListener("click", function () { rotate(-1); });
    carousel.querySelector(".carousel-next").addEventListener("click", function () { rotate(1); });

    items.forEach(function (item) {
        item.addEventListener("click", function () {
            if (item.classList.contains("is-left")) rotate(-1);
            if (item.classList.contains("is-right")) rotate(1);
        });
    });

    carousel.addEventListener("keydown", function (event) {
        if (event.key === "ArrowLeft") { rotate(-1); event.preventDefault(); }
        if (event.key === "ArrowRight") { rotate(1); event.preventDefault(); }
    });

    // Swipe support for touch screens
    let touchStartX = null;
    carousel.addEventListener("touchstart", function (event) {
        touchStartX = event.touches[0].clientX;
    }, { passive: true });
    carousel.addEventListener("touchend", function (event) {
        if (touchStartX === null) return;
        const dx = event.changedTouches[0].clientX - touchStartX;
        if (Math.abs(dx) > 40) rotate(dx < 0 ? 1 : -1);
        touchStartX = null;
    });

    render();
}
