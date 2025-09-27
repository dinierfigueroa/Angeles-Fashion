<script setup>
import { ref, watch, computed, onMounted } from 'vue';
import { db, firebaseConfig } from '@/firebase';
import { doc, setDoc, updateDoc, collection, getDocs, orderBy, query, serverTimestamp } from 'firebase/firestore';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword, signOut } from 'firebase/auth';
import { useAuthStore } from '@/stores/authStore';

const props = defineProps({
  modelValue: Boolean,
  userToEdit: Object,
});

const emit = defineEmits(['update:modelValue', 'user-saved']);
const authStore = useAuthStore();

const isOpen = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
});

const form = ref({
  display_name: '',
  email: '',
  password: '',
  roleId: '',
  isActive: true,
  accessibleStoreIds: {}
});
const stores = ref([]);
const roles = ref([]);
const isLoading = ref(false);
const isLoadingData = ref(true);

const isEditing = computed(() => !!props.userToEdit?.id);

const fetchData = async () => {
    isLoadingData.value = true;
    try {
        const storesQuery = query(collection(db, "stores"), orderBy("name"));
        const rolesQuery = query(collection(db, "roles"), orderBy("displayName"));
        
        const [storesSnapshot, rolesSnapshot] = await Promise.all([ getDocs(storesQuery), getDocs(rolesQuery) ]);
        
        stores.value = storesSnapshot.docs.map(doc => ({ id: doc.id, name: doc.data().name }));
        roles.value = rolesSnapshot.docs.map(doc => ({ id: doc.id, displayName: doc.data().displayName }));
    } catch (error) {
        console.error("Error al cargar datos para el formulario:", error);
        alert("No se pudieron cargar las tiendas o los roles.");
    } finally {
        isLoadingData.value = false;
    }
};

onMounted(fetchData);

watch(() => props.userToEdit, (user) => {
    const defaultForm = { display_name: '', email: '', password: '', roleId: '', isActive: true, accessibleStoreIds: {} };
    if (user) {
        form.value = {
            display_name: user.display_name || '',
            email: user.email || '',
            password: '',
            roleId: user.roleId?.id || '',
            isActive: user.isActive === undefined ? true : user.isActive,
            accessibleStoreIds: (user.accessibleStores || []).reduce((acc, storeRef) => {
                acc[storeRef.id] = true;
                return acc;
            }, {})
        };
    } else {
        form.value = defaultForm;
    }
}, { immediate: true, deep: true });

