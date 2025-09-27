import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { getAuth, onAuthStateChanged, signOut } from 'firebase/auth'
import { getFirestore, doc, getDoc } from 'firebase/firestore'

export const useAuthStore = defineStore('auth', () => {
  const user = ref(null);
  const authInitialized = ref(false);

  let resolveAuthPromise;
  const authPromise = new Promise(resolve => {
    resolveAuthPromise = resolve;
  });

  const init = () => {
    const auth = getAuth();
    const db = getFirestore();

    onAuthStateChanged(auth, async (firebaseUser) => {
      try {
        if (firebaseUser && firebaseUser.uid) {
          const userDocRef = doc(db, "users", firebaseUser.uid);
          const userDocSnap = await getDoc(userDocRef);

          if (userDocSnap.exists() && userDocSnap.data().isActive) {
            let userData = userDocSnap.data();
            
            if (userData.roleId) {
              try {
                const roleDocSnap = await getDoc(userData.roleId);
                if (roleDocSnap.exists()) {
                  const roleData = roleDocSnap.data();
                  userData.roleName = roleData.displayName;
                  userData.permissions = roleData.permissions || {};
                }
              } catch (e) { console.error("Error al cargar el rol:", e); }
            }
            if (!userData.permissions) userData.permissions = {};
            
            if(userData.storeId) {
              try {
                const storeDocSnap = await getDoc(userData.storeId);
                if(storeDocSnap.exists()) userData.storeName = storeDocSnap.data().name;
              } catch (e) { console.warn("No se pudo cargar la tienda:", e) }
            }
            user.value = { uid: firebaseUser.uid, email: firebaseUser.email, ...userData };
          } else {
            await signOut(auth);
            user.value = null;
          }
        } else {
          user.value = null;
        }
      } catch (error) {
        console.error("Error en el listener de autenticación:", error);
        user.value = null;
      } finally {
        authInitialized.value = true;
        if(resolveAuthPromise) resolveAuthPromise();
      }
    });
  }
  
  const handleLogout = async () => {
    const router = (await import('@/router')).default;
    await signOut(getAuth());
    user.value = null;
    router.push('/login');
  }
  
  const waitForAuthInit = () => authPromise;
  const isAuthenticated = computed(() => !!user.value);

  return { user, isAuthenticated, authInitialized, init, handleLogout, waitForAuthInit }
})