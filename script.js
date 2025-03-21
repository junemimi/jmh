document.addEventListener("DOMContentLoaded", function () {
    const modeButton = document.querySelector(".mode-toggle");
    const modeIcon = document.querySelector(".mode-icon");
    const body = document.body;

    // Check for saved mode in local storage
    if (localStorage.getItem("darkMode") === "enabled") {
        body.classList.add("dark-mode");
        modeIcon.textContent = "🌙";
    }

    modeButton.addEventListener("click", function () {
        body.classList.toggle("dark-mode");

        // Update emoji and save mode preference
        if (body.classList.contains("dark-mode")) {
            modeIcon.textContent = "🌙";
            localStorage.setItem("darkMode", "enabled");
        } else {
            modeIcon.textContent = "☀️";
            localStorage.setItem("darkMode", "disabled");
        }
    });
});
