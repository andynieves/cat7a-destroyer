// ===== Cat 7A Destroyer — app logic =====
// Same engine/UX as Core Killer. Changes from that version:
//  - 30 Core Levels (5Q each) / 6 Master Levels (25Q each), not 25/5
//  - Exam Day Sim now serves one full unmixed 50Q source quiz per attempt,
//    cycling 1->2->3->1... via examSim.attemptCount (mod 3), instead of a
//    randomized label/general draw from one big pool
//  - Token reveal on the results screen is now actually wired up (it existed
//    in the old HTML but was never triggered) and made more prize-like

// ---- Register service worker for offline support ----
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW registration failed:', err));
  });
}

// ---- iOS "Add to Home Screen" onboarding overlay ----
function isIos() {
  return /iphone|ipad|ipod/.test(window.navigator.userAgent.toLowerCase());
}
function isInStandaloneMode() {
  return ('standalone' in window.navigator) && window.navigator.standalone;
}
function maybeShowIosInstallPrompt() {
  if (!isIos() || isInStandaloneMode()) return;
  if (localStorage.getItem('cat7aInstallPromptDismissed')) return;

  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;left:16px;right:16px;bottom:16px;background:#354C61;border:1px solid #E7B44A;border-radius:12px;padding:16px;z-index:100;color:#FFFFFF;font-size:14px;line-height:1.5;box-shadow:0 4px 16px rgba(0,0,0,.3);';
  overlay.innerHTML = `
    <div style="font-weight:700;margin-bottom:6px;">Install Cat 7A Destroyer</div>
    <div style="color:#92A3B5;margin-bottom:12px;">Tap the Share icon <span style="display:inline-block">⬆️</span> below, then "Add to Home Screen" for one-tap access and offline use.</div>
    <button id="ios-install-dismiss" style="background:#E7B44A;color:#1D364B;border:none;border-radius:8px;padding:10px 16px;font-weight:700;width:100%;">Got it</button>
  `;
  document.body.appendChild(overlay);
  document.getElementById('ios-install-dismiss').addEventListener('click', () => {
    localStorage.setItem('cat7aInstallPromptDismissed', '1');
    overlay.remove();
  });
}
setTimeout(maybeShowIosInstallPrompt, 1500);

const TOTAL_LEVELS = 30;
const TOTAL_MASTER_LEVELS = 6;
const LEVELS_PER_BLOCK = 5;

let currentUser = null; // { uid, ...firestore doc data }
let quizState = null;   // { type, id, questions, index, score, answers }

const $ = (id) => document.getElementById(id);
function show(screenId) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $(screenId).classList.add('active');
}

// ---------------- AUTH ----------------
let authMode = 'login'; // 'login' | 'signup'

function renderAuthToggle() {
  $('auth-toggle').innerHTML = authMode === 'login'
    ? 'New here? <a href="#" id="auth-toggle-link">Create an account</a>'
    : 'Already have an account? <a href="#" id="auth-toggle-link">Log in</a>';
  $('auth-toggle-link').addEventListener('click', (e) => {
    e.preventDefault();
    authMode = authMode === 'login' ? 'signup' : 'login';
    updateAuthScreen();
  });
}
function updateAuthScreen() {
  $('auth-title').textContent = authMode === 'login' ? 'Cat 7A Destroyer' : 'Create Your Account';
  $('auth-sub').textContent = authMode === 'login' ? 'Log in to continue your training' : 'Pick a username and a 6-digit PIN';
  $('auth-submit').textContent = authMode === 'login' ? 'Log In' : 'Create Account';
  $('auth-displayname').style.display = authMode === 'signup' ? 'block' : 'none';
  $('auth-error').textContent = '';
  renderAuthToggle();
}
renderAuthToggle();

$('auth-submit').addEventListener('click', async () => {
  const username = $('auth-username').value.trim();
  const pin = $('auth-pin').value.trim();
  const displayName = $('auth-displayname').value.trim();
  $('auth-error').textContent = '';

  if (!username || !/^[a-zA-Z0-9]+$/.test(username)) {
    $('auth-error').textContent = 'Username can only contain letters and numbers.';
    return;
  }
  if (!/^\d{6}$/.test(pin)) {
    $('auth-error').textContent = 'PIN must be exactly 6 digits.';
    return;
  }

  $('auth-submit').disabled = true;
  try {
    if (authMode === 'signup') {
      await signUp(username, pin, displayName);
    } else {
      await logIn(username, pin);
    }
    // onAuthStateChanged below will pick up the session and load the dashboard
  } catch (err) {
    $('auth-error').textContent = friendlyAuthError(err);
  } finally {
    $('auth-submit').disabled = false;
  }
});

$('logout-btn').addEventListener('click', () => {
  logOut();
});

