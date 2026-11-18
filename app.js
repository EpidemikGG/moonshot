// MOONSHOT — Minimalist Core Game Engine (v5)
(function () {
  const TOTAL_ROUNDS = 10;
  const MAX_POINTS = 500;
  const MOON_DISTANCE_KM = 384400;
  const ROUND_SECONDS = 30;

  let gameMode = "daily";
  let missionQuestions = [];
  let currentRoundIdx = 0;
  let totalPoints = 0;
  let roundHistory = [];
  let timerInterval = null;
  let secondsLeft = ROUND_SECONDS;
  let roundActive = false;
  let soundEnabled = true;
  let audioCtx = null;
  let pendingTypoEntry = null;

  // DOM Elements
  const skyWorld = document.getElementById("sky-world");
  const rulerFill = document.getElementById("ruler-fill");
  const starshipActor = document.getElementById("starship-actor");
  const starshipBoostPop = document.getElementById("starship-boost-pop");
  const starshipAltTag = document.getElementById("starship-alt-tag");
  const thrusterOuter = document.getElementById("thruster-outer");

  const altitudeCard = document.getElementById("altitude-card");
  const zoneNameEl = document.getElementById("zone-name");
  const altitudeKmEl = document.getElementById("altitude-km");
  const scoreTotalEl = document.getElementById("score-total");
  const roundNumEl = document.getElementById("round-num");
  const roundsStripEl = document.getElementById("rounds-strip");

  const timerTrackEl = document.getElementById("timer-track");
  const timerBarEl = document.getElementById("timer-bar");
  const timerSecondsEl = document.getElementById("timer-seconds");
  const startView = document.getElementById("start-view");
  const btnStartGame = document.getElementById("btn-start-game");
  const playView = document.getElementById("play-view");
  const revealView = document.getElementById("reveal-view");
  const summaryView = document.getElementById("summary-view");

  const qCategoryEl = document.getElementById("q-category");
  const qAvgSearchesEl = document.getElementById("q-avg-searches");
  const qPromptEl = document.getElementById("q-prompt");

  const keywordForm = document.getElementById("keyword-form");
  const inputPill = document.getElementById("input-pill");
  const keywordInput = document.getElementById("keyword-input");
  const wordCountChip = document.getElementById("word-count-chip");
  const typoSuggestionBox = document.getElementById("typo-suggestion-box");
  const typoWordBtn = document.getElementById("typo-word-btn");
  const feedbackMsgEl = document.getElementById("feedback-msg");
  const skipRoundBtn = document.getElementById("skip-round-btn");

  const revealTierBadge = document.getElementById("reveal-tier-badge");
  const revealUserKw = document.getElementById("reveal-user-kw");
  const revealStatLine = document.getElementById("reveal-stat-line");
  const sampleTiersGrid = document.getElementById("sample-tiers-grid");
  const nextRoundBtn = document.getElementById("next-round-btn");

  const summaryRankTitle = document.getElementById("summary-rank-title");
  const summaryScoreBig = document.getElementById("summary-score-big");
  const summaryAltitudeSub = document.getElementById("summary-altitude-sub");
  const summaryTableBody = document.getElementById("summary-table-body");
  const btnShareScore = document.getElementById("btn-share-score");
  const btnPlayAgain = document.getElementById("btn-play-again");

  const btnModeDaily = document.getElementById("btn-mode-daily");
  const btnModeFree = document.getElementById("btn-mode-free");
  const btnHowToPlay = document.getElementById("btn-how-to-play");
  const btnSoundToggle = document.getElementById("btn-sound-toggle");
  const rulesModal = document.getElementById("rules-modal");
  const closeRulesBtn = document.getElementById("close-rules-btn");

  function formatNumber(n) {
    return Number(n).toLocaleString("en-US");
  }

  function normalizeText(raw) {
    return raw
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[-_]/g, " ")
      .replace(/[^a-z0-9+#\s]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function getWords(raw) {
    const cleaned = raw.trim().replace(/\s+/g, " ");
    if (!cleaned) return [];
    return cleaned.split(" ");
  }

  function getDailySeed() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  }

  function hashString(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function seededShuffle(array, seedStr) {
    const copy = array.slice();
    let state = hashString(seedStr) || 1;
    function nextRand() {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 4294967296;
    }
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(nextRand() * (i + 1));
      const tmp = copy[i];
      copy[i] = copy[j];
      copy[j] = tmp;
    }
    return copy;
  }

  // Damerau-Levenshtein Edit Distance (handles 1 or 2 wrong/missing/extra/swapped letters)
  function editDistance(a, b) {
    const lenA = a.length;
    const lenB = b.length;
    if (Math.abs(lenA - lenB) > 2) return 99;

    const dp = Array.from({ length: lenA + 1 }, () => new Array(lenB + 1).fill(0));
    for (let i = 0; i <= lenA; i++) dp[i][0] = i;
    for (let j = 0; j <= lenB; j++) dp[0][j] = j;

    for (let i = 1; i <= lenA; i++) {
      for (let j = 1; j <= lenB; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,      // deletion
          dp[i][j - 1] + 1,      // insertion
          dp[i - 1][j - 1] + cost // substitution
        );
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
          dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + cost); // transposition
        }
      }
    }
    return dp[lenA][lenB];
  }

  function matchAnswer(question, rawInput) {
    const norm = normalizeText(rawInput);
    if (!norm) return null;
    const candidates = new Set([norm]);
    if (norm.endsWith("ies") && norm.length > 4) candidates.add(norm.slice(0, -3) + "y");
    if (norm.endsWith("es") && norm.length > 3) candidates.add(norm.slice(0, -2));
    if (norm.endsWith("s") && norm.length > 2) candidates.add(norm.slice(0, -1));
    else candidates.add(norm + "s");
    if (norm.startsWith("the ")) candidates.add(norm.slice(4));

    for (const entry of question.answers) {
      if (candidates.has(normalizeText(entry.k))) return entry;
    }
    return null;
  }

  // Find closest answer if user got 1 or 2 letters wrong
  function findCloseTypoMatch(question, rawInput) {
    const norm = normalizeText(rawInput);
    if (!norm || norm.length < 3) return null;

    let bestEntry = null;
    let bestDist = 3; // Only allow distance 1 or 2

    for (const entry of question.answers) {
      const target = normalizeText(entry.k);
      // Avoid suggesting a completely different 3-letter word at distance 2
      const maxAllowed = Math.min(target.length, norm.length) <= 4 ? 1 : 2;
      const dist = editDistance(norm, target);
      if (dist >= 1 && dist <= maxAllowed && dist < bestDist) {
        bestDist = dist;
        bestEntry = entry;
      }
    }
    return bestEntry;
  }

  function playSound(type) {
    if (!soundEnabled) return;
    try {
      if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (audioCtx.state === "suspended") audioCtx.resume();
      const now = audioCtx.currentTime;
      const notesByType = {
        DIAMOND: [523.25, 659.25, 783.99, 1046.5],
        PLATINUM: [440, 554.37, 659.25],
        GOLD: [392, 493.88, 587.33],
        SILVER: [329.63, 440],
        BRONZE: [261.63, 329.63],
        ERROR: [150]
      };
      const freqs = notesByType[type] || [300];
      freqs.forEach((f, idx) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = type === "ERROR" ? "sawtooth" : "sine";
        osc.frequency.setValueAtTime(f, now + idx * 0.07);
        gain.gain.setValueAtTime(0.08, now + idx * 0.07);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.07 + 0.24);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now + idx * 0.07);
        osc.stop(now + idx * 0.07 + 0.25);
      });
    } catch (e) {}
  }

  function getZoneLabel(pts) {
    if (pts >= 500) return "🌕 The Moon";
    if (pts >= 400) return "🛰️ Lunar Orbit";
    if (pts >= 300) return "🌌 Deep Space";
    if (pts >= 200) return "✨ Kármán Line";
    if (pts >= 100) return "🎈 Stratosphere";
    return "🌍 Launchpad";
  }

  // Krillion-style Background Starship & Sky World Ascent
  function updateAltitudeVisuals(lastPointsEarned = null) {
    const ratio = Math.min(1, Math.max(0, totalPoints / MAX_POINTS));
    const currentKm = Math.round(ratio * MOON_DISTANCE_KM);

    zoneNameEl.textContent = getZoneLabel(totalPoints);
    altitudeKmEl.textContent = `${formatNumber(currentKm)} km`;
    scoreTotalEl.textContent = String(totalPoints);

    // 1. Scroll the 300vh vertical sky world downward so we ascend from Earth (0vh) to the Moon (200vh)
    const worldShiftVh = (ratio * 200).toFixed(2);
    if (skyWorld) {
      skyWorld.style.transform = `translateY(${worldShiftVh}vh)`;
    }

    // 2. Update Left-Edge Altitude Ruler
    if (rulerFill) {
      rulerFill.style.height = `${Math.max(2, Math.round(ratio * 95))}%`;
    }

    // 3. Position Background Starship vertically (from 8vh at 0 pts up to 76vh at 500 pts)
    if (starshipActor) {
      // If user just scored 0 pts after already being in flight, dip slightly
      let shipBottomVh = 8 + ratio * 68;
      if (lastPointsEarned === 0 && totalPoints > 0) {
        shipBottomVh = Math.max(8, shipBottomVh - 3.5);
      }
      starshipActor.style.bottom = `${shipBottomVh.toFixed(1)}vh`;
      starshipAltTag.textContent = `${formatNumber(currentKm)} km`;

      // Animate Starship Boost or Stall based on points earned
      starshipActor.classList.remove("boosting", "stalling");
      void starshipActor.offsetWidth;

      if (lastPointsEarned !== null) {
        if (lastPointsEarned > 0) {
          starshipActor.classList.add("boosting");
          starshipBoostPop.textContent = `+${lastPointsEarned} PTS 🚀`;
          starshipBoostPop.classList.remove("hidden");
          // Scale thruster flame based on points (10 to 50)
          const flameScale = 0.8 + (lastPointsEarned / 50) * 0.9;
          if (thrusterOuter) {
            thrusterOuter.style.transformOrigin = "32px 68px";
            thrusterOuter.style.transform = `scaleY(${flameScale.toFixed(2)})`;
          }
        } else {
          starshipActor.classList.add("stalling");
          starshipBoostPop.textContent = `0 PTS · STALL`;
          starshipBoostPop.classList.remove("hidden");
          if (thrusterOuter) {
            thrusterOuter.style.transform = "scaleY(0.4)";
          }
        }
      } else {
        starshipBoostPop.classList.add("hidden");
        if (thrusterOuter) {
          thrusterOuter.style.transform = "scaleY(1)";
        }
      }
    }
  }

  function renderRoundPips(isStarted = true) {
    roundsStripEl.innerHTML = "";
    for (let i = 0; i < TOTAL_ROUNDS; i++) {
      const pip = document.createElement("div");
      pip.className = "pip";
      if (i < roundHistory.length) {
        pip.classList.add(`done-${roundHistory[i].tierId || "MISS"}`);
      } else if (isStarted && i === currentRoundIdx) {
        pip.classList.add("current");
      }
      roundsStripEl.appendChild(pip);
    }
  }

  function hideTypoSuggestion() {
    pendingTypoEntry = null;
    if (typoSuggestionBox) {
      typoSuggestionBox.classList.add("hidden");
    }
  }

  function showStartScreen(mode) {
    clearInterval(timerInterval);
    roundActive = false;
    gameMode = mode || gameMode;
    btnModeDaily.classList.toggle("active", gameMode === "daily");
    btnModeFree.classList.toggle("active", gameMode === "free");

    currentRoundIdx = 0;
    totalPoints = 0;
    roundHistory = [];
    hideTypoSuggestion();

    if (altitudeCard) altitudeCard.classList.add("hidden");
    timerTrackEl.classList.add("hidden");
    playView.classList.add("hidden");
    revealView.classList.add("hidden");
    summaryView.classList.add("hidden");
    startView.classList.remove("hidden");

    btnStartGame.textContent = gameMode === "daily" ? "▶ Play Daily Launch" : "▶ Play Free Play";
    updateAltitudeVisuals(null);
    renderRoundPips(false);
  }

  function startMission(mode) {
    gameMode = mode || gameMode;
    btnModeDaily.classList.toggle("active", gameMode === "daily");
    btnModeFree.classList.toggle("active", gameMode === "free");

    const seed = gameMode === "daily" ? getDailySeed() : String(Date.now() + Math.random());
    missionQuestions = seededShuffle(window.QUESTION_BANK, seed).slice(0, TOTAL_ROUNDS);

    currentRoundIdx = 0;
    totalPoints = 0;
    roundHistory = [];

    startView.classList.add("hidden");
    summaryView.classList.add("hidden");
    revealView.classList.add("hidden");
    if (altitudeCard) altitudeCard.classList.remove("hidden");
    playView.classList.remove("hidden");

    updateAltitudeVisuals(null);
    loadCurrentRound();
  }

  function loadCurrentRound() {
    const q = missionQuestions[currentRoundIdx];
    roundActive = true;

    roundNumEl.textContent = String(currentRoundIdx + 1);
    qCategoryEl.textContent = q.category;
    qAvgSearchesEl.textContent = formatNumber(q.avgSearches);
    qPromptEl.textContent = q.prompt;

    keywordInput.value = "";
    feedbackMsgEl.textContent = "";
    hideTypoSuggestion();
    updateWordCountChip();

    startView.classList.add("hidden");
    revealView.classList.add("hidden");
    summaryView.classList.add("hidden");
    playView.classList.remove("hidden");
    timerTrackEl.classList.remove("hidden");

    renderRoundPips(true);
    startTimer();
    setTimeout(() => keywordInput.focus(), 40);
  }

  function startTimer() {
    clearInterval(timerInterval);
    secondsLeft = ROUND_SECONDS;
    updateTimerUI();

    timerInterval = setInterval(() => {
      secondsLeft--;
      updateTimerUI();
      if (secondsLeft <= 0) {
        clearInterval(timerInterval);
        if (roundActive) handleRoundComplete(null, true);
      }
    }, 1000);
  }

  function updateTimerUI() {
    timerSecondsEl.textContent = `${secondsLeft}s`;
    const pct = Math.max(0, (secondsLeft / ROUND_SECONDS) * 100);
    timerBarEl.style.width = `${pct}%`;
    const isUrgent = secondsLeft <= 7;
    timerSecondsEl.classList.toggle("urgent", isUrgent);
    timerBarEl.classList.toggle("urgent", isUrgent);
  }

  function updateWordCountChip() {
    const count = getWords(keywordInput.value).length;
    wordCountChip.textContent = `${count}/2`;
    wordCountChip.classList.remove("valid", "invalid");
    if (count === 1 || count === 2) wordCountChip.classList.add("valid");
    else if (count > 2) wordCountChip.classList.add("invalid");
  }

  keywordInput.addEventListener("input", () => {
    updateWordCountChip();
    hideTypoSuggestion();
    if (feedbackMsgEl.textContent) feedbackMsgEl.textContent = "";
  });

  // Clicking the suggested corrected word submits it immediately
  if (typoWordBtn) {
    typoWordBtn.addEventListener("click", () => {
      if (!roundActive || !pendingTypoEntry) return;
      const entry = pendingTypoEntry;
      hideTypoSuggestion();
      handleRoundComplete(entry, false);
    });
  }

  keywordForm.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!roundActive) return;

    const raw = keywordInput.value.trim();
    const words = getWords(raw);

    if (words.length === 0) {
      triggerError("Enter 1 or 2 words");
      return;
    }
    if (words.length > 2) {
      triggerError("Max 2 words allowed");
      playSound("ERROR");
      return;
    }

    const currentQ = missionQuestions[currentRoundIdx];
    const matched = matchAnswer(currentQ, raw);

    if (matched) {
      hideTypoSuggestion();
      handleRoundComplete(matched, false);
      return;
    }

    // Check if the user got 1 or 2 letters wrong
    const closeMatch = findCloseTypoMatch(currentQ, raw);
    if (closeMatch) {
      pendingTypoEntry = closeMatch;
      typoWordBtn.textContent = closeMatch.k;
      typoSuggestionBox.classList.remove("hidden");
      feedbackMsgEl.textContent = "";
      playSound("SILVER");
      return;
    }

    hideTypoSuggestion();
    triggerError(`"${raw}" not recognized — try another`);
    playSound("ERROR");
  });

  function triggerError(msg) {
    feedbackMsgEl.textContent = msg;
    inputPill.classList.remove("error");
    void inputPill.offsetWidth;
    inputPill.classList.add("error");
  }

  skipRoundBtn.addEventListener("click", () => {
    if (roundActive) handleRoundComplete(null, false);
  });

  function handleRoundComplete(matchedEntry, timedOut) {
    roundActive = false;
    clearInterval(timerInterval);
    hideTypoSuggestion();

    const currentQ = missionQuestions[currentRoundIdx];
    let earnedPts = 0;
    let tierId = "MISS";

    if (matchedEntry) {
      tierId = matchedEntry.t;
      const cfg = window.TIER_CONFIG[tierId];
      earnedPts = cfg.points;
      totalPoints += earnedPts;
      playSound(tierId);

      revealTierBadge.style.color = cfg.color;
      revealTierBadge.style.borderColor = cfg.color;
      revealTierBadge.textContent = `${cfg.icon} ${cfg.name} · +${earnedPts} PTS`;
      revealUserKw.textContent = matchedEntry.k;

      const pctOfAvg = (matchedEntry.v / currentQ.avgSearches) * 100;
      const diffText =
        matchedEntry.v < currentQ.avgSearches
          ? `${(100 - pctOfAvg).toFixed(1)}% rarer than the <strong>${formatNumber(currentQ.avgSearches)}</strong> avg`
          : `Above the <strong>${formatNumber(currentQ.avgSearches)}</strong> monthly avg`;

      revealStatLine.innerHTML = `<strong>${formatNumber(matchedEntry.v)}</strong> Google searches/mo · ${diffText}`;
    } else {
      playSound("ERROR");
      revealTierBadge.style.color = "var(--danger)";
      revealTierBadge.style.borderColor = "rgba(244, 63, 94, 0.4)";
      revealTierBadge.textContent = timedOut ? "⏱️ TIME UP · +0 PTS" : "⏭️ SKIPPED · +0 PTS";
      revealUserKw.textContent = "No Keyword";
      revealStatLine.innerHTML = `Question avg: <strong>${formatNumber(currentQ.avgSearches)}</strong> searches/mo`;
    }

    roundHistory.push({
      round: currentRoundIdx + 1,
      prompt: currentQ.prompt,
      keyword: matchedEntry ? matchedEntry.k : "—",
      searches: matchedEntry ? matchedEntry.v : 0,
      tierId,
      points: earnedPts
    });

    updateAltitudeVisuals(earnedPts);
    renderRoundPips(true);
    renderCompactSpectrum(currentQ);

    nextRoundBtn.textContent =
      currentRoundIdx + 1 < TOTAL_ROUNDS
        ? `Continue to Round ${currentRoundIdx + 2} →`
        : "See Final Score →";

    playView.classList.add("hidden");
    revealView.classList.remove("hidden");
    setTimeout(() => nextRoundBtn.focus(), 40);
  }

  function renderCompactSpectrum(question) {
    const picks = [
      { key: "BRONZE", label: "🥉 Common (10p)", color: "var(--bronze)" },
      { key: "GOLD", label: "🥇 Rare (30p)", color: "var(--gold)" },
      { key: "DIAMOND", label: "💎 Diamond (50p)", color: "var(--diamond)" }
    ];

    sampleTiersGrid.innerHTML = picks
      .map((p) => {
        const sample = question.answers.find((a) => a.t === p.key) || question.answers[0];
        return `
          <div class="spectrum-cell">
            <div class="spectrum-label" style="color:${p.color}">${p.label}</div>
            <div class="spectrum-word">${sample.k}</div>
            <div class="spectrum-vol">${formatNumber(sample.v)}/mo</div>
          </div>
        `;
      })
      .join("");
  }

  nextRoundBtn.addEventListener("click", () => {
    currentRoundIdx++;
    if (currentRoundIdx < TOTAL_ROUNDS) loadCurrentRound();
    else showMissionSummary();
  });

  function getRankTitle(pts) {
    if (pts >= 480) return "🌕 APOLLO MOONWALKER";
    if (pts >= 400) return "🛰️ LUNAR ORBIT COMMANDER";
    if (pts >= 300) return "🌌 DEEP SPACE NAVIGATOR";
    if (pts >= 200) return "✨ KÁRMÁN LINE PIONEER";
    if (pts >= 100) return "🎈 STRATOSPHERE CAPTAIN";
    return "🌍 TROPOSPHERE CADET";
  }

  function showMissionSummary() {
    timerTrackEl.classList.add("hidden");
    revealView.classList.add("hidden");
    playView.classList.add("hidden");
    summaryView.classList.remove("hidden");

    const km = Math.round((totalPoints / MAX_POINTS) * MOON_DISTANCE_KM);
    summaryRankTitle.textContent = getRankTitle(totalPoints);
    summaryScoreBig.innerHTML = `${totalPoints} <span style="font-size:1.1rem;color:var(--text-secondary);font-weight:500;">/ 500</span>`;
    summaryAltitudeSub.textContent = `Reached ${formatNumber(km)} km altitude`;

    summaryTableBody.innerHTML = roundHistory
      .map((item) => {
        const cfg = window.TIER_CONFIG[item.tierId];
        const color = cfg ? cfg.color : "var(--text-muted)";
        const icon = cfg ? cfg.icon : "—";
        return `
          <div class="summary-row">
            <span style="color:var(--text-secondary);">${item.round}. <strong style="color:#fff;text-transform:capitalize;">${item.keyword}</strong></span>
            <span style="font-family:var(--font-mono);color:${color};font-weight:700;">${icon} +${item.points}</span>
          </div>
        `;
      })
      .join("");
  }

  btnShareScore.addEventListener("click", () => {
    const km = Math.round((totalPoints / MAX_POINTS) * MOON_DISTANCE_KM);
    const emojis = roundHistory.map((r) => (window.TIER_CONFIG[r.tierId] ? window.TIER_CONFIG[r.tierId].icon : "⬛")).join("");
    const text = `🚀 MOONSHOT ${totalPoints}/500 (${formatNumber(km)} km)\n${emojis}`;
    navigator.clipboard.writeText(text).then(() => {
      btnShareScore.textContent = "Copied!";
      setTimeout(() => (btnShareScore.textContent = "Copy Score"), 2000);
    });
  });

  btnStartGame.addEventListener("click", () => startMission(gameMode));
  btnPlayAgain.addEventListener("click", () => startMission("free"));
  btnModeDaily.addEventListener("click", () => showStartScreen("daily"));
  btnModeFree.addEventListener("click", () => showStartScreen("free"));

  btnHowToPlay.addEventListener("click", () => rulesModal.classList.remove("hidden"));
  closeRulesBtn.addEventListener("click", () => rulesModal.classList.add("hidden"));
  rulesModal.addEventListener("click", (e) => {
    if (e.target === rulesModal) rulesModal.classList.add("hidden");
  });

  btnSoundToggle.addEventListener("click", () => {
    soundEnabled = !soundEnabled;
    btnSoundToggle.textContent = soundEnabled ? "🔊" : "🔇";
  });

  function initStarfield() {
    const canvas = document.getElementById("starfield-canvas");
    const ctx = canvas.getContext("2d");
    let stars = [];
    function resize() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      stars = Array.from({ length: 90 }, () => ({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        r: Math.random() * 1.4 + 0.3,
        alpha: Math.random() * 0.65 + 0.15,
        speed: Math.random() * 0.25 + 0.05
      }));
    }
    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const mult = 1 + (totalPoints / MAX_POINTS) * 3.5;
      for (const s of stars) {
        s.y += s.speed * mult;
        if (s.y > canvas.height) {
          s.y = 0;
          s.x = Math.random() * canvas.width;
        }
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 255, 255, ${s.alpha})`;
        ctx.fill();
      }
      requestAnimationFrame(draw);
    }
    window.addEventListener("resize", resize);
    resize();
    draw();
  }

  initStarfield();
  showStartScreen("daily");
})();
