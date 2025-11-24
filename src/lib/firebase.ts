// src/lib/firebase.ts
import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// Thay thế bằng config từ Firebase Console của bạn
const firebaseConfig = {
  apiKey: "AIzaSyDuqHFq7eMSjb0bGeiZMiYbZbhUOVtCqbE",
  authDomain: "inventory-phucvinh-bakery.firebaseapp.com",
  projectId: "inventory-phucvinh-bakery",
  storageBucket: "inventory-phucvinh-bakery.firebasestorage.app",
  messagingSenderId: "943032232724",
  appId: "1:943032232724:web:238d1dbf1c5071a7e93001"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Export các service để dùng trong app
export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();