const handleSubmit = async () => {
    const selectedStoreIds = Object.keys(form.value.accessibleStoreIds).filter(id => form.value.accessibleStoreIds[id]);

    if (!form.value.display_name || !form.value.email || !form.value.roleId) {
        alert("Por favor, completa el nombre, email y rol.");
        return;
    }
    
    isLoading.value = true;
    
    const accessibleStoresRefs = selectedStoreIds.map(id => doc(db, 'stores', id));
    const primaryStoreRef = selectedStoreIds.length > 0 ? doc(db, 'stores', selectedStoreIds[0]) : null;

    try {
        const dataToSave = {
            display_name: form.value.display_name,
            roleId: doc(db, 'roles', form.value.roleId),
            storeId: primaryStoreRef,
            accessibleStores: accessibleStoresRefs,
            isActive: form.value.isActive
        };

        if (isEditing.value) {
            const userRef = doc(db, "users", props.userToEdit.id);
            await updateDoc(userRef, dataToSave);
            emit('user-saved', 'Usuario actualizado con éxito.');
        } else {
            if (!form.value.password) {
                alert("La contraseña es requerida para nuevos usuarios.");
                isLoading.value = false;
                return;
            }
            const tempAppName = 'secondary-auth-app-' + Date.now();
            const tempApp = initializeApp(firebaseConfig, tempAppName);
            const tempAuth = getAuth(tempApp);
            const userCredential = await createUserWithEmailAndPassword(tempAuth, form.value.email, form.value.password);
            const newUser = userCredential.user;
            await setDoc(doc(db, "users", newUser.uid), {
                uid: newUser.uid,
                email: form.value.email,
                created_time: serverTimestamp(),
                ...dataToSave
            });
            await signOut(tempAuth);
            await deleteApp(tempApp);
            emit('user-saved', `Usuario ${form.value.display_name} creado con éxito.`);
        }
        isOpen.value = false;
    } catch (error) {
        console.error("Error al guardar usuario:", error);
        alert(`Error: ${error.message}`);
    } finally {
        isLoading.value = false;
    }
};
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="isOpen" @click.self="isOpen = false" class="fixed inset-0 bg-gray-900 bg-opacity-50 z-50 flex items-center justify-center p-4">
        <div class="bg-white rounded-lg shadow-xl w-full max-w-lg p-6">
          <form @submit.prevent="handleSubmit">
            <h3 class="text-lg font-bold text-gray-900 mb-4">{{ isEditing ? 'Editar' : 'Crear Nuevo' }} Usuario</h3>
            <div v-if="isLoadingData" class="text-center p-8">Cargando datos...</div>
            <div v-else class="space-y-4 max-h-[70vh] overflow-y-auto pr-2">
              <div>
                <label class="block text-sm font-medium text-gray-700">Nombre Completo</label>
                <input type="text" v-model="form.display_name" required class="w-full input-style">
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700">Correo Electrónico</label>
                <input type="email" v-model="form.email" :disabled="isEditing" required class="w-full input-style disabled:bg-gray-100">
              </div>
              <div v-if="!isEditing">
                <label class="block text-sm font-medium text-gray-700">Contraseña</label>
                <input type="password" v-model="form.password" required class="w-full input-style">
              </div>
               <div v-else>
                  <p class="text-xs text-gray-500">La contraseña de un usuario solo puede ser reseteada desde la consola de Firebase por seguridad.</p>
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700">Rol</label>
                <select v-model="form.roleId" required class="w-full input-style">
                    <option value="" disabled>-- Selecciona un rol --</option>
                    <option v-for="role in roles" :key="role.id" :value="role.id">{{ role.displayName }}</option>
                </select>
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700">Tiendas Accesibles (Opcional)</label>
                <p class="text-xs text-gray-500 mt-1">Asigna a qué tiendas tendrá acceso este usuario. Si no marcas ninguna, será un usuario global.</p>
                <div class="mt-2 border rounded-md p-4 space-y-2 max-h-40 overflow-y-auto">
                    <div v-for="store in stores" :key="store.id" class="flex items-center">
                        <input :id="`store-${store.id}`" type="checkbox" v-model="form.accessibleStoreIds[store.id]" class="h-4 w-4 text-indigo-600 border-gray-300 rounded">
                        <label :for="`store-${store.id}`" class="ml-3 text-sm text-gray-600">{{ store.name }}</label>
                    </div>
                </div>
              </div>
               <div>
                 <label class="block text-sm font-medium text-gray-700">Estado</label>
                 <div class="mt-2 flex items-center space-x-6">
                    <label class="flex items-center"><input type="radio" :value="true" v-model="form.isActive" class="h-4 w-4"><span class="ml-2">Activo</span></label>
                    <label class="flex items-center"><input type="radio" :value="false" v-model="form.isActive" class="h-4 w-4"><span class="ml-2">Inactivo</span></label>
                 </div>
               </div>
            </div>
            <div class="mt-6 flex justify-end space-x-3">
              <button type="button" @click="isOpen = false" class="px-4 py-2 bg-gray-200 text-gray-800 rounded-md">Cancelar</button>
              <button type="submit" :disabled="isLoading || isLoadingData" class="px-4 py-2 bg-indigo-600 text-white rounded-md disabled:bg-indigo-300">
                {{ isLoading ? 'Guardando...' : 'Guardar' }}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.input-style { @apply w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm; }
.modal-enter-active, .modal-leave-active { transition: opacity 0.3s ease; }
.modal-enter-from, .modal-leave-to { opacity: 0; }
</style>