import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getDatabase } from "firebase/database";

const firebaseConfig = {
  apiKey: "REDACTED_API_KEY",
  authDomain: "smart-irrigation-system-4b76d.firebaseapp.com",
  databaseURL: "https://smart-irrigation-system-4b76d-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "smart-irrigation-system-4b76d",
  storageBucket: "smart-irrigation-system-4b76d.firebasestorage.app",
  messagingSenderId: "410863322065",
  appId: "1:410863322065:web:ba31e6831bd406804556f0",
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getDatabase(app);