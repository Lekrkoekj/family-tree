import { initializeApp } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js";
import { getFirestore, doc, getDoc }
    from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyDmg2aj7M7kY0kr30B6CEJUWHd0Zaj6-7E",
    authDomain: "keim-family-tree.firebaseapp.com",
    projectId: "keim-family-tree",
    storageBucket: "keim-family-tree.firebasestorage.app",
    messagingSenderId: "797265255257",
    appId: "1:797265255257:web:2e8bbc3a9e54c2e6f20a48",
    measurementId: "G-L0MQPEQ6S2"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// Returns the user's document data, or null if they have no document yet
export async function getUserData(user) {
    const snap = await getDoc(doc(db, "users", user.email.toLowerCase()));
    return snap.exists() ? snap.data() : null;
}

export async function getRole(user) {
    const data = await getUserData(user);
    return data ? data.role : null;
}