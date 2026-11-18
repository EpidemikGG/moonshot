// MOONSHOT — Living Space Shuttle & Search-Rarity Trivia Engine (v6)
(function () {
  const TOTAL_ROUNDS = 10;
  const MAX_POINTS = 500;
  const MOON_DISTANCE_KM = 384400;
  const ROUND_SECONDS = 30;

  let gameMode = "daily";
  let missionQuestions = [];
  let currentRoundIdx = 0;
  let totalPoints = 0;
  let lastZoneIdx = 0;
  let rareStreak = 0;
  let roundHistory = [];
  let timerInterval = null;
  let secondsLeft = ROUND_SECONDS;
  let roundActive = false;
  let soundEnabled = true;
  let audioCtx = null;
  let pendingTypoEntry = null;

  // Particle System State (for Shuttle Exhaust Clouds & Meteors)
  let exhaustParticles = [];
  let burstIntensity = 0;

  // DOM Elements
  const skyWorld = document.getElementById("sky-world");
  const rulerFill = document.getElementById("ruler-fill");
  const milestoneBanner = document.getElementById("milestone-banner");
  const starshipActor = document.getElementById("starship-actor");
  const starshipBoostPop = document.getElementById("starship-boost-pop");
  const starshipAltTag = document.getElementById("starship-alt-tag");
  const thrusterOuter = document.getElementById("thruster-outer");
  const streakPill = document.getElementById("streak-pill");

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
  const btnHint = document.getElementById("btn-hint");
  const hintBanner = document.getElementById("hint-banner");

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

  // Damerau-Levenshtein Edit Distance (1 or 2 wrong/missing/extra/swapped letters)
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
          dp[i - 1][j] + 1,
          dp[i][j - 1] + 1,
          dp[i - 1][j - 1] + cost
        );
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
          dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + cost);
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

  function findCloseTypoMatch(question, rawInput) {
    const norm = normalizeText(rawInput);
    if (!norm || norm.length < 3) return null;

    let bestEntry = null;
    let bestDist = 3;

    for (const entry of question.answers) {
      const target = normalizeText(entry.k);
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
        HINT: [587.33, 880],
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

  function getZoneInfo(pts) {
    if (pts >= 500) return { idx: 5, label: "🌕 The Moon", banner: "🌕 TOUCHDOWN ON THE MOON!" };
    if (pts >= 400) return { idx: 4, label: "🌌 Deep Space", banner: "🌌 ENTERED DEEP SPACE!" };
    if (pts >= 300) return { idx: 3, label: "🛰️ Orbital Space", banner: "🛰️ REACHED ORBITAL SPACE!" };
    if (pts >= 200) return { idx: 2, label: "✨ Kármán Line", banner: "✨ CROSSED THE KÁRMÁN LINE!" };
    if (pts >= 100) return { idx: 1, label: "🎈 Stratosphere", banner: "🎈 ENTERED THE STRATOSPHERE!" };
    return { idx: 0, label: "🌍 Launchpad", banner: "" };
  }

  function showMilestoneToast(text) {
    if (!milestoneBanner || !text) return;
    milestoneBanner.textContent = text;
    milestoneBanner.classList.remove("hidden");
    setTimeout(() => {
      milestoneBanner.classList.add("hidden");
    }, 3200);
  }

  function spawnExhaustBurst(count, isHighTier) {
    if (!starshipActor) return;
    const rect = starshipActor.getBoundingClientRect();
    const nozzleX = rect.left + rect.width / 2;
    const nozzleY = rect.bottom - 48;

    const palette = isHighTier
      ? ["#fff8dc", "#ffd166", "#38bdf8", "#f5a638", "#e65c19"]
      : ["#fae3a4", "#f5a638", "#e65c19", "#c94f0f"];

    for (let i = 0; i < count; i++) {
      const spreadX = (Math.random() - 0.5) * 68;
      exhaustParticles.push({
        x: nozzleX + spreadX,
        y: nozzleY + (Math.random() - 0.5) * 16,
        vx: (spreadX / 35) + (Math.random() - 0.5) * 1.4,
        vy: Math.random() * 3.8 + 1.8,
        r: Math.random() * 20 + 12,
        maxR: Math.random() * 44 + 28,
        alpha: 0.88,
        color: palette[Math.floor(Math.random() * palette.length)]
      });
    }
  }

  function updateAltitudeVisuals(lastPointsEarned = null) {
    const ratio = Math.min(1, Math.max(0, totalPoints / MAX_POINTS));
    const currentKm = Math.round(ratio * MOON_DISTANCE_KM);
    const zone = getZoneInfo(totalPoints);

    zoneNameEl.textContent = zone.label;
    altitudeKmEl.textContent = `${formatNumber(currentKm)} km`;
    scoreTotalEl.textContent = String(totalPoints);

    if (zone.idx > lastZoneIdx && zone.banner) {
      showMilestoneToast(zone.banner);
    }
    lastZoneIdx = zone.idx;

    // 1. Scroll the 400vh vertical sky world downward up to 300vh
    const worldShiftVh = (ratio * 300).toFixed(2);
    if (skyWorld) {
      skyWorld.style.transform = `translateY(${worldShiftVh}vh)`;
    }

    // 2. Update Left Altitude Gauge
    if (rulerFill) {
      rulerFill.style.height = `${Math.max(2, Math.round(ratio * 100))}%`;
    }

    // 3. Position Giant Space Shuttle vertically (7vh at pad up to 48vh at Moon)
    if (starshipActor) {
      let shipBottomVh = 7 + ratio * 41;
      if (lastPointsEarned === 0 && totalPoints > 0) {
        shipBottomVh = Math.max(7, shipBottomVh - 4);
      }
      starshipActor.style.bottom = `${shipBottomVh.toFixed(1)}vh`;
      starshipAltTag.textContent = `${formatNumber(currentKm)} km`;

      starshipActor.classList.remove("boosting", "stalling");
      void starshipActor.offsetWidth;

      if (lastPointsEarned !== null) {
        if (lastPointsEarned > 0) {
          starshipActor.classList.add("boosting");
          starshipBoostPop.textContent = `+${lastPointsEarned} PTS 🚀`;
          starshipBoostPop.classList.remove("hidden");
          burstIntensity = Math.round(lastPointsEarned / 2);
          spawnExhaustBurst(22 + Math.round(lastPointsEarned * 0.6), lastPointsEarned >= 40);
        } else {
          starshipActor.classList.add("stalling");
          starshipBoostPop.textContent = `0 PTS · TURBULENCE`;
          starshipBoostPop.classList.remove("hidden");
        }
      } else {
        starshipBoostPop.classList.add("hidden");
      }
    }

    // Update Streak Badge
    if (streakPill) {
      if (rareStreak >= 2) {
        streakPill.textContent = `🔥 ${rareStreak}x Streak`;
        streakPill.classList.remove("hidden");
      } else {
        streakPill.classList.add("hidden");
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
    if (typoSuggestionBox) typoSuggestionBox.classList.add("hidden");
  }

  function showStartScreen(mode) {
    clearInterval(timerInterval);
    roundActive = false;
    gameMode = mode || gameMode;
    btnModeDaily.classList.toggle("active", gameMode === "daily");
    btnModeFree.classList.toggle("active", gameMode === "free");

    currentRoundIdx = 0;
    totalPoints = 0;
    lastZoneIdx = 0;
    rareStreak = 0;
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
    lastZoneIdx = 0;
    rareStreak = 0;
    roundHistory = [];

    startView.classList.add("hidden");
    summaryView.classList.add("hidden");
    revealView.classList.add("hidden");
    if (altitudeCard) altitudeCard.classList.remove("hidden");
    playView.classList.remove("hidden");

    spawnExhaustBurst(28, false);
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
    if (hintBanner) hintBanner.classList.add("hidden");
    if (btnHint) btnHint.disabled = false;
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

  // Hint button reveals starting letter & length of a Platinum/Gold keyword
  if (btnHint) {
    btnHint.addEventListener("click", () => {
      if (!roundActive) return;
      const q = missionQuestions[currentRoundIdx];
      const candidates = q.answers.filter((a) => a.t === "PLATINUM" || a.t === "GOLD" || a.t === "DIAMOND");
      const pick = candidates[Math.floor(Math.random() * candidates.length)] || q.answers[0];
      const words = pick.k.split(" ");
      const firstLetter = pick.k.charAt(0).toUpperCase();
      hintBanner.innerHTML = `💡 <strong>${pick.t} Hint:</strong> Starts with <strong>"${firstLetter}..."</strong> (${words.length} ${words.length === 1 ? "word" : "words"}, ${pick.k.length} letters)`;
      hintBanner.classList.remove("hidden");
      btnHint.disabled = true;
      playSound("HINT");
      keywordInput.focus();
    });
  }

  keywordInput.addEventListener("input", () => {
    updateWordCountChip();
    hideTypoSuggestion();
    // Little thruster puff every time the player types!
    spawnExhaustBurst(2, false);
    if (feedbackMsgEl.textContent) feedbackMsgEl.textContent = "";
  });

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
      if (earnedPts >= 30) rareStreak++;
      else rareStreak = 0;

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
      rareStreak = 0;
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

  // === Living Cosmos & Billowing Shuttle Exhaust Canvas ===
  function initCosmosCanvas() {
    const canvas = document.getElementById("cosmos-canvas");
    const ctx = canvas.getContext("2d");
    let stars = [];
    let sparkles = [];
    let meteor = null;

    function resize() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;

      // Round background stars
      stars = Array.from({ length: 85 }, () => ({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        r: Math.random() * 1.4 + 0.4,
        alpha: Math.random() * 0.7 + 0.2,
        speed: Math.random() * 0.3 + 0.06
      }));

      // 4-point twinkling star sparkles matching reference image
      sparkles = Array.from({ length: 18 }, () => ({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height * 0.85,
        size: Math.random() * 5 + 4,
        phase: Math.random() * Math.PI * 2,
        speed: Math.random() * 0.03 + 0.015
      }));
    }

    function drawFourPointStar(x, y, size, alpha) {
      ctx.save();
      ctx.translate(x, y);
      ctx.fillStyle = `rgba(251, 246, 232, ${alpha})`;
      ctx.beginPath();
      ctx.moveTo(0, -size);
      ctx.quadraticCurveTo(size * 0.18, -size * 0.18, size, 0);
      ctx.quadraticCurveTo(size * 0.18, size * 0.18, 0, size);
      ctx.quadraticCurveTo(-size * 0.18, size * 0.18, -size, 0);
      ctx.quadraticCurveTo(-size * 0.18, -size * 0.18, 0, -size);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const speedMult = 1 + (totalPoints / MAX_POINTS) * 4 + (burstIntensity > 0 ? 3 : 0);
      if (burstIntensity > 0) burstIntensity -= 0.25;

      // 1. Draw drifting stars
      for (const s of stars) {
        s.y += s.speed * speedMult;
        if (s.y > canvas.height) {
          s.y = 0;
          s.x = Math.random() * canvas.width;
        }
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(250, 238, 205, ${s.alpha})`;
        ctx.fill();
      }

      // 2. Draw 4-point twinkling stars
      for (const sp of sparkles) {
        sp.phase += sp.speed;
        const twinkle = 0.35 + Math.sin(sp.phase) * 0.55;
        if (twinkle > 0.1) {
          drawFourPointStar(sp.x, sp.y, sp.size * (0.7 + twinkle * 0.4), twinkle);
        }
      }

      // 3. Occasional shooting star
      if (!meteor && Math.random() < 0.004) {
        meteor = {
          x: Math.random() * canvas.width * 0.8 + canvas.width * 0.1,
          y: Math.random() * canvas.height * 0.35,
          vx: -6.5,
          vy: 3.5,
          life: 1
        };
      }
      if (meteor) {
        ctx.save();
        ctx.strokeStyle = `rgba(250, 227, 164, ${meteor.life})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(meteor.x, meteor.y);
        ctx.lineTo(meteor.x - meteor.vx * 6, meteor.y - meteor.vy * 6);
        ctx.stroke();
        ctx.restore();
        meteor.x += meteor.vx;
        meteor.y += meteor.vy;
        meteor.life -= 0.03;
        if (meteor.life <= 0) meteor = null;
      }

      // 4. Continuous idle exhaust clouds under the Space Shuttle's 3 nozzles
      if (starshipActor && Math.random() < 0.55) {
        const rect = starshipActor.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.bottom - 38;
        const nozzleOffsets = [-46, 0, 46];
        const pickOffset = nozzleOffsets[Math.floor(Math.random() * nozzleOffsets.length)];
        const colors = ["#fae3a4", "#f5a638", "#e65c19"];
        exhaustParticles.push({
          x: cx + pickOffset + (Math.random() - 0.5) * 12,
          y: cy + Math.random() * 8,
          vx: (pickOffset / 45) * 0.5 + (Math.random() - 0.5) * 0.6,
          vy: Math.random() * 1.8 + 1.2,
          r: Math.random() * 10 + 8,
          maxR: Math.random() * 24 + 18,
          alpha: 0.72,
          color: colors[Math.floor(Math.random() * colors.length)]
        });
      }

      // 5. Render & update billowing exhaust cloud particles
      for (let i = exhaustParticles.length - 1; i >= 0; i--) {
        const p = exhaustParticles[i];
        p.x += p.vx;
        p.y += p.vy;
        if (p.r < p.maxR) p.r += 0.45;
        p.alpha -= 0.016;

        if (p.alpha <= 0) {
          exhaustParticles.splice(i, 1);
          continue;
        }

        ctx.save();
        ctx.globalAlpha = Math.max(0, p.alpha);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      requestAnimationFrame(draw);
    }

    window.addEventListener("resize", resize);
    resize();
    draw();
  }

  initCosmosCanvas();
  showStartScreen("daily");
})();
