// Cat 7A Destroyer — shared Firebase config
// Loaded via <script> tag in both index.html and admin.html (must load AFTER the
// firebase-app-compat.js / firebase-auth-compat.js / firebase-firestore-compat.js CDN scripts)
//
// *** IMPORTANT ***
// This is a DIFFERENT app from Core Killer, so it needs its OWN Firebase project
// (separate users/data). Create a new project in the Firebase Console, add a Web
// app to it, and paste that project's config values in below — do not reuse
// Core Killer's project or these two apps will share the same user database.

const firebaseConfig = {
  apiKey: "AIzaSyBSYu6dYel41tBx6oEQChaJZuKdNMf2d-g",
  authDomain: "cat-7a-destroyer.firebaseapp.com",
  projectId: "cat-7a-destroyer",
  storageBucket: "cat-7a-destroyer.firebasestorage.app",
  messagingSenderId: "1030734968789",
  appId: "1:1030734968789:web:e15c93f723f44f37d4ef5c"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// Enable offline persistence so the PWA keeps working with spotty signal in the field.
db.enablePersistence({ synchronizeTabs: true }).catch((err) => {
  console.warn("Firestore persistence not enabled:", err.code);
});

// ---- Username/PIN auth helpers ----
// Firebase Auth needs an email + a password of at least 6 characters, so a
// user's "username" becomes username@cat7a.local under the hood,
// and their "PIN" is really a >=6-character password.
const FAKE_EMAIL_DOMAIN = "@cat7a.local";

function usernameToEmail(username) {
  return username.trim().toLowerCase().replace(/\s+/g, "") + FAKE_EMAIL_DOMAIN;
}

async function signUp(username, pin, displayName) {
  const email = usernameToEmail(username);
  const cred = await auth.createUserWithEmailAndPassword(email, pin);
  const uid = cred.user.uid;

  const levels = {};
  for (let i = 1; i <= 30; i++) {
    levels[i] = { unlocked: i === 1, passed: false, bestScore: 0, attempts: 0, lastAttempt: null };
  }
  const masterLevels = {};
  for (let i = 1; i <= 6; i++) {
    masterLevels[i] = { unlocked: false, passed: false, bestScore: 0, attempts: 0 };
  }

  await db.collection("users").doc(uid).set({
    username: username.trim().toLowerCase(),
    displayName: displayName || username.trim(),
    role: "technician",
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    tokens: 0,
    badges: [],
    levels,
    masterLevels,
    // attemptCount drives which of the 3 source quizzes (1/2/3) the next
    // Exam Day Sim attempt serves — see buildExamSimSet() in app.js
    examSim: { certDate: null, history: [], attemptCount: 0 }
  });

  return uid;
}

async function logIn(username, pin) {
  const email = usernameToEmail(username);
  const cred = await auth.signInWithEmailAndPassword(email, pin);
  return cred.user.uid;
}

function logOut() {
  return auth.signOut();
}

function friendlyAuthError(err) {
  switch (err.code) {
    case "auth/email-already-in-use":
      return "That username is already taken.";
    case "auth/weak-password":
      return "PIN must be at least 6 characters.";
    case "auth/user-not-found":
    case "auth/wrong-password":
    case "auth/invalid-credential":
      return "Incorrect username or PIN.";
    case "auth/invalid-email":
      return "Username can only contain letters, numbers, and no spaces.";
    default:
      return "Something went wrong. Please try again.";
  }
}
