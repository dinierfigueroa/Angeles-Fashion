import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyCzPFgeHJHjg8xJeQDQwDJyZZh9N4NHUmw",
  authDomain: "angelesfashion-3dba9437af.firebaseapp.com",
  projectId: "angelesfashion-3dba9437af",
  storageBucket: "angelesfashion-3dba9437af.appspot.com",
  messagingSenderId: "41948470321",
  appId: "1:41948470321:web:fbf2b878fe54acaba08910",
  measurementId: "G-NXT3WF0CK4"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

// Exportamos todo, incluyendo la configuración
export { app, auth, db, storage, firebaseConfig };