auth.onAuthStateChanged(async (user) => {
  if (user) {
    try {
      const doc = await db.collection('users').doc(user.uid).get();
      if (doc.exists) {
        currentUser = { uid: user.uid, ...doc.data() };
        renderDashboard();
        show('screen-dashboard');
      } else {
        $('auth-error').textContent = 'Account found, but no profile data exists yet. Try creating your account again.';
        show('screen-auth');
      }
    } catch (err) {
      console.error('Failed to load profile:', err);
      $('auth-error').textContent = 'Could not load your profile (' + err.code + '). This usually means the Firestore security rules haven\'t been published yet.';
      show('screen-auth');
    }
  } else {
    currentUser = null;
    show('screen-auth');
  }
});

// ---------------- DASHBOARD ----------------
function levelStatus(lvlNum) {
  const L = currentUser.levels[lvlNum];
  if (!L) return 'locked';
  if (L.passed) return 'passed';
  if (L.unlocked) return 'unlocked';
  return 'locked';
}

function renderDashboard() {
  $('token-count').textContent = currentUser.tokens || 0;
  const container = $('dash-content');
  container.innerHTML = '';

  for (let block = 0; block < TOTAL_MASTER_LEVELS; block++) {
    const blockLabel = document.createElement('div');
    blockLabel.className = 'block-label';
    blockLabel.textContent = 'Levels ' + (block * LEVELS_PER_BLOCK + 1) + '–' + (block * LEVELS_PER_BLOCK + LEVELS_PER_BLOCK);
    container.appendChild(blockLabel);

    const grid = document.createElement('div');
    grid.className = 'level-grid';
    for (let i = 1; i <= LEVELS_PER_BLOCK; i++) {
      const lvlNum = block * LEVELS_PER_BLOCK + i;
      const status = levelStatus(lvlNum);
      const tile = document.createElement('div');
      tile.className = 'tile ' + status;
      tile.innerHTML = `<span class="num">${lvlNum}</span>${status === 'passed' ? '<span class="badge">✓</span>' : ''}${status === 'locked' ? '<span class="badge">🔒</span>' : ''}`;
      if (status !== 'locked') {
        tile.addEventListener('click', () => startQuiz('core', lvlNum));
      } else {
        tile.addEventListener('click', () => alert('Finish Level ' + (lvlNum - 1) + ' first (80% or higher) to unlock this one.'));
      }
      grid.appendChild(tile);
    }
    container.appendChild(grid);

    // Master level for this block
    const masterNum = block + 1;
    const M = currentUser.masterLevels[masterNum];
    const mTile = document.createElement('div');
    mTile.className = 'master-tile' + (M.unlocked ? '' : ' locked');
    mTile.innerHTML = `
      <div>
        <div class="mtitle">🏆 Master Level ${masterNum}</div>
        <div class="msub">${M.passed ? 'Passed — Best: ' + M.bestScore + '%' : (M.unlocked ? '25 questions · 80% to pass' : 'Unlocks after Levels ' + (block * LEVELS_PER_BLOCK + 1) + '–' + (block * LEVELS_PER_BLOCK + LEVELS_PER_BLOCK))}</div>
      </div>
      <div style="font-size:20px;">${M.passed ? '⭐' : (M.unlocked ? '▶' : '🔒')}</div>
    `;
    if (M.unlocked) mTile.addEventListener('click', () => startQuiz('master', masterNum));
    container.appendChild(mTile);
  }

  const examLabel = document.createElement('div');
  examLabel.className = 'block-label';
  examLabel.textContent = 'Certification Practice';
  container.appendChild(examLabel);

  const examTile = document.createElement('div');
  examTile.className = 'exam-tile';
  const hasCert = currentUser.examSim && currentUser.examSim.certDate;
  examTile.innerHTML = `
    <div>
      <div class="etitle">📝 Exam Day Sim</div>
      <div class="esub">${hasCert ? 'Certified — retake anytime' : '50 questions · 90 min · 80% to pass'}</div>
    </div>
    <div style="font-size:20px;">▶</div>
  `;
  examTile.addEventListener('click', () => startQuiz('examSim', null));
  container.appendChild(examTile);
}

