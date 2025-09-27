<script setup>
import { ref } from 'vue';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { useRouter } from 'vue-router';

const email = ref('');
const password = ref('');
const errorMessage = ref('');
const router = useRouter();

const handleLogin = async () => {
  const auth = getAuth();
  try {
    errorMessage.value = '';
    await signInWithEmailAndPassword(auth, email.value, password.value);
    // El router guard en router/index.js se encargará de redirigir
  } catch (error) {
    console.error("Error de inicio de sesión:", error);
    errorMessage.value = 'Credenciales incorrectas. Por favor, intenta de nuevo.';
  }
};
</script>

<template>
  <div class="flex items-center justify-center min-h-screen bg-gray-50">
    <div class="w-full max-w-md p-8 space-y-6 bg-white rounded-xl shadow-lg">
      <div class="text-center">
        <h2 class="text-3xl font-bold text-gray-900">Angeles Fashion</h2>
        <p class="mt-2 text-gray-600">Bienvenido/a. Ingresa tus credenciales.</p>
      </div>
      <form @submit.prevent="handleLogin" class="space-y-6">
        <div>
          <label for="email" class="block text-sm font-medium text-gray-700">Correo Electrónico</label>
          <input type="email" id="email" v-model="email" required class="w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500">
        </div>
        <div>
          <label for="password" class="block text-sm font-medium text-gray-700">Contraseña</label>
          <input type="password" id="password" v-model="password" required class="w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500">
        </div>
        <div v-if="errorMessage" class="text-red-600 text-sm">{{ errorMessage }}</div>
        <div>
          <button type="submit" class="w-full px-4 py-2 font-semibold text-white bg-blue-600 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500">
            Iniciar Sesión
          </button>
        </div>
      </form>
    </div>
  </div>
</template>