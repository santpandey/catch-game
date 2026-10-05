// DOM overlay UI for Slip Catch: title screen, HUD, pop messages,
// game-over panel and mute toggle. All DOM is built inside #ui.

const SVG_NS = "http://www.w3.org/2000/svg";
const RESTART_ARM_MS = 450;
const POP_MS = 900;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function speakerIcon(muted) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "24");
  svg.setAttribute("height", "24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const paths = ["M4 9h4l5-4v14l-5-4H4z"];
  if (muted) {
    paths.push("M16.5 9.5l5 5", "M21.5 9.5l-5 5");
  } else {
    paths.push("M16 9a4 4 0 0 1 0 6", "M18.5 6.5a7.5 7.5 0 0 1 0 11");
  }
  paths.forEach((d, i) => {
    const p = document.createElementNS(SVG_NS, "path");
    p.setAttribute("d", d);
    p.setAttribute("fill", i === 0 ? "currentColor" : "none");
    p.setAttribute("stroke", "currentColor");
    p.setAttribute("stroke-width", i === 0 ? "1.5" : "2");
    p.setAttribute("stroke-linecap", "round");
    p.setAttribute("stroke-linejoin", "round");
    svg.appendChild(p);
  });
  return svg;
}

function pauseIcon(paused) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "24");
  svg.setAttribute("height", "24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  // paused -> play triangle, playing -> two bars
  const paths = paused
    ? ["M7 5l12 7-12 7z"]
    : ["M7 5h3.4v14H7z", "M13.6 5H17v14h-3.4z"];
  paths.forEach((d) => {
    const p = document.createElementNS(SVG_NS, "path");
    p.setAttribute("d", d);
    p.setAttribute("fill", "currentColor");
    svg.appendChild(p);
  });
  return svg;
}

function restartAnim(node, className) {
  node.classList.remove(className);
  void node.offsetWidth; // force reflow so the animation re-runs
  node.classList.add(className);
}

function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text);
  }
  return new Promise((resolve, reject) => {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch (err) {
      ok = false;
    }
    ta.remove();
    if (ok) resolve();
    else reject(new Error("copy failed"));
  });
}