// ---------------- QUIZ ENGINE ----------------
function shuffleArray(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Exam Day Sim: each attempt is one FULL, unmixed 50-question source quiz.
// Attempts cycle through the 3 source quizzes in order (1 -> 2 -> 3 -> 1 ...)
// using examSim.attemptCount (advanced once per completed attempt, in finishQuiz).
function buildExamSimSet() {
  const attemptCount = (currentUser.examSim && currentUser.examSim.attemptCount) || 0;
  const setIndex = attemptCount % EXAM_SETS.length; // EXAM_SETS.length === 3
  return EXAM_SETS[setIndex].slice(); // full 50Q set, unmixed with the other two
}

function startQuiz(type, id) {
  let questions;
  if (type === 'core') questions = LEVELS[id - 1].questions;
  else if (type === 'master') questions = MASTER_LEVELS[id - 1].questions;
  else questions = buildExamSimSet();

  // shuffle question order, and shuffle each question's options while tracking the correct one
  const prepped = shuffleArray(questions).map(q => {
    const correctText = q.options[q.correct];
    const shuffledOpts = shuffleArray(q.options);
    return { ...q, options: shuffledOpts, correctIndex: shuffledOpts.indexOf(correctText) };
  });

  quizState = {
    type, id, questions: prepped, index: 0, score: 0, answers: [],
    startTime: Date.now(),
    timeLimitMs: type === 'examSim' ? 90 * 60 * 1000 : null
  };
  show('screen-quiz');
  renderQuestion();
}

function renderQuestion() {
  const { questions, index, score } = quizState;
  const q = questions[index];
  $('progress-fill').style.width = Math.round((index / questions.length) * 100) + '%';
  $('quiz-score-pill').textContent = score + ' / ' + questions.length;
  $('q-text').textContent = q.q;
  $('q-feedback').className = 'feedback';
  $('q-feedback').textContent = '';
  $('next-btn').style.display = 'none';

  const optsContainer = $('q-options');
  optsContainer.innerHTML = '';
  q.options.forEach((opt, i) => {
    const btn = document.createElement('button');
    btn.className = 'opt';
    btn.textContent = opt;
    btn.addEventListener('click', () => selectAnswer(i));
    optsContainer.appendChild(btn);
  });
}

function selectAnswer(i) {
  const { questions, index } = quizState;
  const q = questions[index];
  const opts = document.querySelectorAll('#q-options .opt');
  opts.forEach(o => o.classList.add('disabled'));

  const isCorrect = i === q.correctIndex;
  if (isCorrect) quizState.score++;
  quizState.answers.push({ questionId: q.id, correct: isCorrect });

  opts[i].classList.add(isCorrect ? 'correct' : 'incorrect');
  if (!isCorrect) opts[q.correctIndex].classList.add('correct');

  const fb = $('q-feedback');
  fb.classList.add('show', isCorrect ? 'correct-fb' : 'incorrect-fb');
  fb.textContent = isCorrect ? "Correct!" : "Not quite — that's okay, keep going.";

  $('next-btn').style.display = 'block';
  $('next-btn').textContent = (index === questions.length - 1) ? 'See Results' : 'Next';
}

$('next-btn').addEventListener('click', () => {
  quizState.index++;
  if (quizState.index >= quizState.questions.length) {
    finishQuiz();
  } else {
    renderQuestion();
  }
});

// ---- Exit modal ----
$('quiz-exit-btn').addEventListener('click', () => $('exit-modal').classList.add('show'));
$('exit-cancel-btn').addEventListener('click', () => $('exit-modal').classList.remove('show'));
$('exit-confirm-btn').addEventListener('click', () => {
  $('exit-modal').classList.remove('show');
  quizState = null;
  show('screen-dashboard');
});

// ---- Finish + save ----
async function finishQuiz() {
  const { type, id, questions, score } = quizState;
  const pct = Math.round((score / questions.length) * 100);
  const passed = pct >= 80;
  const uid = currentUser.uid;
  const userRef = db.collection('users').doc(uid);

  let unlockedNextLevel = null;
  let unlockedMaster = null;
  let earnedToken = false;
  let earnedBadge = null;

  if (type === 'core') {
    const prev = currentUser.levels[id];
    const wasFirstTry = prev.attempts === 0;
    const alreadyPassed = prev.passed;
    const newBest = Math.max(prev.bestScore, pct);
    currentUser.levels[id] = {
      unlocked: true, passed: prev.passed || passed,
      bestScore: newBest, attempts: prev.attempts + 1,
      lastAttempt: new Date().toISOString()
    };
    if (passed) {
      if (!alreadyPassed) earnedToken = true;
      if (id < TOTAL_LEVELS && !currentUser.levels[id + 1].unlocked) {
        currentUser.levels[id + 1].unlocked = true;
        unlockedNextLevel = id + 1;
      }
      // check if this completes a block of 5 -> unlock master level
      const blockIdx = Math.floor((id - 1) / LEVELS_PER_BLOCK); // 0..5
      const blockStart = blockIdx * LEVELS_PER_BLOCK + 1, blockEnd = blockIdx * LEVELS_PER_BLOCK + LEVELS_PER_BLOCK;
      let blockComplete = true;
      for (let n = blockStart; n <= blockEnd; n++) {
        if (!currentUser.levels[n].passed) { blockComplete = false; break; }
      }
      const masterNum = blockIdx + 1;
      if (blockComplete && !currentUser.masterLevels[masterNum].unlocked) {
        currentUser.masterLevels[masterNum].unlocked = true;
        unlockedMaster = masterNum;
      }
      if (wasFirstTry && passed) earnedBadge = 'Level ' + id + ' — First Try!';
    }
    if (earnedToken) currentUser.tokens = (currentUser.tokens || 0) + 1;
    await userRef.update({
      ['levels.' + id]: currentUser.levels[id],
      ...(unlockedNextLevel ? { ['levels.' + unlockedNextLevel]: currentUser.levels[unlockedNextLevel] } : {}),
      ...(unlockedMaster ? { ['masterLevels.' + unlockedMaster]: currentUser.masterLevels[unlockedMaster] } : {}),
      tokens: currentUser.tokens
    });
  } else if (type === 'master') {
    const prev = currentUser.masterLevels[id];
    const alreadyPassed = prev.passed;
    const newBest = Math.max(prev.bestScore, pct);
    currentUser.masterLevels[id] = {
      unlocked: true, passed: prev.passed || passed,
      bestScore: newBest, attempts: prev.attempts + 1
    };
    if (passed && !alreadyPassed) {
      earnedBadge = 'Master Level ' + id + ' Badge';
      earnedToken = true; // master levels are a bigger deal — token + badge together
      currentUser.badges = [...(currentUser.badges || []), earnedBadge];
    }
    if (earnedToken) currentUser.tokens = (currentUser.tokens || 0) + 1;
    await userRef.update({
      ['masterLevels.' + id]: currentUser.masterLevels[id],
      badges: currentUser.badges,
      tokens: currentUser.tokens
    });
  } else {
    // examSim
    const prevAttemptCount = (currentUser.examSim && currentUser.examSim.attemptCount) || 0;
    const entry = { date: new Date().toISOString(), score: pct, passed };
    let history = [...(currentUser.examSim.history || []), entry].slice(-10);
    let certDate = currentUser.examSim.certDate;
    if (passed) {
      certDate = new Date().toISOString();
      earnedToken = true; // passing a full certification practice run earns a token too
    }
    currentUser.examSim = { certDate, history, attemptCount: prevAttemptCount + 1 };
    if (earnedToken) currentUser.tokens = (currentUser.tokens || 0) + 1;
    await userRef.update({ examSim: currentUser.examSim, tokens: currentUser.tokens });
  }

  renderResults(pct, passed, type, id, { unlockedNextLevel, unlockedMaster, earnedBadge, earnedToken });
}

function renderResults(pct, passed, type, id, extras) {
  $('result-emoji').textContent = passed ? (pct === 100 ? '🌟' : '🎉') : (pct >= 60 ? '💪' : '🔄');
  $('result-score').textContent = pct + '%';

  let msg = '';
  if (passed) {
    msg = "Nice work — you passed!";
    if (extras.unlockedNextLevel) msg += ` Level ${extras.unlockedNextLevel} is now unlocked.`;
    if (extras.unlockedMaster) msg += ` You've also unlocked Master Level ${extras.unlockedMaster}!`;
    if (extras.earnedBadge) msg += ` You earned: ${extras.earnedBadge}.`;
    if (type === 'examSim') msg = "You passed the Exam Day Sim! Your \"On Our Way to the Real Thing\" certificate has been updated.";
  } else if (pct >= 60) {
    msg = "So close! Give it another look and try again — you're almost there.";
  } else {
    msg = "Let's take another pass at this material. Review the questions you missed and try again when you're ready.";
  }
  $('result-msg').textContent = msg;

  // ---- Token prize reveal ----
  const tokenReveal = $('token-reveal');
  if (extras.earnedToken) {
    let label = '+1 Token Earned!';
    if (type === 'master') label = '+1 Token + Badge Earned!';
    if (type === 'examSim') label = '+1 Certification Token!';
    $('token-reveal-label').textContent = label;

    tokenReveal.style.display = 'flex';
    // Force the pop/glow animation to replay even if the results screen was
    // just shown a moment ago (removing then re-adding the class restarts it).
    tokenReveal.classList.remove('pop');
    void tokenReveal.offsetWidth; // reflow to reset the animation
    tokenReveal.classList.add('pop');
  } else {
    tokenReveal.style.display = 'none';
    tokenReveal.classList.remove('pop');
  }

  const primaryBtn = $('result-primary-btn');
  if (passed && type === 'core' && extras.unlockedNextLevel) {
    primaryBtn.textContent = 'Continue to Level ' + extras.unlockedNextLevel;
    primaryBtn.style.display = 'block';
    primaryBtn.onclick = () => startQuiz('core', extras.unlockedNextLevel);
  } else {
    primaryBtn.style.display = 'none';
  }

  $('result-retake-btn').onclick = () => startQuiz(type, id);
  $('result-dash-btn').onclick = () => { renderDashboard(); show('screen-dashboard'); };

  show('screen-results');
}
