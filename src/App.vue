<template>
  <div class="app">
    <aside class="sidebar">
      <div class="brand">
        <span class="brand-dot" />
        vocal&nbsp;vanish
      </div>
      <nav class="nav">
        <router-link to="/" class="nav-item" exact-active-class="active">Search</router-link>
        <router-link to="/catalog" class="nav-item" active-class="active">Catalog</router-link>
        <router-link to="/config" class="nav-item" active-class="active">Config</router-link>
      </nav>
      <div class="sidebar-foot">kara.moe client</div>
    </aside>
    <main class="content">
      <router-view />
    </main>
  </div>
</template>

<script setup lang="ts">
// App shell: persistent side menu + routed content area.
</script>