export function createUI({ onStart, onRestart, onToggleMute, onTogglePause } = {}) {
  let root = document.getElementById("ui");
  if (!root) {
    root = el("div");
    root.id = "ui";
    document.body.appendChild(root);
  }
  root.textContent = "";

  let state = "none"; // "title" | "playing" | "gameover"
  let gameOverAt = 0;
  let lastScore = null;
  let lastMultiplier = 1;
  let shareResetTimer = 0;
  let lastResult = { score: 0, catches: 0 };

  // ---------- Title ----------
  const title = el("div", "sc-overlay sc-title is-hidden");
  title.setAttribute("role", "dialog");
  title.setAttribute("aria-label", "Slip Catch title screen");
  const titleInner = el("div", "sc-title__inner");
  const wordmark = el("h1", "sc-wordmark");
  wordmark.append(el("span", "sc-wordmark__slip", "SLIP"), el("span", "sc-wordmark__catch", "CATCH"));
  const tagline = el("p", "sc-tagline", "Floodlit slip-cordon practice. Track the swing, cup your hands, keep the streak alive.");
  const titleBest = el("p", "sc-title__best");
  const hint = el("p", "sc-hint", "Move your mouse or finger to position your hands");
  const prompt = el("p", "sc-prompt", "Click or tap to play");
  titleInner.append(wordmark, tagline, titleBest, hint, prompt);
  title.appendChild(titleInner);

  function start(e) {
    if (state !== "title") return;
    if (e && e.cancelable && e.type !== "pointerup") e.preventDefault();
    if (typeof onStart === "function") onStart();
  }
  title.addEventListener("click", start);

  // ---------- HUD ----------
  const hud = el("div", "sc-hud is-hidden");
  hud.setAttribute("aria-hidden", "true");

  const scoreBox = el("div", "sc-hud__group sc-hud__score");
  scoreBox.appendChild(el("span", "sc-label", "Score"));
  const scoreVal = el("span", "sc-hud__score-val", "0");
  scoreBox.appendChild(scoreVal);

  const streakBox = el("div", "sc-hud__group sc-hud__streak");
  streakBox.appendChild(el("span", "sc-label", "Streak"));
  const streakRow = el("span", "sc-hud__streak-row");
  const streakVal = el("span", "sc-hud__val", "0");
  const multBadge = el("span", "sc-badge is-off", "x1");
  streakRow.append(streakVal, multBadge);
  streakBox.appendChild(streakRow);

  const livesBox = el("div", "sc-hud__group sc-hud__lives");
  livesBox.appendChild(el("span", "sc-label", "Lives"));
  const livesRow = el("span", "sc-lives");
  livesBox.appendChild(livesRow);

  const bestBox = el("div", "sc-hud__group sc-hud__best");
  bestBox.appendChild(el("span", "sc-label", "Best"));
  const bestVal = el("span", "sc-hud__val", "0");
  bestBox.appendChild(bestVal);

  hud.append(scoreBox, streakBox, livesBox, bestBox);

  // ---------- Pop messages ----------
  const pops = el("div", "sc-pops");
  pops.setAttribute("aria-live", "polite");
  pops.setAttribute("aria-atomic", "true");

  // ---------- Game over ----------
  const over = el("div", "sc-overlay sc-over is-hidden");
  over.setAttribute("role", "dialog");
  over.setAttribute("aria-modal", "true");
  over.setAttribute("aria-labelledby", "sc-over-heading");
  const card = el("div", "sc-card");
  const overHeading = el("h2", "sc-over__heading", "Game over");
  overHeading.id = "sc-over-heading";
  const stats = el("dl", "sc-stats");
  function stat(label) {
    const wrap = el("div", "sc-stat");
    const dd = el("dd", "sc-stat__val", "0");
    wrap.append(el("dt", "sc-label", label), dd);
    stats.appendChild(wrap);
    return { wrap, dd };
  }
  const statScore = stat("Score");
  statScore.wrap.classList.add("sc-stat--main");
  const statCatches = stat("Catches");
  const statBest = stat("Best");
  const actions = el("div", "sc-actions");
  const againBtn = el("button", "sc-btn sc-btn--primary", "Play again");
  againBtn.type = "button";
  const shareBtn = el("button", "sc-btn sc-btn--ghost", "Share");
  shareBtn.type = "button";
  actions.append(againBtn, shareBtn);
  card.append(overHeading, stats, actions);
  over.appendChild(card);

  const canShareProtocol = /^https?:$/.test(location.protocol);
  if (!canShareProtocol) shareBtn.hidden = true;

  function restart(e) {
    if (state !== "gameover") return;
    if (performance.now() - gameOverAt < RESTART_ARM_MS) return;
    if (e && e.cancelable) e.preventDefault();
    if (typeof onRestart === "function") onRestart();
  }
  againBtn.addEventListener("click", restart);

  function setShareLabel(text) {
    shareBtn.textContent = text;
    clearTimeout(shareResetTimer);
    shareResetTimer = setTimeout(() => {
      shareBtn.textContent = "Share";
    }, 2000);
  }

  shareBtn.addEventListener("click", () => {
    const { score, catches } = lastResult;
    const text = `I caught ${catches} in Slip Catch! Score ${score}`;
    const url = location.href;
    if (navigator.share) {
      navigator.share({ title: "Slip Catch", text, url }).catch((err) => {
        if (err && err.name === "AbortError") return;
        copyText(`${text} ${url}`).then(
          () => setShareLabel("Link copied"),
          () => setShareLabel("Couldn't copy")
        );
      });
      return;
    }
    copyText(`${text} ${url}`).then(
      () => setShareLabel("Link copied"),
      () => setShareLabel("Couldn't copy")
    );
  });

  // ---------- Mute ----------
  const muteBtn = el("button", "sc-mute");
  muteBtn.type = "button";
  muteBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (typeof onToggleMute === "function") onToggleMute();
  });
  // Keep mute presses from starting the game / reaching the canvas.
  muteBtn.addEventListener("pointerdown", (e) => e.stopPropagation());

  function setMuted(isMuted) {
    muteBtn.textContent = "";
    muteBtn.appendChild(speakerIcon(!!isMuted));
    muteBtn.setAttribute("aria-label", isMuted ? "Unmute sound" : "Mute sound");
    muteBtn.setAttribute("aria-pressed", isMuted ? "true" : "false");
    muteBtn.title = isMuted ? "Unmute" : "Mute";
  }
  setMuted(false);
  muteBtn.addEventListener("touchstart", (e) => e.stopPropagation());

  // ---------- Pause ----------
  let pauseOpen = false;

  const pauseBtn = el("button", "sc-mute sc-pause");
  pauseBtn.type = "button";
  pauseBtn.hidden = true;
  pauseBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (typeof onTogglePause === "function") onTogglePause();
  });
  pauseBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
  pauseBtn.addEventListener("touchstart", (e) => e.stopPropagation());

  function setPaused(isPaused) {
    pauseBtn.textContent = "";
    pauseBtn.appendChild(pauseIcon(!!isPaused));
    pauseBtn.setAttribute("aria-label", isPaused ? "Resume" : "Pause");
    pauseBtn.setAttribute("aria-pressed", isPaused ? "true" : "false");
    pauseBtn.title = isPaused ? "Resume" : "Pause";
  }
  setPaused(false);

  const pauseOver = el("div", "sc-overlay sc-paused is-hidden");
  pauseOver.setAttribute("role", "dialog");
  pauseOver.setAttribute("aria-modal", "true");
  const pauseCard = el("div", "sc-card");
  pauseCard.appendChild(el("h2", "sc-over__heading", "Paused"));
  const pauseActions = el("div", "sc-actions");
  const resumeBtn = el("button", "sc-btn sc-btn--primary", "Resume");
  resumeBtn.type = "button";
  const pauseRestartBtn = el("button", "sc-btn sc-btn--ghost", "Restart");
  pauseRestartBtn.type = "button";
  pauseActions.append(resumeBtn, pauseRestartBtn);
  pauseCard.append(pauseActions, el("p", "sc-hint", "P / Esc to resume"));
  pauseOver.appendChild(pauseCard);

  resumeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (typeof onTogglePause === "function") onTogglePause();
  });
  pauseRestartBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (typeof onRestart === "function") onRestart();
  });
  for (const b of [resumeBtn, pauseRestartBtn]) {
    b.addEventListener("pointerdown", (e) => e.stopPropagation());
    b.addEventListener("touchstart", (e) => e.stopPropagation());
  }

  function showPause() {
    pauseOpen = true;
    show(pauseOver);
  }

  function hidePause() {
    pauseOpen = false;
    hide(pauseOver);
    if (document.activeElement && pauseOver.contains(document.activeElement)) {
      document.activeElement.blur();
    }
  }

  function setPauseAvailable(avail) {
    pauseBtn.hidden = !avail;
  }

  root.append(title, hud, pops, over, pauseOver, pauseBtn, muteBtn);

  // ---------- Keyboard ----------
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " " && e.key !== "Spacebar") return;
    if (e.repeat) return;
    // Focused buttons handle Enter/Space natively via their click event.
    const t = e.target;
    if (t && t.closest && t.closest("button, a, input, textarea, select")) return;
    if (pauseOpen) {
      if (typeof onTogglePause === "function") onTogglePause();
      return;
    }
    if (state === "title") start(e);
    else if (state === "gameover") restart(e);
  });

  // ---------- Helpers ----------
  function show(node) {
    node.classList.remove("is-hidden");
    node.removeAttribute("aria-hidden");
  }
  function hide(node) {
    node.classList.add("is-hidden");
    node.setAttribute("aria-hidden", "true");
  }

  // ---------- API ----------
  function setBest(n) {
    const v = Math.max(0, Math.floor(Number(n) || 0));
    bestVal.textContent = String(v);
  }

  function showTitle(best) {
    state = "title";
    const b = Math.floor(Number(best) || 0);
    if (b > 0) {
      titleBest.textContent = `Best: ${b}`;
      titleBest.hidden = false;
    } else {
      titleBest.hidden = true;
    }
    show(title);
  }

  function hideTitle() {
    if (state === "title") state = "playing";
    hide(title);
    if (document.activeElement && title.contains(document.activeElement)) {
      document.activeElement.blur();
    }
  }

  function showHud() {
    if (state !== "gameover") state = "playing";
    hud.classList.remove("is-hidden");
  }

  function hideHud() {
    hud.classList.add("is-hidden");
  }

  function setScore(n) {
    const v = Math.floor(Number(n) || 0);
    scoreVal.textContent = String(v);
    if (lastScore !== null && v !== lastScore) restartAnim(scoreVal, "is-bump");
    lastScore = v;
  }

  function setStreak(streak, multiplier) {
    streakVal.textContent = String(Math.max(0, Math.floor(Number(streak) || 0)));
    const m = Number(multiplier) || 1;
    multBadge.textContent = `x${m}`;
    multBadge.classList.toggle("is-off", m <= 1);
    if (m > 1 && m !== lastMultiplier) restartAnim(multBadge, "is-bounce");
    lastMultiplier = m;
  }

  function setLives(remaining, max) {
    const total = Math.max(0, Math.floor(Number(max) || 3));
    const left = Math.max(0, Math.min(total, Math.floor(Number(remaining) || 0)));
    while (livesRow.children.length < total) livesRow.appendChild(el("span", "sc-ball"));
    while (livesRow.children.length > total) livesRow.lastChild.remove();
    Array.from(livesRow.children).forEach((ball, i) => {
      const wasLost = ball.classList.contains("is-lost");
      const lost = i >= left;
      ball.classList.toggle("is-lost", lost);
      if (lost && !wasLost && livesRow.dataset.init) restartAnim(ball, "is-dropping");
    });
    livesRow.dataset.init = "1";
    livesBox.setAttribute("aria-label", `${left} of ${total} lives`);
  }

  function popMessage(text, kind = "info") {
    const k = kind === "good" || kind === "bad" ? kind : "info";
    pops.textContent = "";
    const pop = el("div", `sc-pop sc-pop--${k}`, String(text));
    pops.appendChild(pop);
    const cleanup = () => {
      if (pop.parentNode) pop.remove();
    };
    pop.addEventListener("animationend", cleanup, { once: true });
    setTimeout(cleanup, POP_MS + 200);
  }

  function showGameOver({ score = 0, best = 0, isNewBest = false, catches = 0 } = {}) {
    state = "gameover";
    gameOverAt = performance.now();
    lastResult = { score, catches };
    overHeading.textContent = isNewBest ? "New best!" : "Game over";
    over.classList.toggle("is-new-best", !!isNewBest);
    statScore.dd.textContent = String(score);
    statCatches.dd.textContent = String(catches);
    statBest.dd.textContent = String(best);
    clearTimeout(shareResetTimer);
    shareBtn.textContent = "Share";
    pops.textContent = "";
    show(over);
    setTimeout(() => {
      if (state === "gameover") againBtn.focus({ preventScroll: true });
    }, 50);
  }

  function hideGameOver() {
    if (state === "gameover") state = "playing";
    hide(over);
    if (document.activeElement && over.contains(document.activeElement)) {
      document.activeElement.blur();
    }
  }

  setLives(3, 3);
  setStreak(0, 1);
  setScore(0);
  setBest(0);

  return {
    showTitle,
    hideTitle,
    showHud,
    hideHud,
    setScore,
    setStreak,
    setLives,
    setBest,
    popMessage,
    showGameOver,
    hideGameOver,
    setMuted,
    showPause,
    hidePause,
    setPauseAvailable,
    setPaused,
  };
}
