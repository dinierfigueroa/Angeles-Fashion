<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import { db } from '@/firebase';
import { collection, query, onSnapshot, doc, getDocs, orderBy, updateDoc } from 'firebase/firestore';
import UserFormModal from '@/components/modals/UserFormModal.vue';
import AlertModal from '@/components/modals/AlertModal.vue';

const users = ref([]);
const storesMap = ref(new Map());
const rolesMap = ref(new Map());
const isLoading = ref(true);
let unsubscribe = null;

const isModalOpen = ref(false);
const selectedUser = ref(null);
const isAlertOpen = ref(false);
const alertMessage = ref('');

const fetchAuxData = async () => {
    const storesSnapshot = await getDocs(query(collection(db, 'stores'), orderBy('name')));
    storesSnapshot.forEach(doc => storesMap.value.set(doc.id, doc.data().name));
    const rolesSnapshot = await getDocs(query(collection(db, 'roles'), orderBy('displayName')));
    rolesSnapshot.forEach(doc => rolesMap.value.set(doc.id, doc.data().displayName));
};

const getStoreNames = (accessibleStores) => {
    if (!accessibleStores || accessibleStores.length === 0) return 'Global (Todas)';
    return accessibleStores.map(storeRef => storesMap.value.get(storeRef.id) || '...').join(', ');
};

const getRoleName = (roleId) => {
    if (!roleId) return 'No asignado';
    return rolesMap.value.get(roleId.id) || 'Rol no encontrado';
};

onMounted(async () => {
    await fetchAuxData();
    const q = query(collection(db, "users"), orderBy("display_name"));
    unsubscribe = onSnapshot(q, (snapshot) => {
        users.value = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        isLoading.value = false;
    });
});

onUnmounted(() => {
    if (unsubscribe) unsubscribe();
});

const openModal = (user = null) => {
    selectedUser.value = user;
    isModalOpen.value = true;
};

const handleUserSaved = (message) => {
    alertMessage.value = message;
    isAlertOpen.value = true;
};

const toggleUserStatus = async (user) => {
    try {
        const userRef = doc(db, "users", user.id);
        await updateDoc(userRef, {
            isActive: !user.isActive
        });
        alertMessage.value = `Usuario ${user.display_name} ha sido ${!user.isActive ? 'activado' : 'desactivado'}.`;
        isAlertOpen.value = true;
    } catch (error) {
        alertMessage.value = 'Error al cambiar el estado del usuario.';
        isAlertOpen.value = true;
        console.error(error);
    }
};
</script>

<template>
  <div class="bg-white p-6 rounded-lg shadow">
    <div class="flex justify-between items-center mb-4">
      <h2 class="text-2xl font-bold text-gray-800">Gestión de Usuarios</h2>
      <button @click="openModal()" class="px-4 py-2 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700">Crear Usuario</button>
    </div>
    <p class="text-gray-600 mb-6">Aquí podrás crear y editar usuarios, asignando roles y las tiendas específicas a las que tienen acceso.</p>
    <div class="overflow-x-auto">
      <table class="min-w-full divide-y divide-gray-200">
        <thead class="bg-gray-50">
          <tr>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Nombre</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Rol</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Tiendas Asignadas</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Estado</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Acciones</th>
          </tr>
        </thead>
        <tbody class="bg-white divide-y divide-gray-200">
          <tr v-if="isLoading"><td colspan="5" class="text-center p-4">Cargando usuarios...</td></tr>
          <tr v-for="user in users" :key="user.id">
            <td class="px-6 py-4 whitespace-nowrap">
              <div class="text-sm font-medium text-gray-900">{{ user.display_name }}</div>
              <div class="text-sm text-gray-500">{{ user.email }}</div>
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm capitalize">{{ getRoleName(user.roleId) }}</td>
            <td class="px-6 py-4 text-sm text-gray-500">{{ getStoreNames(user.accessibleStores) }}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm">
              <span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full" :class="user.isActive ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'">
                {{ user.isActive ? 'Activo' : 'Inactivo' }}
              </span>
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm font-medium space-x-4">
              <button @click="openModal(user)" class="text-indigo-600 hover:text-indigo-900">Editar</button>
              <button @click="toggleUserStatus(user)" class="font-medium" :class="user.isActive ? 'text-red-600 hover:text-red-900' : 'text-green-600 hover:text-green-900'">
                {{ user.isActive ? 'Desactivar' : 'Activar' }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>

  <UserFormModal v-model="isModalOpen" :user-to-edit="selectedUser" @user-saved="handleUserSaved" />
  <AlertModal v-model="isAlertOpen" :message="alertMessage" />
</template>