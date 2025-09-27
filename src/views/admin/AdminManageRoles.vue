<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import { db } from '@/firebase';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import RoleFormModal from '@/components/modals/RoleFormModal.vue';
import AlertModal from '@/components/modals/AlertModal.vue';

const roles = ref([]);
const isLoading = ref(true);
let unsubscribe = null;

const isModalOpen = ref(false);
const selectedRole = ref(null);

const isAlertOpen = ref(false);
const alertMessage = ref('');

onMounted(() => {
    const q = query(collection(db, "roles"), orderBy("displayName"));
    unsubscribe = onSnapshot(q, (snapshot) => {
        roles.value = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        isLoading.value = false;
    });
});

onUnmounted(() => {
    if(unsubscribe) unsubscribe();
});

const openModal = (role = null) => {
    selectedRole.value = role;
    isModalOpen.value = true;
};

const handleRoleSaved = (message) => {
    alertMessage.value = message;
    isAlertOpen.value = true;
};
</script>

<template>
  <div class="bg-white p-6 rounded-lg shadow">
    <div class="flex justify-between items-center mb-4">
      <h2 class="text-2xl font-bold text-gray-800">Gestionar Roles y Permisos</h2>
      <button @click="openModal()" class="px-4 py-2 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700">Crear Rol</button>
    </div>
     <p class="text-gray-600 mb-6">Aquí puedes crear roles y asignarles permisos específicos a cada uno.</p>
    <div class="overflow-x-auto">
      <table class="min-w-full divide-y divide-gray-200">
        <thead class="bg-gray-50">
            <tr>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Nombre del Rol</th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">ID Interno</th>
                <th class="relative px-6 py-3"><span class="sr-only">Acciones</span></th>
            </tr>
        </thead>
        <tbody class="bg-white divide-y divide-gray-200">
            <tr v-if="isLoading"><td colspan="3" class="text-center p-4">Cargando roles...</td></tr>
            <tr v-for="role in roles" :key="role.id">
                <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{{ role.displayName }}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500 font-mono">{{ role.id }}</td>
                <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <button @click="openModal(role)" class="text-indigo-600 hover:text-indigo-900">Editar Permisos</button>
                </td>
            </tr>
        </tbody>
      </table>
    </div>
  </div>
  <RoleFormModal v-model="isModalOpen" :role-to-edit="selectedRole" @role-saved="handleRoleSaved" />
  <AlertModal v-model="isAlertOpen" :message="alertMessage" />
</template>