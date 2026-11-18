// MOONSHOT — Core Game Engine
(function () {
  const TOTAL_ROUNDS = 10;
  const MAX_POINTS = 500; // 10 rounds * 50 (Diamond)
  const MOON_DISTANCE_KM = 384400;
  const ROUND_SECONDS = 30;

  // Game State
  let gameMode = "daily"; // 'daily' | 'free'
  let missionQuestions = [];
  let currentRoundIdx = 0;
  let totalPoints = 0;
  let roundHistory = [];
  let timerInterval = null;
  let secondsLeft = ROUND_SECONDS;
  let roundActive = false;
  let soundEnabled = true;

  // Audio Context for synthesized space sound effects
  let audioCtx = null;

  // DOM Elements
  const skyBackdrop = document.getElementById("sky-backdrop");
  const moonVisual = document.getElementById("moon-visual");
  const altitudeKmEl = document.getElementById("altitude-km");
  const ascentProgressBar = document.getElementById("ascent-progress-bar");
  const rocketToken = document.getElementById("rocket-token");
  const altitudeZones = document.querySelectorAll(".zone-marker");
  const scoreTotalEl = document.getElementById("score-total");
  const roundNumEl = document.getElementById("round-num");
  const roundsStripEl = document.getElementById("rounds-strip");

  const playView = document.getElementById("play-view");
  const revealView = document.getElementById("reveal-view");
  const summaryView = document.getElementById("summary-view");

  const qCategoryEl = document.getElementById("q-category");
  const qAvgSearchesEl = document.getElementById("q-avg-searches");
  const timerPillEl = document.getElementById("timer-pill");
  const timerSecondsEl = document.getElementById("timer-seconds");
  const qRoundLabelEl = document.getElementById("q-round-label");
  const qPromptEl = document.getElementById("q-prompt");

  const keywordForm = document.getElementById("keyword-form");
  const keywordInput = document.getElementById("keyword-input");
  const wordCountChip = document.getElementById("word-count-chip");
  const feedbackMsgEl = document.getElementById("feedback-msg");
  const skipRoundBtn = document.getElementById("skip-round-btn");

  const revealTierBadge = document.getElementById("reveal-tier-badge");
  const revealPointsText = document.getElementById("reveal-points-text");
  const revealTagline = document.getElementById("reveal-tagline");
  const revealUserKw = document.getElementById("reveal-user-kw");
  const revealUserVol = document.getElementById("reveal-user-vol");
  const revealVolBar = document.getElementById("reveal-vol-bar");
  const revealVsAvgText = document.getElementById("reveal-vs-avg-text");
  const revealQAvg = document.getElementById("reveal-q-avg");
  const sampleTiersGrid = document.getElementById("sample-tiers-grid");
  const nextRoundBtn = document.getElementById("next-round-btn");

  const summaryRankTitle = document.getElementById("summary-rank-title");
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

  // --- Utility Functions ---
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

  // Deterministic Daily Seeded RNG
  function getDailySeed() {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
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

  // Web Audio Synthesizer for Tier Chimes
  function playSound(type) {
    if (!soundEnabled) return;
    try {
      if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (audioCtx.state === "suspended") {
        audioCtx.resume();
      }
      const now = audioCtx.currentTime;

      const notesByType = {
        DIAMOND: [523.25, 659.25, 783.99, 1046.5, 1318.5],
        PLATINUM: [440, 554.37, 659.25, 880],
        GOLD: [392, 493.88, 587.33],
        SILVER: [329.63, 440],
        BRONZE: [261.63, 329.63],
        ERROR: [160, 130]
      };

      const freqs = notesByType[type] || [300];
      freqs.forEach((f, idx) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = type === "ERROR" ? "sawtooth" : "triangle";
        osc.frequency.setValueAtTime(f, now + idx * 0.075);

        gain.gain.setValueAtTime(0.11, now + idx * 0.075);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.075 + 0.28);

        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now + idx * 0.075);
        osc.stop(now + idx * 0.075 + 0.3);
      });
    } catch (e) {
      // Ignore audio errors if blocked by autoplay policy
    }
  }

  // --- Match User Keyword Against Curated Question Bank ---
  function matchAnswer(question, rawInput) {
    const norm = normalizeText(rawInput);
    if (!norm) return null;

    // Candidate normalized variations (singular/plural + optional leading "the "/"mount ")
    const candidates = new Set([norm]);
    if (norm.endsWith("ies") && norm.length > 4) {
      candidates.add(norm.slice(0, -3) + "y");
    }
    if (norm.endsWith("es") && norm.length > 3) {
      candidates.add(norm.slice(0, -2));
    }
    if (norm.endsWith("s") && norm.length > 2) {
      candidates.add(norm.slice(0, -1));
    } else {
      candidates.add(norm + "s");
    }
    if (norm.startsWith("the ")) {
      candidates.add(norm.slice(4));
    }

    for (const entry of question.answers) {
      const entryNorm = normalizeText(entry.k);
      if (candidates.has(entryNorm)) {
        return entry;
      }
    }
    return null;
  }

  // --- Sky & Altitude Visuals ---
  function updateAltitudeVisuals() {
    const ratio = Math.min(1, Math.max(0, totalPoints / MAX_POINTS));
    const currentKm = Math.round(ratio * MOON_DISTANCE_KM);

    altitudeKmEl.textContent = `${formatNumber(currentKm)} km`;
    scoreTotalEl.textContent = String(totalPoints);

    // Rocket progress bar (4% base to 92% top)
    const pct = Math.round(ratio * 100);
    ascentProgressBar.style.height = `${pct}%`;
    rocketToken.style.bottom = `${4 + ratio * 86}%`;

    // Highlight active altitude zone
    let activeMarked = false;
    altitudeZones.forEach((z) => {
      const minPts = Number(z.getAttribute("data-min"));
      if (!activeMarked && totalPoints >= minPts) {
        z.classList.add("active-zone");
        activeMarked = true;
      } else {
        z.classList.remove("active-zone");
      }
    });

    // Dynamic Sky Gradient based on altitude
    if (totalPoints < 100) {
      // Launchpad / Troposphere (Sky Blue to Warm Horizon)
      skyBackdrop.style.background =
        "linear-gradient(180deg, #0c2d6b 0%, #1d4ed8 55%, #38bdf8 100%)";
    } else if (totalPoints < 200) {
      // Stratosphere (Deep Cobalt to Indigo)
      skyBackdrop.style.background =
        "linear-gradient(180deg, #071330 0%, #1e1b4b 55%, #1d4ed8 100%)";
    } else if (totalPoints < 300) {
      // Karman Line (Aurora Night)
      skyBackdrop.style.background =
        "linear-gradient(180deg, #030712 0%, #0f172a 55%, #065f46 100%)";
    } else if (totalPoints < 450) {
      // Deep Space / Cis-Lunar
      skyBackdrop.style.background =
        "linear-gradient(180deg, #010409 0%, #090d1e 60%, #1e1b4b 100%)";
    } else {
      // Lunar Orbit / Moon Landing
      skyBackdrop.style.background =
        "linear-gradient(180deg, #000000 0%, #090d16 55%, #334155 100%)";
    }

    // Scale Moon as player approaches 500 pts
    const moonScale = 0.85 + ratio * 0.95;
    moonVisual.style.transform = `scale(${moonScale.toFixed(2)})`;
  }

  function renderRoundPips() {
    roundsStripEl.innerHTML = "";
    for (let i = 0; i < TOTAL_ROUNDS; i++) {
      const pip = document.createElement("div");
      pip.className = "round-pip";
      if (i < roundHistory.length) {
        const tierId = roundHistory[i].tierId || "MISS";
        pip.classList.add(`done-${tierId}`);
      } else if (i === currentRoundIdx) {
        pip.classList.add("current");
      }
      roundsStripEl.appendChild(pip);
    }
  }

  // --- Start / Reset Game ---
  function startMission(mode) {
    gameMode = mode || gameMode;
    btnModeDaily.classList.toggle("active", gameMode === "daily");
    btnModeFree.classList.toggle("active", gameMode === "free");

    if (gameMode === "daily") {
      const seed = getDailySeed();
      missionQuestions = seededShuffle(window.QUESTION_BANK, seed).slice(0, TOTAL_ROUNDS);
    } else {
      const randSeed = String(Date.now() + Math.random());
      missionQuestions = seededShuffle(window.QUESTION_BANK, randSeed).slice(0, TOTAL_ROUNDS);
    }

    currentRoundIdx = 0;
    totalPoints = 0;
    roundHistory = [];

    summaryView.classList.add("hidden");
    revealView.classList.add("hidden");
    playView.classList.remove("hidden");

    updateAltitudeVisuals();
    loadCurrentRound();
  }

  function loadCurrentRound() {
    const q = missionQuestions[currentRoundIdx];
    roundActive = true;

    roundNumEl.textContent = String(currentRoundIdx + 1);
    qRoundLabelEl.textContent = `ROUND ${currentRoundIdx + 1} OF ${TOTAL_ROUNDS}`;
    qCategoryEl.textContent = q.category;
    qAvgSearchesEl.textContent = `${formatNumber(q.avgSearches)} / mo`;
    qPromptEl.textContent = q.prompt;

    keywordInput.value = "";
    feedbackMsgEl.textContent = "";
    updateWordCountChip();

    revealView.classList.add("hidden");
    summaryView.classList.add("hidden");
    playView.classList.remove("hidden");

    renderRoundPips();
    startTimer();
    setTimeout(() => keywordInput.focus(), 50);
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
        if (roundActive) {
          handleRoundComplete(null, true);
        }
      }
    }, 1000);
  }

  function updateTimerUI() {
    timerSecondsEl.textContent = `${secondsLeft}s`;
    timerPillEl.classList.toggle("urgent", secondsLeft <= 8);
  }

  function updateWordCountChip() {
    const words = getWords(keywordInput.value);
    const count = words.length;
    wordCountChip.textContent = `${count}/2 words`;
    wordCountChip.classList.remove("valid", "invalid");
    if (count === 1 || count === 2) {
      wordCountChip.classList.add("valid");
    } else if (count > 2) {
      wordCountChip.classList.add("invalid");
    }
  }

  // --- Handle Keyword Submission ---
  keywordInput.addEventListener("input", () => {
    updateWordCountChip();
    if (feedbackMsgEl.textContent) {
      feedbackMsgEl.textContent = "";
    }
  });

  keywordForm.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!roundActive) return;

    const raw = keywordInput.value.trim();
    const words = getWords(raw);

    if (words.length === 0) {
      triggerInputError("Please enter a 1 or 2 word keyword!");
      return;
    }

    if (words.length > 2) {
      triggerInputError("Keywords must be 1 or 2 words max!");
      playSound("ERROR");
      return;
    }

    const currentQ = missionQuestions[currentRoundIdx];
    const matched = matchAnswer(currentQ, raw);

    if (!matched) {
      triggerInputError(`"${raw}" isn't in our verified dataset for this prompt — try another 1-2 word keyword!`);
      playSound("ERROR");
      return;
    }

    handleRoundComplete(matched, false);
  });

  function triggerInputError(msg) {
    feedbackMsgEl.textContent = msg;
    keywordInput.classList.remove("input-error");
    void keywordInput.offsetWidth; // reflow
    keywordInput.classList.add("input-error");
  }

  skipRoundBtn.addEventListener("click", () => {
    if (!roundActive) return;
    handleRoundComplete(null, false);
  });

  // --- Post-Round Telemetry Breakdown ---
  function handleRoundComplete(matchedEntry, timedOut) {
    roundActive = false;
    clearInterval(timerInterval);

    const currentQ = missionQuestions[currentRoundIdx];
    let earnedPts = 0;
    let tierId = "MISS";

    if (matchedEntry) {
      tierId = matchedEntry.t;
      const tierCfg = window.TIER_CONFIG[tierId];
      earnedPts = tierCfg.points;
      totalPoints += earnedPts;
      playSound(tierId);

      revealTierBadge.style.background = tierCfg.badgeBg;
      revealTierBadge.textContent = `${tierCfg.icon} ${tierCfg.name.toUpperCase()} TIER`;
      revealPointsText.textContent = `+${earnedPts} PTS`;
      revealPointsText.style.color = tierCfg.color;
      revealTagline.textContent = tierCfg.tagline;

      revealUserKw.textContent = matchedEntry.k.toUpperCase();
      revealUserVol.textContent = `${formatNumber(matchedEntry.v)} searches / mo`;

      const pctOfAvg = (matchedEntry.v / currentQ.avgSearches) * 100;
      const barWidth = Math.min(100, Math.max(4, (matchedEntry.v / (currentQ.avgSearches * 2)) * 100));
      revealVolBar.style.width = `${barWidth}%`;
      revealVolBar.style.background = tierCfg.color;

      if (matchedEntry.v < currentQ.avgSearches) {
        const lessPct = (100 - pctOfAvg).toFixed(1);
        revealVsAvgText.textContent = `🔥 Searched ${lessPct}% LESS than this question's monthly average!`;
      } else {
        const morePct = (pctOfAvg - 100).toFixed(0);
        revealVsAvgText.textContent = `Searched ${morePct}% MORE than this question's monthly average.`;
      }
    } else {
      playSound("ERROR");
      revealTierBadge.style.background = "linear-gradient(135deg, #be123c, #f43f5e)";
      revealTierBadge.style.color = "#fff";
      revealTierBadge.textContent = timedOut ? "⏱️ TIME EXPIRED" : "⏭️ STAGE SKIPPED";
      revealPointsText.textContent = "+0 PTS";
      revealPointsText.style.color = "#f43f5e";
      revealTagline.textContent = "No valid keyword locked before stage cutoff.";
      revealUserKw.textContent = "—";
      revealUserVol.textContent = "0 searches / mo";
      revealVolBar.style.width = "0%";
      revealVsAvgText.textContent = "Try a rare 1–2 word keyword next round!";
    }

    revealQAvg.textContent = `${formatNumber(currentQ.avgSearches)} / mo`;

    roundHistory.push({
      round: currentRoundIdx + 1,
      prompt: currentQ.prompt,
      keyword: matchedEntry ? matchedEntry.k : "—",
      searches: matchedEntry ? matchedEntry.v : 0,
      avgSearches: currentQ.avgSearches,
      tierId,
      points: earnedPts
    });

    updateAltitudeVisuals();
    renderRoundPips();
    renderSampleTiers(currentQ);

    if (currentRoundIdx + 1 < TOTAL_ROUNDS) {
      nextRoundBtn.textContent = `Next Stage (Round ${currentRoundIdx + 2} of ${TOTAL_ROUNDS}) →`;
    } else {
      nextRoundBtn.textContent = "View Final Lunar Flight Log 🌕 →";
    }

    playView.classList.add("hidden");
    revealView.classList.remove("hidden");
  }

  function renderSampleTiers(question) {
    const order = ["DIAMOND", "PLATINUM", "GOLD", "SILVER", "BRONZE"];
    sampleTiersGrid.innerHTML = "";

    order.forEach((tKey) => {
      const cfg = window.TIER_CONFIG[tKey];
      const matches = question.answers.filter((a) => a.t === tKey).slice(0, 3);

      const col = document.createElement("div");
      col.className = "sample-tier-col";
      col.innerHTML = `
        <div class="sample-tier-head" style="color:${cfg.color};">
          <span>${cfg.icon} ${cfg.name}</span>
          <span>${cfg.points}p</span>
        </div>
        ${matches
          .map(
            (m) => `
          <div class="sample-kw-item">
            <strong style="text-transform:capitalize;">${m.k}</strong>
            <span class="sample-kw-vol">${formatNumber(m.v)} / mo</span>
          </div>
        `
          )
          .join("")}
      `;
      sampleTiersGrid.appendChild(col);
    });
  }

  nextRoundBtn.addEventListener("click", () => {
    currentRoundIdx++;
    if (currentRoundIdx < TOTAL_ROUNDS) {
      loadCurrentRound();
    } else {
      showMissionSummary();
    }
  });

  // --- Final 10-Round Summary ---
  function getRankTitle(pts) {
    if (pts >= 480) return "🌕 APOLLO MOONWALKER (ONE IN A MOONSHOT!)";
    if (pts >= 400) return "🛰️ LUNAR ORBIT COMMANDER";
    if (pts >= 300) return "🌌 DEEP SPACE NAVIGATOR";
    if (pts >= 200) return "✨ KÁRMÁN LINE PIONEER";
    if (pts >= 100) return "🎈 STRATOSPHERE CAPTAIN";
    return "☁️ TROPOSPHERE CADET";
  }

  function showMissionSummary() {
    revealView.classList.add("hidden");
    playView.classList.add("hidden");
    summaryView.classList.remove("hidden");

    const km = Math.round((totalPoints / MAX_POINTS) * MOON_DISTANCE_KM);
    summaryRankTitle.textContent = getRankTitle(totalPoints);
    summaryAltitudeSub.textContent = `Final Altitude: ${formatNumber(km)} km (${totalPoints} / ${MAX_POINTS} points)`;

    summaryTableBody.innerHTML = roundHistory
      .map((item) => {
        const cfg = window.TIER_CONFIG[item.tierId];
        const badgeHtml = cfg
          ? `<span style="color:${cfg.color};font-weight:700;">${cfg.icon} ${cfg.name}</span>`
          : `<span style="color:#f43f5e;">Missed</span>`;
        return `
          <tr>
            <td>${item.round}</td>
            <td>${item.prompt}</td>
            <td style="text-transform:capitalize;font-weight:700;">${item.keyword}</td>
            <td style="font-family:var(--font-mono);">${item.searches ? formatNumber(item.searches) + " / mo" : "—"}</td>
            <td>${badgeHtml}</td>
            <td style="font-family:var(--font-mono);font-weight:800;">+${item.points}</td>
          </tr>
        `;
      })
      .join("");
  }

  btnShareScore.addEventListener("click", () => {
    const km = Math.round((totalPoints / MAX_POINTS) * MOON_DISTANCE_KM);
    const emojiRow = roundHistory
      .map((r) => (window.TIER_CONFIG[r.tierId] ? window.TIER_CONFIG[r.tierId].icon : "⬛"))
      .join("");
    const text = `🚀 MOONSHOT (${gameMode === "daily" ? "Daily " + getDailySeed() : "Free Play"})\nAltitude: ${formatNumber(km)} km | Score: ${totalPoints}/500 pts\n${emojiRow}`;

    navigator.clipboard.writeText(text).then(() => {
      btnShareScore.textContent = "✅ Telemetry Copied!";
      setTimeout(() => {
        btnShareScore.textContent = "📋 Copy Mission Telemetry";
      }, 2200);
    });
  });

  btnPlayAgain.addEventListener("click", () => {
    startMission("free");
  });

  // --- Top Nav Controls ---
  btnModeDaily.addEventListener("click", () => startMission("daily"));
  btnModeFree.addEventListener("click", () => startMission("free"));

  btnHowToPlay.addEventListener("click", () => {
    rulesModal.classList.remove("hidden");
  });
  closeRulesBtn.addEventListener("click", () => {
    rulesModal.classList.add("hidden");
  });
  rulesModal.addEventListener("click", (e) => {
    if (e.target === rulesModal) rulesModal.classList.add("hidden");
  });

  btnSoundToggle.addEventListener("click", () => {
    soundEnabled = !soundEnabled;
    btnSoundToggle.textContent = soundEnabled ? "🔊 Sound: ON" : "🔇 Sound: OFF";
  });

  // --- Animated Starfield Canvas ---
  function initStarfield() {
    const canvas = document.getElementById("starfield-canvas");
    const ctx = canvas.getContext("2d");
    let stars = [];

    function resize() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      stars = Array.from({ length: 130 }, () => ({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        r: Math.random() * 1.6 + 0.4,
        alpha: Math.random() * 0.8 + 0.2,
        speed: Math.random() * 0.35 + 0.08
      }));
    }

    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const speedMult = 1 + (totalPoints / MAX_POINTS) * 3.5;
      for (const s of stars) {
        s.y += s.speed * speedMult;
        if (s.y > canvas.height) {
          s.y = 0;
          s.x = Math.random() * canvas.width;
        }
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(248, 250, 252, ${s.alpha})`;
        ctx.fill();
      }
      requestAnimationFrame(draw);
    }

    window.addEventListener("resize", resize);
    resize();
    draw();
  }

  // Initialize
  initStarfield();
  startMission("daily");
})();
