// Louie: a little pixel version of my dog. Ported from my macOS desktop pet
// (SpriteKit) to plain JS.
//
// He lives in a ".louie-yard" element: on the home page that's his own row
// under the email bubble, on the other pages it's the right side of the
// footer. His ground is the bottom of the yard.
//
// - Wanders: walks for a bit, then sits, sniffs, or naps, then walks again
// - Click/tap (or Enter/Space when focused) to pet him: bounce + hearts
// - Drag him around; let go and he settles back down
// - Home page menu: send to bed / wake up, feed, fetch, zoomies
// - Remembers where he was between pages, and stays in bed until woken
// - Respects "reduce motion": no walking or running, he just sits or naps
(function () {
    "use strict";

    const SPRITES = "images/louie-sprites/";
    const FRAME_W = 68;              // sprite frame size in pixels
    const FRAME_H = 46;
    const FEET_ROWS = 44;            // rows down to the bottom of his paws; rows below are empty
    const MOUTH_X = 53 / FRAME_W;    // where his mouth is across the frame (facing right)
    const GRAVITY = 1800;            // px/s^2 for the thrown ball
    const IDLE_FETCH_SECONDS = 25;   // he gives up waiting for a throw after this long
    const WALK_FRAME_SECONDS = 0.12;
    const RUN_FRAME_SECONDS = 0.09;
    const CARRY_FRAME_SECONDS = 0.1;
    const DRAG_THRESHOLD = 4;        // px of movement before a press becomes a drag
    const POSITION_KEY = "louie";    // sessionStorage: where he is, between pages
    const BED_KEY = "louieInBed";    // localStorage: stays in bed until woken

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const smallScreen = window.matchMedia("(max-width: 600px)");

    function seq(name, count) {
        const list = [];
        for (let i = 0; i < count; i++) list.push(SPRITES + name + "_" + i + ".png");
        return list;
    }

    const frames = {
        stand: SPRITES + "stand.png",
        sit: SPRITES + "sit.png",
        sleep: SPRITES + "sleep.png",
        eat: SPRITES + "eat.png",
        playBow: SPRITES + "play_bow.png",
        walk: seq("walk", 4),
        run: seq("run", 4),
        carry: seq("carry_ball", 4),
    };
    const props = {
        bowl: { src: SPRITES + "bowl.png", w: 16, h: 7 },
        ball: { src: SPRITES + "ball.png", w: 8, h: 8 },
    };

    function randomBetween(min, max) {
        return min + Math.random() * (max - min);
    }

    function storageGet(store, key) {
        try { return store.getItem(key); } catch (e) { return null; }
    }
    function storageSet(store, key, value) {
        try {
            if (value === null) store.removeItem(key); else store.setItem(key, value);
        } catch (e) { /* storage may be unavailable; nothing to remember */ }
    }

    function init() {
        const yard = document.querySelector(".louie-yard");
        if (!yard) return;
        const menu = document.querySelector(".louie-menu");

        // Preload every frame so animations never flicker
        [frames.stand, frames.sit, frames.sleep, frames.eat, frames.playBow, props.bowl.src, props.ball.src]
            .concat(frames.walk, frames.run, frames.carry)
            .forEach(function (src) { new Image().src = src; });

        // --- Build Louie ------------------------------------------------------
        const pet = document.createElement("button");
        pet.type = "button";
        pet.className = "louie";
        pet.setAttribute("aria-label", "Louie, my dog. Press to pet him.");

        const body = document.createElement("span");
        body.className = "louie-body";

        const sprite = document.createElement("img");
        sprite.className = "louie-sprite";
        sprite.src = frames.stand;
        sprite.alt = "";
        sprite.draggable = false;

        body.appendChild(sprite);
        pet.appendChild(body);
        yard.appendChild(pet);

        // --- State --------------------------------------------------------------
        let scale = 1;
        let width = 0;
        let height = 0;
        let walkSpeed = 0;
        let runSpeed = 0;
        let x = 0;               // left edge of Louie within the yard, in px
        let y = 0;               // height above the ground, in px (dragging/settling)
        let direction = 1;       // 1 = facing right, -1 = facing left
        let phase = "walking";   // walking | sitting | sniffing | sleeping | dragging | settling | moment
        let phaseTimeLeft = 0;
        let anim = null;         // current frame loop: { list, seconds, index, time }
        let moment = null;       // active feed/fetch/zoomies routine
        let press = null;        // active pointer press
        let lastTime = null;
        let inBed = storageGet(localStorage, BED_KEY) === "1";

        function yardWidth() { return yard.clientWidth; }
        function minX() { return 0; }
        function maxX() { return Math.max(0, yardWidth() - width); }
        function clampX(value) { return Math.min(Math.max(value, minX()), maxX()); }
        function mouthX() { return x + width * (direction > 0 ? MOUTH_X : 1 - MOUTH_X); }

        function measure() {
            scale = smallScreen.matches ? 1.25 : 1.9;
            width = Math.round(FRAME_W * scale);
            // His box ends at his feet; the sprite is taller and the empty
            // rows below his feet are clipped, so he stands on the ground
            height = Math.round(FEET_ROWS * scale);
            walkSpeed = smallScreen.matches ? 26 : 36;   // px/s, like the desktop app
            runSpeed = smallScreen.matches ? 80 : 110;
            pet.style.width = width + "px";
            pet.style.height = height + "px";
            sprite.style.height = Math.round(FRAME_H * scale) + "px";
            x = clampX(x);
        }

        function render() {
            pet.style.transform = "translate3d(" + x + "px, " + (-y) + "px, 0)";
            sprite.style.transform = direction < 0 ? "scaleX(-1)" : "";
        }

        // Show one still frame, or loop a list of frames
        function show(src) {
            anim = null;
            sprite.src = src;
        }
        function loop(list, seconds) {
            anim = { list: list, seconds: seconds, index: 0, time: 0 };
            sprite.src = list[0];
        }
        function stepAnimation(dt) {
            if (!anim) return;
            anim.time += dt;
            while (anim.time >= anim.seconds) {
                anim.time -= anim.seconds;
                anim.index = (anim.index + 1) % anim.list.length;
                sprite.src = anim.list[anim.index];
            }
        }

        // Move toward a target x at a speed; returns true once he's there
        function moveToward(targetX, speed, dt) {
            targetX = clampX(targetX);
            const distance = targetX - x;
            if (Math.abs(distance) < 1) { x = targetX; return true; }
            direction = distance > 0 ? 1 : -1;
            const step = Math.min(Math.abs(distance), speed * dt);
            x += direction * step;
            return Math.abs(targetX - x) < 1;
        }

        // --- Wander phases (same timings as the desktop app) -------------------
        function setPhase(next) {
            phase = next;
            pet.classList.remove("is-sniffing", "is-dragging");
            sprite.style.opacity = "";

            if (next === "walking") {
                phaseTimeLeft = randomBetween(4, 9);
                loop(frames.walk, WALK_FRAME_SECONDS);
            } else if (next === "sitting") {
                phaseTimeLeft = randomBetween(2, 5);
                show(frames.sit);
            } else if (next === "sniffing") {
                phaseTimeLeft = randomBetween(2, 4);
                show(frames.stand);
                pet.classList.add("is-sniffing");
            } else if (next === "sleeping") {
                phaseTimeLeft = randomBetween(8, 16);
                show(frames.sleep);
            } else if (next === "dragging") {
                phaseTimeLeft = Infinity;
                show(frames.stand);
                pet.classList.add("is-dragging");
            }
        }

        function randomIdlePhase() {
            const roll = Math.random();
            if (reduceMotion.matches) return roll < 0.6 ? "sitting" : "sleeping";
            if (roll < 0.45) return "sitting";
            if (roll < 0.7) return "sniffing";
            if (roll < 0.85) return "sleeping";
            return "walking";
        }

        function advancePhase() {
            if (phase === "walking" || reduceMotion.matches) setPhase(randomIdlePhase());
            else setPhase("walking");
        }

        function wander(dt, time) {
            phaseTimeLeft -= dt;
            if (phaseTimeLeft <= 0) advancePhase();

            if (phase === "walking") {
                // Turn around at the edges of the yard, then step
                if (x >= maxX() && direction > 0) direction = -1;
                else if (x <= minX() && direction < 0) direction = 1;
                x = clampX(x + direction * walkSpeed * dt);
            } else if (phase === "sleeping" && !reduceMotion.matches) {
                // Gentle breathing, like the desktop version
                sprite.style.opacity = String(0.85 + 0.15 * Math.sin(time / 1000 * 1.6));
            }
        }

        // --- Props --------------------------------------------------------------
        function makeProp(kind) {
            const info = props[kind];
            const img = document.createElement("img");
            img.className = "louie-prop";
            img.src = info.src;
            img.alt = "";
            img.style.width = Math.round(info.w * scale) + "px";
            img.style.height = Math.round(info.h * scale) + "px";
            yard.appendChild(img);
            return {
                el: img,
                w: info.w * scale,
                place: function (left, up) {
                    img.style.transform = "translate3d(" + left + "px, " + (-(up || 0)) + "px, 0)";
                },
                remove: function () { img.remove(); },
            };
        }

        // --- Moments: feed, fetch, zoomies ---------------------------------------
        // Each moment is a small script of steps. update(dt) runs every frame and
        // returns true when the moment is over.
        function startMoment(kind) {
            if (inBed) return;
            endMoment();
            if (press) press = null;
            y = 0;
            phase = "moment";
            pet.classList.remove("is-sniffing", "is-dragging");
            sprite.style.opacity = "";
            moment = kind === "feed" ? feedMoment()
                : kind === "fetch" ? fetchMoment()
                : zoomiesMoment();
        }

        function endMoment() {
            if (moment && moment.cleanup) moment.cleanup();
            moment = null;
        }

        function finishMoment(nextPhase) {
            endMoment();
            setPhase(nextPhase || "sitting");
        }

        // Feed: a full bowl appears, he trots over, eats, then looks happy
        function feedMoment() {
            const bowl = makeProp("bowl");
            // Put the bowl a little way off so he has to go get it
            const spaceRight = maxX() - x;
            const goRight = spaceRight > x || spaceRight > width * 1.5;
            const bowlX = Math.min(Math.max(
                goRight ? x + width + randomBetween(0.5, 1.5) * width : x - randomBetween(0.5, 1.5) * width,
                0), yardWidth() - bowl.w);
            bowl.place(bowlX, 0);
            // He walks over until his mouth is above the bowl
            const bowlCenter = bowlX + bowl.w / 2;
            let step = reduceMotion.matches ? "eat" : "go";
            let timer = 0;
            if (step === "eat") {
                direction = bowlCenter >= mouthX() ? 1 : -1;
                bowl.remove();
                show(frames.eat);
                timer = 3;
            } else {
                loop(frames.walk, WALK_FRAME_SECONDS * 0.8);
            }
            return {
                cleanup: function () { bowl.remove(); },
                update: function (dt) {
                    if (step === "go") {
                        const facingRight = bowlCenter >= x + width / 2;
                        const target = facingRight ? bowlCenter - width * MOUTH_X : bowlCenter - width * (1 - MOUTH_X);
                        if (moveToward(target, walkSpeed * 1.6, dt)) {
                            direction = facingRight ? 1 : -1;
                            bowl.remove(); // the eating frame has its own bowl
                            show(frames.eat);
                            step = "eat";
                            timer = 3;
                        }
                    } else if (step === "eat") {
                        timer -= dt;
                        if (timer <= 0) {
                            spawnHearts();
                            finishMoment("sitting");
                            return true;
                        }
                    }
                    return false;
                },
            };
        }

        // Fetch, like the desktop app: he drops the ball and play-bows. YOU throw
        // it: drag the ball and let go to fling it (or just tap it / press
        // Enter for a quick toss). It flies with gravity and bounces; he runs
        // after it, carries it back to where you threw from, drops it and
        // bows for another. If nobody throws for a while he gives up and sits.
        function fetchMoment() {
            const size = Math.round(props.ball.w * scale);   // drawn ball size
            const ball = document.createElement("button");   // big, easy hit area
            ball.type = "button";
            ball.className = "louie-ball";
            ball.setAttribute("aria-label", "Ball. Drag and let go to throw it, or press to toss it.");
            const ballImg = document.createElement("img");
            ballImg.src = props.ball.src;
            ballImg.alt = "";
            ballImg.draggable = false;
            ballImg.style.width = size + "px";
            ballImg.style.height = size + "px";
            ball.appendChild(ballImg);
            yard.appendChild(ball);

            // Ball state, in yard coordinates: cx = center from the yard's left
            // edge, up = center height above the ground. Velocities in px/s.
            let cx = 0;
            let up = size / 2;
            let vx = 0;
            let vy = 0;
            let step = "invite";       // invite | held | flying | return | drop
            let idle = 0;              // seconds waiting for a throw
            let timer = 0;
            let throwFromX = x;        // he brings the ball back here
            let grab = null;           // { id, offX, offY, samples, dragging }
            let hinted = false;

            function placeBall() {
                const hit = ball.offsetWidth || 44;
                ball.style.transform = "translate3d(" + (cx - hit / 2) + "px, " + (-(up - hit / 2)) + "px, 0)";
            }
            function ceilingUp() {
                // Let the ball fly up to the top of the window, not just the yard
                return Math.max(size, yard.getBoundingClientRect().bottom) - size / 2;
            }
            function dropBallAtMouth() {
                cx = Math.min(Math.max(mouthX() + direction * size, size / 2), yardWidth() - size / 2);
                up = size / 2;
                vx = 0;
                vy = 0;
                ball.hidden = false;
                placeBall();
            }
            function invite() {
                step = "invite";
                idle = 0;
                show(frames.playBow);
                dropBallAtMouth();
                if (!hinted) {
                    hinted = true;
                    say("Throw the ball!");
                }
            }
            function launch(newVx, newVy) {
                vx = Math.max(-2500, Math.min(2500, newVx));
                vy = Math.max(-2500, Math.min(2500, newVy));
                throwFromX = clampX(cx - width / 2);
                step = "flying";
                if (reduceMotion.matches) {
                    // No flying or running: he just "fetches" it right away
                    ball.hidden = true;
                    show(frames.carry[0]);
                    step = "drop";
                    timer = 1;
                } else {
                    loop(frames.run, RUN_FRAME_SECONDS);
                }
            }
            function quickToss() {
                // Toward whichever side has more room
                const toRight = yardWidth() - cx > cx;
                launch((toRight ? 1 : -1) * randomBetween(500, 900), randomBetween(500, 800));
            }

            // --- Throwing: drag + release with pointer events -----------------
            function toYard(event) {
                const rect = yard.getBoundingClientRect();
                return { x: event.clientX - rect.left, up: rect.bottom - event.clientY };
            }
            ball.addEventListener("pointerdown", function (event) {
                if (event.button !== 0 || (step !== "invite" && step !== "flying")) return;
                const p = toYard(event);
                grab = { id: event.pointerId, offX: cx - p.x, offY: up - p.up, start: p, dragging: false, samples: [] };
                try { ball.setPointerCapture(event.pointerId); } catch (e) { /* capture is a nicety */ }
                event.stopPropagation();
            });
            ball.addEventListener("pointermove", function (event) {
                if (!grab || event.pointerId !== grab.id) return;
                const p = toYard(event);
                if (!grab.dragging && Math.hypot(p.x - grab.start.x, p.up - grab.start.up) > DRAG_THRESHOLD) {
                    grab.dragging = true;
                    step = "held";
                    ball.classList.add("is-held");
                    show(frames.stand);
                }
                if (!grab.dragging) return;
                cx = Math.min(Math.max(p.x + grab.offX, size / 2), yardWidth() - size / 2);
                up = Math.min(Math.max(p.up + grab.offY, size / 2), ceilingUp());
                const now = performance.now();
                grab.samples.push({ t: now, x: cx, up: up });
                while (grab.samples.length > 2 && now - grab.samples[0].t > 100) grab.samples.shift();
                placeBall();
            });
            function releaseBall(event) {
                if (!grab || event.pointerId !== grab.id) return;
                const g = grab;
                grab = null;
                ball.classList.remove("is-held");
                if (!g.dragging) {
                    if (event.type === "pointerup" && step === "invite") quickToss();
                    return;
                }
                // Fling velocity from the last ~100ms of the drag
                const s = g.samples;
                let flingX = 0;
                let flingY = 0;
                if (s.length >= 2) {
                    const dt = Math.max((s[s.length - 1].t - s[0].t) / 1000, 0.016);
                    flingX = (s[s.length - 1].x - s[0].x) / dt;
                    flingY = (s[s.length - 1].up - s[0].up) / dt;
                }
                launch(flingX, flingY);
            }
            ball.addEventListener("pointerup", releaseBall);
            ball.addEventListener("pointercancel", releaseBall);
            // Keyboard: Enter/Space on the focused ball tosses it
            ball.addEventListener("click", function (event) {
                if (event.detail === 0 && step === "invite") quickToss();
            });

            // --- Ball physics ----------------------------------------------------
            function stepBall(dt) {
                const top = ceilingUp();
                vy -= GRAVITY * dt;
                cx += vx * dt;
                up += vy * dt;
                // Walls of the yard
                if (cx < size / 2) { cx = size / 2; vx = Math.abs(vx) * 0.6; }
                if (cx > yardWidth() - size / 2) { cx = yardWidth() - size / 2; vx = -Math.abs(vx) * 0.6; }
                // Top of the window
                if (up > top) { up = top; vy = -Math.abs(vy) * 0.5; }
                // Ground: bounce, lose energy, then roll to a stop
                if (up <= size / 2) {
                    up = size / 2;
                    if (vy < 0) {
                        vy = -vy * 0.5;
                        vx *= 0.85;
                        if (vy < 90) vy = 0;
                    }
                    if (vy === 0) {
                        const friction = 500 * dt;
                        vx = Math.abs(vx) <= friction ? 0 : vx - Math.sign(vx) * friction;
                    }
                }
                placeBall();
            }
            function ballOnGround() { return up <= size / 2 + 1 && vy === 0; }

            invite();

            return {
                cleanup: function () { ball.remove(); },
                update: function (dt) {
                    if (step === "invite") {
                        idle += dt;
                        if (idle > IDLE_FETCH_SECONDS) {
                            finishMoment("sitting"); // nobody's throwing; he gives up
                            return true;
                        }
                    } else if (step === "held") {
                        // Watch the ball while you hold it
                        direction = cx >= x + width / 2 ? 1 : -1;
                    } else if (step === "flying") {
                        stepBall(dt);
                        // Run so his mouth ends up at the ball
                        const target = cx >= x + width / 2 ? cx - width * MOUTH_X : cx - width * (1 - MOUTH_X);
                        moveToward(target, runSpeed * 1.3, dt);
                        const close = Math.abs(cx - mouthX()) < Math.max(10, size * 0.8);
                        if (close && up < size * 1.5 && (ballOnGround() || Math.abs(vx) < 400)) {
                            ball.hidden = true; // the carry frames have the ball in his mouth
                            loop(frames.carry, CARRY_FRAME_SECONDS);
                            step = "return";
                        }
                    } else if (step === "return") {
                        if (moveToward(throwFromX, runSpeed * 0.8, dt)) {
                            step = "drop";
                            timer = 0.2;
                        }
                    } else if (step === "drop") {
                        timer -= dt;
                        if (timer <= 0) {
                            spawnHearts();
                            invite(); // drop it and bow for another throw
                        }
                    }
                    return false;
                },
            };
        }

        // Zoomies: a few fast laps over and back, then a long nap
        function zoomiesMoment() {
            if (reduceMotion.matches) {
                // Without motion he skips straight to the tired part
                return {
                    update: function () {
                        finishMoment("sleeping");
                        phaseTimeLeft = randomBetween(25, 40);
                        return true;
                    },
                };
            }
            const laps = Math.floor(randomBetween(2, 4)); // 2 or 3, one lap = over and back
            const legs = [];
            let goRightFirst = x < maxX() / 2;
            for (let i = 0; i < laps * 2; i++) {
                legs.push((i % 2 === 0) === goRightFirst ? maxX() : minX());
            }
            // Fast, but scaled to the yard so each leg takes ~2.5s even on wide screens
            const zoomSpeed = Math.max(runSpeed * 1.6, maxX() / 2.5);
            loop(frames.run, RUN_FRAME_SECONDS * 0.8);
            return {
                update: function (dt) {
                    if (moveToward(legs[0], zoomSpeed, dt)) {
                        legs.shift();
                        if (legs.length === 0) {
                            finishMoment("sleeping");
                            phaseTimeLeft = randomBetween(25, 40); // tired out
                            return true;
                        }
                    }
                    return false;
                },
            };
        }

        // --- Main loop -------------------------------------------------------------
        function tick(time) {
            // Cap dt so a backgrounded tab doesn't make him teleport
            const dt = lastTime === null ? 0 : Math.min((time - lastTime) / 1000, 0.1);
            lastTime = time;

            if (!inBed) {
                if (moment) {
                    moment.update(dt);
                } else if (phase !== "dragging" && phase !== "settling") {
                    wander(dt, time);
                }
                stepAnimation(dt);
                render();
            }
            requestAnimationFrame(tick);
        }

        // --- Petting ------------------------------------------------------------------
        function petLouie() {
            if (phase === "sleeping") setPhase("sitting"); // a pat wakes him up
            if (!reduceMotion.matches) {
                body.classList.remove("is-petted");
                void body.offsetWidth; // restart the bounce if he's petted again quickly
                body.classList.add("is-petted");
            }
            spawnHearts();
        }

        function spawnHearts() {
            const headX = mouthX();
            for (let i = 0; i < 3; i++) {
                const heart = document.createElement("span");
                heart.className = "louie-heart";
                const size = randomBetween(2.5, 3.5); // px per heart pixel, keeps it blocky
                heart.style.width = Math.round(7 * size) + "px";
                heart.style.height = Math.round(6 * size) + "px";
                heart.style.left = (headX + randomBetween(-6, 6) - 3.5 * size) + "px";
                heart.style.bottom = (y + height * 0.8) + "px";
                yard.appendChild(heart);

                const drift = randomBetween(-16, 16);
                const rise = reduceMotion.matches ? 0 : 40;
                const animation = heart.animate([
                    { transform: "translate(0, 0)", opacity: 1 },
                    { transform: "translate(" + drift * 0.35 + "px, " + (-rise * 0.35) + "px)", opacity: 1, offset: 0.35 },
                    { transform: "translate(" + drift + "px, " + (-rise) + "px)", opacity: 0 },
                ], { duration: 700, delay: randomBetween(0, 150), easing: "ease-out", fill: "both" });
                animation.onfinish = function () { heart.remove(); };
                setTimeout(function () { heart.remove(); }, 1500); // in case animations are paused
            }
        }

        // --- Speech bubble --------------------------------------------------------------
        function say(text) {
            const bubble = document.createElement("span");
            bubble.className = "louie-bubble";
            bubble.textContent = text;
            bubble.setAttribute("role", "status");
            yard.appendChild(bubble);

            function place() {
                if (!bubble.isConnected) return;
                const maxLeft = Math.max(0, yardWidth() - bubble.offsetWidth);
                const left = Math.min(Math.max(mouthX() - bubble.offsetWidth / 2, 0), maxLeft);
                bubble.style.transform = "translate3d(" + left + "px, " + (-(y + height + 8)) + "px, 0)";
                requestAnimationFrame(place);
            }
            place();

            setTimeout(function () {
                bubble.classList.add("is-leaving");
                setTimeout(function () { bubble.remove(); }, 400);
            }, 4000);
        }

        // --- Dragging (mouse + touch via pointer events) ------------------------------
        pet.addEventListener("pointerdown", function (event) {
            if (event.button !== 0) return;
            const rect = pet.getBoundingClientRect();
            press = {
                id: event.pointerId,
                startX: event.clientX,
                startY: event.clientY,
                grabX: event.clientX - rect.left,
                grabY: event.clientY - rect.top,
                dragging: false,
            };
            try { pet.setPointerCapture(event.pointerId); } catch (e) { /* capture is a nicety */ }
        });

        pet.addEventListener("pointermove", function (event) {
            if (!press || event.pointerId !== press.id) return;
            const moved = Math.hypot(event.clientX - press.startX, event.clientY - press.startY);
            if (!press.dragging && moved > DRAG_THRESHOLD) {
                press.dragging = true;
                endMoment(); // picking him up interrupts whatever he was doing
                setPhase("dragging");
            }
            if (press.dragging) {
                const yardRect = yard.getBoundingClientRect();
                x = clampX(event.clientX - press.grabX - yardRect.left);
                y = Math.max(0, yardRect.bottom - (event.clientY - press.grabY) - height);
            }
        });

        function endPress(event) {
            if (!press || event.pointerId !== press.id) return;
            const wasDragging = press.dragging;
            press = null;
            if (wasDragging) settle();
            else if (event.type === "pointerup") petLouie();
        }
        pet.addEventListener("pointerup", endPress);
        pet.addEventListener("pointercancel", endPress);

        // Keyboard: Enter/Space on the focused button pets him
        pet.addEventListener("click", function (event) {
            if (event.detail === 0) petLouie();
        });

        function settle() {
            // Drop back to the ground with an ease-out, like the app's settle
            phase = "settling";
            pet.classList.remove("is-dragging");
            show(frames.stand);
            const startY = y;
            const start = performance.now();
            const duration = reduceMotion.matches ? 0 : 180;
            (function fall(now) {
                const t = duration === 0 ? 1 : Math.min((now - start) / duration, 1);
                y = startY * Math.pow(1 - t, 2);
                if (t < 1) {
                    requestAnimationFrame(fall);
                } else {
                    y = 0;
                    setPhase(reduceMotion.matches ? "sitting" : "walking");
                }
            })(start);
        }

        // --- Bed: hide him until he's woken up ---------------------------------------
        function setInBed(value) {
            inBed = value;
            storageSet(localStorage, BED_KEY, value ? "1" : null);
            if (value) {
                endMoment();
                yard.querySelectorAll(".louie-heart, .louie-bubble").forEach(function (el) { el.remove(); });
            } else {
                y = 0;
                setPhase("sitting");
                render();
            }
            pet.classList.toggle("is-asleep", value);
            updateMenu();
        }

        // --- Home page menu ------------------------------------------------------------------
        function updateMenu() {
            if (!menu) return;
            menu.querySelectorAll("[data-louie]").forEach(function (item) {
                const isWake = item.dataset.louie === "wake";
                item.hidden = inBed ? !isWake : isWake;
            });
        }

        if (menu) {
            menu.addEventListener("click", function (event) {
                const item = event.target.closest("[data-louie]");
                if (!item) return;
                const action = item.dataset.louie;
                if (action === "bed") {
                    setInBed(true);
                    menu.querySelector('[data-louie="wake"]').focus(); // keep keyboard focus in the menu
                } else if (action === "wake") {
                    setInBed(false);
                    say("I'm up!");
                    menu.querySelector('[data-louie="bed"]').focus();
                } else {
                    startMoment(action);
                }
            });
        }

        // --- Remember him between pages ---------------------------------------------
        function save() {
            const resting = ["walking", "sitting", "sniffing", "sleeping"].indexOf(phase) >= 0 ? phase : "walking";
            const fraction = maxX() > 0 ? x / maxX() : 0.5; // yards differ in width between pages
            storageSet(sessionStorage, POSITION_KEY, JSON.stringify({ at: fraction, direction: direction, phase: resting }));
        }
        window.addEventListener("pagehide", save);

        let saved = null;
        try { saved = JSON.parse(storageGet(sessionStorage, POSITION_KEY)); } catch (e) { saved = null; }

        // --- Start ---------------------------------------------------------------------
        measure();
        smallScreen.addEventListener("change", measure);
        window.addEventListener("resize", function () { x = clampX(x); render(); });

        if (saved && typeof saved.at === "number") {
            x = clampX(saved.at * maxX());
            direction = saved.direction === -1 ? -1 : 1;
            setPhase(reduceMotion.matches && saved.phase === "walking" ? "sitting" : saved.phase);
        } else {
            // First visit this session: start somewhere in the yard and say hi
            x = clampX(randomBetween(0.1, 0.7) * maxX());
            direction = Math.random() < 0.5 ? -1 : 1;
            setPhase(reduceMotion.matches ? "sitting" : "walking");
            if (!inBed) setTimeout(function () { say("Hi, I'm Louie!"); }, 800);
        }

        pet.classList.toggle("is-asleep", inBed);
        updateMenu();
        render();
        requestAnimationFrame(tick);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
